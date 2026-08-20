import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import {
  buildTodayChoiceQuestionBank,
  isSameLocalDay,
  learningItemToKnowledgePoint,
  parseChoiceBlock,
  parseLearningImportFile,
  parseLearningImportText,
  selectTodayExamQuestions,
} from "../app/lib/today-learning.ts";

const NOW = Date.parse("2026-07-25T12:00:00+08:00");
const OFFSET = -480;

test("uses the Asia/Shanghai local calendar day rather than UTC date", () => {
  assert.equal(
    isSameLocalDay(
      Date.parse("2026-07-25T00:05:00+08:00"),
      NOW,
      OFFSET,
    ),
    true,
  );
  assert.equal(
    isSameLocalDay(
      Date.parse("2026-07-24T23:59:59+08:00"),
      NOW,
      OFFSET,
    ),
    false,
  );
});

test("parses inline four-option questions without mistaking option labels for the stem", () => {
  const parsed = parseChoiceBlock(
    "If I ___ enough time, I would travel more. A. have B. had C. will have D. am having",
  );
  assert.equal(parsed.stem, "If I ___ enough time, I would travel more.");
  assert.deepEqual(parsed.choices, [
    "have",
    "had",
    "will have",
    "am having",
  ]);
});

test("normalizes full-width and bracketed option labels", () => {
  const parsed = parseChoiceBlock(
    "请选择正确答案。\n（Ａ）甲\n（Ｂ）乙\n（Ｃ）丙\n（Ｄ）丁",
  );
  assert.equal(parsed.stem, "请选择正确答案。");
  assert.deepEqual(parsed.choices, ["甲", "乙", "丙", "丁"]);
});

test("imports only today's structured records and resolves letter answers", () => {
  const result = parseLearningImportText(
    JSON.stringify({
      items: [
        {
          source: "chatgpt",
          occurredAt: "2026-07-25T09:00:00+08:00",
          question:
            "If I ___ enough time, I would travel more.\nA. have\nB. had\nC. will have\nD. am having",
          answer: "B",
          explanation: "与现在事实相反时，if 从句使用一般过去时。",
          knowledgePoint: "与现在事实相反的虚拟条件句使用一般过去时。",
        },
        {
          source: "chatgpt",
          occurredAt: "2026-07-24T21:00:00+08:00",
          question: "Old item\nA. one\nB. two\nC. three\nD. four",
          answer: "A",
          explanation: "昨天的记录。",
        },
      ],
    }),
    { now: NOW, timezoneOffsetMinutes: OFFSET },
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].answer, "had");
  assert.equal(result.items[0].source, "chatgpt");
  assert.equal(result.skipped, 1);
});

test("keeps case, spacing, and apostrophe-distinct choices aligned with letter answers", () => {
  const result = parseLearningImportText(
    JSON.stringify({
      items: [
        {
          occurredAt: "2026-07-25T09:00:00+08:00",
          question: "Choose the country abbreviation.\nA. us\nB. US\nC. them\nD. we",
          answer: "B",
          explanation: "US is the requested abbreviation.",
        },
        {
          occurredAt: "2026-07-25T09:01:00+08:00",
          question: "Choose the possessive form.\nA. its\nB. it’s\nC. his\nD. hers",
          answer: "B",
          explanation: "The keyed answer intentionally contains a curly apostrophe.",
        },
        {
          occurredAt: "2026-07-25T09:02:00+08:00",
          question: "Choose the adjective.\nA. everyday\nB. every day\nC. daily\nD. usual",
          answer: "B",
          explanation: "The keyed answer intentionally contains a space.",
        },
      ],
    }),
    { now: NOW, timezoneOffsetMinutes: OFFSET },
  );

  assert.deepEqual(
    result.items.map((item) => item.answer),
    ["US", "it’s", "every day"],
  );
  assert.ok(result.items.every((item) => item.choices.length === 4));
  assert.equal(buildTodayChoiceQuestionBank(result.items, []).length, 3);
});

