import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyKnowledge,
  sortStudySubjects,
} from "../app/lib/knowledge-taxonomy.ts";

const cases = [
  {
    expected: ["大学英语", "词汇与语法"],
    input: {
      stem: "If I ___ enough time, I would travel more.",
      choices: ["have", "had", "will have", "am having"],
      explanation: "与现在事实相反的虚拟语气。",
    },
  },
  {
    expected: ["大学英语", "阅读理解"],
    input: {
      title: "Reading comprehension",
      stem: "According to the passage, why did the author leave home?",
      choices: ["For work", "For study", "For travel", "For family"],
    },
  },
  {
    expected: ["大学英语", "补全对话"],
    input: { stem: "补全对话：A: How are you? B: ______" },
  },
  {
    expected: ["大学英语", "完形填空"],
    input: { title: "Cloze test 完形填空", stem: "Choose the best answer." },
  },
  {
    expected: ["计算机基础", "硬件与系统组成"],
    input: { question: "CPU 由______和______组成。", answerParts: ["运算器", "控制器"] },
  },
  {
    expected: ["计算机基础", "操作系统"],
    input: { question: "操作系统的五大管理功能是什么？", text: "进程管理 文件管理 设备管理" },
  },
  {
    expected: ["计算机基础", "网络与信息安全"],
    input: { context: "IP 地址、域名和 TCP/IP 协议属于计算机网络基础。" },
  },
  {
    expected: ["计算机基础", "数据库与程序设计"],
    input: { context: "SQL 用于查询关系数据库中的数据表。" },
  },
  {
    expected: ["大学语文", "古诗文阅读"],
    input: { title: "古诗文阅读", context: "翻译下列文言文句子并分析诗词意象。" },
  },
  {
    expected: ["大学语文", "写作"],
    input: { question: "根据材料写一篇议论文作文，注意审题立意。" },
  },
  {
    expected: ["高等数学", "积分"],
    input: { question: "求函数的不定积分 ∫x² dx。" },
  },
  {
    expected: ["高等数学", "线性代数"],
    input: { context: "计算矩阵的行列式并求特征值。" },
  },
];

test("classifies representative subjects and knowledge categories locally", () => {
  cases.forEach(({ input, expected }) => {
    const result = classifyKnowledge(input);
    assert.deepEqual(
      [result.subject, result.category],
      expected,
      JSON.stringify(input),
    );
    assert.ok(result.confidence >= 0.5);
    assert.ok(result.reasons.length > 0);
  });
});

test("returns a stable low-confidence fallback for unknown material", () => {
  const first = classifyKnowledge({ text: "海马体参与新记忆形成。" });
  const second = classifyKnowledge({ text: "海马体参与新记忆形成。" });

  assert.deepEqual(first, second);
  assert.equal(first.subject, "其他");
  assert.equal(first.category, "综合知识");
  assert.ok(first.confidence < 0.5);
});

test("sorts and deduplicates subjects in the product order", () => {
  assert.deepEqual(
    sortStudySubjects(["其他", "大学英语", "计算机基础", "大学英语"]),
    ["大学英语", "计算机基础", "其他"],
  );
});

test("does not confuse generic options, English word, or study suffixes with a subject", () => {
  assert.equal(
    classifyKnowledge({
      stem: "下列说法正确的是？\nA. 甲\nB. 乙\nC. 丙\nD. 丁",
    }).subject,
    "其他",
  );
  assert.equal(classifyKnowledge({ text: "study hard" }).subject, "其他");

  const wordQuestion = classifyKnowledge({
    stem: "Choose the correct word to complete the sentence.",
    choices: ["is", "are", "was", "were"],
  });
  assert.equal(wordQuestion.subject, "大学英语");
  assert.notEqual(wordQuestion.category, "补全对话");
});

test("lets explicit Chinese-language context override a shared question type", () => {
  const result = classifyKnowledge({
    title: "大学语文选词填空",
    stem: "从所给成语中选择最恰当的一项。",
  });
  assert.equal(result.subject, "大学语文");
});

test("uses an honest comprehensive category when no subtype rule matches", () => {
  const result = classifyKnowledge({
    stem: "The book was written in 1990.",
  });
  assert.equal(result.subject, "大学英语");
  assert.equal(result.category, "英语综合");
});

test("lets strong programming and English mathematics context win over shared words", () => {
  const cases = [
    [
      { text: "C语言程序设计：C语言函数返回值由 return 语句给出。" },
      "计算机基础",
      "数据库与程序设计",
    ],
    [
      { text: "Python基础：What does this function return?" },
      "计算机基础",
      "数据库与程序设计",
    ],
    [
      { stem: "Find the derivative of f(x)=x^2." },
      "高等数学",
      "导数与微分",
    ],
    [
      { title: "Grammar", stem: "What does RAM stand for?" },
      "计算机基础",
      "硬件与系统组成",
    ],
    [
      { text: "SQL 聚合函数 COUNT 用于统计数据表的行数。" },
      "计算机基础",
      "数据库与程序设计",
    ],
    [
      {
        stem: "In Microsoft Word, which shortcut saves the document?",
        choices: ["Ctrl+S", "Ctrl+P", "Ctrl+N", "Ctrl+W"],
      },
      "计算机基础",
      "办公软件",
    ],
  ];

  for (const [input, subject, category] of cases) {
    const result = classifyKnowledge(input);
    assert.deepEqual([result.subject, result.category], [subject, category]);
  }
});

test("does not match RAM or Word as substrings inside ordinary English words", () => {
  const program = classifyKnowledge({
    stem: "This program was written from scratch.",
  });
  assert.equal(program.subject, "大学英语");
  assert.notEqual(program.category, "硬件与系统组成");
  assert.notEqual(program.category, "办公软件");
});

test("uses an English-only option set when a generic Chinese stem carries no subject clue", () => {
  const result = classifyKnowledge({
    stem: "选择正确答案。",
    choices: ["abandon", "give up", "retain", "continue"],
    answer: "give up",
    explanation: "选择与题意一致的选项。",
  });
  assert.equal(result.subject, "大学英语");
  assert.equal(result.category, "词汇与语法");
});

test("preserves an already confirmed canonical classification", () => {
  const result = classifyKnowledge({
    text: "选出正确答案。",
    subject: "大学英语",
    knowledgeCategory: "词汇与语法",
    classificationConfidence: 0.88,
    classificationSource: "user",
  });
  assert.deepEqual(
    [result.subject, result.category, result.confidence],
    ["大学英语", "词汇与语法", 0.88],
  );
});