test("reads ChatGPT conversations.json user/assistant pairs", () => {
  const timestamp = Date.parse("2026-07-25T10:00:00+08:00") / 1000;
  const result = parseLearningImportText(
    JSON.stringify([
      {
        title: "今日英语",
        create_time: timestamp,
        mapping: {
          user: {
            message: {
              author: { role: "user" },
              create_time: timestamp,
              content: {
                parts: [
                  "Which word best completes the sentence?\nA. quick\nB. quickly\nC. quicker\nD. quickest",
                ],
              },
            },
          },
          assistant: {
            message: {
              author: { role: "assistant" },
              create_time: timestamp + 2,
              content: {
                parts: ["答案：B\n解析：修饰动词应使用副词 quickly。"],
              },
            },
          },
        },
      },
    ]),
    { now: NOW, timezoneOffsetMinutes: OFFSET, originLabel: "conversations.json" },
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].answer, "quickly");
  assert.match(result.items[0].explanation, /副词 quickly/);
});

test("uses only the current ChatGPT conversation branch", () => {
  const timestamp = Date.parse("2026-07-25T10:00:00+08:00") / 1000;
  const result = parseLearningImportText(
    JSON.stringify([
      {
        title: "重新生成过答案",
        create_time: timestamp,
        current_node: "new-answer",
        mapping: {
          root: { parent: null, message: null },
          user: {
            parent: "root",
            message: {
              author: { role: "user" },
              create_time: timestamp,
              content: {
                parts: ["Choose one.\nA. old\nB. wrong\nC. current\nD. none"],
              },
            },
          },
          "old-answer": {
            parent: "user",
            message: {
              author: { role: "assistant" },
              create_time: timestamp + 1,
              content: { parts: ["答案：A\n解析：这是被重新生成掉的旧答案。"] },
            },
          },
          "new-answer": {
            parent: "user",
            message: {
              author: { role: "assistant" },
              create_time: timestamp + 2,
              content: { parts: ["答案：C\n解析：当前分支的答案是 current。"] },
            },
          },
        },
      },
    ]),
    { now: NOW, timezoneOffsetMinutes: OFFSET },
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].answer, "current");
  assert.doesNotMatch(result.items[0].explanation, /旧答案/);
});

test("rewrites untrusted external ids from structured imports", () => {
  const result = parseLearningImportText(
    JSON.stringify({
      items: [
        {
          id: "same",
          occurredAt: "2026-07-25T09:00:00+08:00",
          question: "First?\nA. one\nB. two\nC. three\nD. four",
          answer: "A",
          explanation: "First explanation.",
        },
        {
          id: "same",
          occurredAt: "2026-07-25T09:01:00+08:00",
          question: "Second?\nA. red\nB. blue\nC. green\nD. black",
          answer: "B",
          explanation: "Second explanation.",
        },
      ],
    }),
    { now: NOW, timezoneOffsetMinutes: OFFSET },
  );

  assert.equal(result.items.length, 2);
  assert.notEqual(result.items[0].id, result.items[1].id);
  assert.notEqual(result.items[0].id, "same");
});

test("prefers an explicitly correct answer over an earlier negated option", () => {
  const result = parseLearningImportText(
    [
      "用户：Choose the correct option.\nA. old\nB. current\nC. none\nD. all",
      "助手：Answer A is incorrect. The correct answer is B because current is right.",
    ].join("\n"),
    { now: NOW, timezoneOffsetMinutes: OFFSET },
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].answer, "current");
});

test("prefers a Chinese correct-answer label over an earlier rejected option", () => {
  const result = parseLearningImportText(
    [
      "用户：请选择正确项。\nA. 错误项\nB. 正确项\nC. 干扰项\nD. 其他项",
      "助手：答案 A 错误，正确答案 B，因为 B 才符合题意。",
    ].join("\n"),
    { now: NOW, timezoneOffsetMinutes: OFFSET },
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].answer, "正确项");
});

test("does not silently treat timestamp-free structured history as today", () => {
  const result = parseLearningImportText(
    JSON.stringify({
      items: [{
        question: "No timestamp?\nA. one\nB. two\nC. three\nD. four",
        answer: "A",
        explanation: "The record date is unknown.",
      }],
    }),
    { now: NOW, timezoneOffsetMinutes: OFFSET },
  );

  assert.equal(result.items.length, 0);
  assert.equal(result.skipped, 1);
});

test("splits a numbered multi-question prompt when option labels restart", () => {
  const result = parseLearningImportText(
    [
      "用户：1. Choose the adverb.\nA. quick\nB. quickly\nC. quicker\nD. quickest\n2. Choose the past form.\nA. go\nB. goes\nC. went\nD. going",
      "助手：1. B because quickly modifies a verb.\n2. C because went is the past form.",
    ].join("\n"),
    { now: NOW, timezoneOffsetMinutes: OFFSET },
  );

  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((item) => item.answer),
    ["quickly", "went"],
  );
});

test("imports every numbered ChatGPT conversation shard from a ZIP", async () => {
  const makeItem = (minute, label) => JSON.stringify({
    items: [{
      occurredAt: `2026-07-25T09:${minute}:00+08:00`,
      question: `${label}?\nA. one\nB. two\nC. three\nD. four`,
      answer: "A",
      explanation: `${label} explanation.`,
    }],
  });
  const bytes = zipSync({
    "conversations-1.json": strToU8(makeItem("00", "First shard")),
    "conversations-2.json": strToU8(makeItem("01", "Second shard")),
    "ignored/image.bin": new Uint8Array([1, 2, 3]),
  });
  const file = new File([bytes], "chatgpt-export.zip", {
    type: "application/zip",
  });

  const result = await parseLearningImportFile(file, {
    now: NOW,
    timezoneOffsetMinutes: OFFSET,
  });

  assert.equal(result.items.length, 2);
});

test("reads root Codex JSONL and ignores subagent logs", () => {
  const rootRows = [
    {
      timestamp: "2026-07-25T02:00:00.000Z",
      type: "session_meta",
      payload: { source: {} },
    },
    {
      timestamp: "2026-07-25T02:01:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Choose the right form.\nA. go\nB. goes\nC. going\nD. gone",
          },
        ],
      },
    },
    {
      timestamp: "2026-07-25T02:01:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "答案：B\n解析：第三人称单数的一般现在时使用 goes。",
          },
        ],
      },
    },
  ];
  const root = parseLearningImportText(
    rootRows.map((row) => JSON.stringify(row)).join("\n"),
    { now: NOW, timezoneOffsetMinutes: OFFSET, originLabel: "rollout.jsonl" },
  );
  assert.equal(root.items.length, 1);
  assert.equal(root.items[0].source, "codex");

  const subagentRows = structuredClone(rootRows);
  subagentRows[0].payload.source = { subagent: { depth: 1 } };
  const subagent = parseLearningImportText(
    subagentRows.map((row) => JSON.stringify(row)).join("\n"),
    { now: NOW, timezoneOffsetMinutes: OFFSET, originLabel: "subagent.jsonl" },
  );
  assert.equal(subagent.items.length, 0);
  assert.match(subagent.notices[0], /子代理/);
});

test("builds a user-sized, choice-only exam with answers and explanations", () => {
  const imported = parseLearningImportText(
    JSON.stringify({
      items: [
        {
          source: "chatgpt",
          occurredAt: "2026-07-25T09:00:00+08:00",
          question: "Choose the adverb.\nA. quick\nB. quickly\nC. quicker\nD. quickest",
          answer: "B",
          explanation: "修饰动词使用副词。",
        },
        {
          source: "codex",
          occurredAt: "2026-07-25T10:00:00+08:00",
          question: "Choose the past form.\nA. go\nB. goes\nC. went\nD. going",
          answer: "C",
          explanation: "go 的一般过去式是 went。",
        },
      ],
    }),
    { now: NOW, timezoneOffsetMinutes: OFFSET },
  ).items;
  const points = imported.map(learningItemToKnowledgePoint);
  const bank = buildTodayChoiceQuestionBank(imported, points);
  const exam = selectTodayExamQuestions(bank, 1, "fixed-seed");

  assert.equal(bank.length, 2);
  assert.equal(exam.length, 1);
  assert.equal(exam[0].type, "choice");
  assert.equal(exam[0].choices.length, 4);
  assert.ok(exam[0].choices.includes(exam[0].answer));
  assert.ok(exam[0].explanation);
  assert.ok(exam[0].subject);
  assert.ok(exam[0].knowledgeCategory);
  assert.equal(points[0].explanation, imported[0].explanation);
});

test("turns every blank in a structured document question into a four-option item", () => {
  const base = {
    context: "计算机组成知识点解析。",
    sourceName: "sample.pdf",
    location: "第 1 页",
    method: "pdf-color",
    createdAt: 1,
  };
  const points = [
    {
      ...base,
      id: "multi",
      text: "运算器；控制器",
      question: "CPU 由______和______组成。",
      answerParts: ["运算器", "控制器"],
    },
    ...["内存储器", "输入设备", "输出设备"].map((answer, index) => ({
      ...base,
      id: `peer-${index}`,
      text: answer,
      question: `候选知识点 ${index + 1} 是______。`,
      answerParts: [answer],
    })),
  ];

  const bank = buildTodayChoiceQuestionBank([], points);
  const multiQuestions = bank.filter((question) => question.pointId === "multi");

  assert.equal(multiQuestions.length, 2);
  for (const question of multiQuestions) {
    assert.equal(question.type, "choice");
    assert.equal(question.choices.length, 4);
    assert.equal(new Set(question.choices).size, 4);
    assert.ok(question.choices.includes(question.answer));
    assert.equal((question.stem.match(/______/g) || []).length, 1);
    assert.ok(question.explanation);
  }
});

test("gives unstructured document records mutually distinct provenance stems", () => {
  const base = {
    context: "本页标红知识点。",
    sourceName: "sample.pdf",
    location: "第 2 页",
    method: "pdf-color",
    createdAt: 1,
  };
  const points = ["甲", "乙", "丙", "丁"].map((text, index) => ({
    ...base,
    id: `plain-${index}`,
    text,
    answerParts: [text],
  }));

  const bank = buildTodayChoiceQuestionBank([], points);

  assert.equal(bank.length, 4);
  assert.equal(new Set(bank.map((question) => question.stem)).size, 4);
});

test("builds generated distractors only from the selected subject pool", () => {
  const base = {
    context: "专项知识点。",
    sourceName: "mixed.pdf",
    location: "第 1 页",
    method: "pdf-color",
    createdAt: 1,
  };
  const englishAnswers = ["past tense", "noun", "adverb", "relative clause"];
  const computerAnswers = ["中央处理器", "内存储器", "输入设备", "操作系统"];
  const points = [
    ...englishAnswers.map((text, index) => ({
      ...base,
      id: `english-${index}`,
      text,
      answerParts: [text],
      subject: "大学英语",
      knowledgeCategory: "词汇与语法",
      classificationConfidence: 0.95,
      classificationSource: "user",
    })),
    ...computerAnswers.map((text, index) => ({
      ...base,
      id: `computer-${index}`,
      text,
      answerParts: [text],
      subject: "计算机基础",
      knowledgeCategory: "硬件与系统组成",
      classificationConfidence: 0.95,
      classificationSource: "user",
    })),
  ];

  const bank = buildTodayChoiceQuestionBank([], points);
  assert.equal(bank.length, 8);
  for (const question of bank) {
    const allowed =
      question.subject === "大学英语" ? englishAnswers : computerAnswers;
    assert.ok(
      question.choices.every((choice) => allowed.includes(choice)),
      `${question.subject}: ${question.choices.join(" / ")}`,
    );
  }
});
