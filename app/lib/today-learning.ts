import { strFromU8, unzip } from "fflate";
import type { KnowledgePoint } from "./document-parser";
import { standardizeQuestionBlanks } from "./knowledge-structure";
import {
  KNOWLEDGE_TAXONOMY_VERSION,
  classifyKnowledge,
  type KnowledgeClassification,
  type StudySubject,
} from "./knowledge-taxonomy";
import { normalizeAnswer, type Question } from "./study";

export type LearningSource = "chatgpt" | "codex" | "manual";
export type LearningItemKind = "choice" | "knowledge";

export type TodayLearningItem = {
  id: string;
  source: LearningSource;
  occurredAt: number;
  title: string;
  kind: LearningItemKind;
  stem: string;
  choices: string[];
  answer: string;
  explanation: string;
  knowledgePoint: string;
  originLabel: string;
};

export type LearningImportResult = {
  items: TodayLearningItem[];
  skipped: number;
  notices: string[];
};

export type SichuanChoiceSection =
  | "补全对话"
  | "词汇与语法结构"
  | "阅读理解"
  | "选词填空"
  | "选句填空"
  | "完形填空";

export type TodayExamQuestion = Question & {
  type: "choice";
  explanation: string;
  section: string;
  sourceLabel: string;
  sourceItemId?: string;
  subject: StudySubject;
  knowledgeCategory: string;
};

type ImportOptions = {
  now?: number;
  timezoneOffsetMinutes?: number;
  sourceHint?: LearningSource;
  originLabel?: string;
};

type RawPair = {
  prompt: string;
  response: string;
  occurredAt: number;
  title: string;
  source: LearningSource;
  originLabel: string;
};

const MAX_IMPORT_BYTES = 80 * 1024 * 1024;
const MAX_ZIP_EXPANDED_BYTES = 120 * 1024 * 1024;
const MAX_ZIP_CANDIDATE_ENTRIES = 256;
const MAX_ZIP_ENTRIES = 20_000;
const OPTION_PREFIX = String.raw`(?:\*\*)?([A-H])(?:\*\*)?\s*[.．、:：\)）]`;
const INJECTED_CONTEXT_BLOCK =
  /<(?:codex_internal_context|in-app-browser-context|environment_context|app-context|permissions|recommended_plugins|developer_context)\b[^>]*>[\s\S]*?<\/(?:codex_internal_context|in-app-browser-context|environment_context|app-context|permissions|recommended_plugins|developer_context)>/giu;

function hashId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/gu, " ")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function normalizeOptionAlphabet(value: string) {
  return value
    .replace(/[Ａ-Ｈａ-ｈ]/gu, (letter) =>
      String.fromCharCode(letter.charCodeAt(0) - 0xfee0),
    )
    .replace(/[（(]\s*([A-H])\s*[）)]/giu, "$1.");
}

function cleanChoice(value: unknown) {
  return normalizeOptionAlphabet(cleanText(value))
    .replace(/^(?:\*\*)?[A-H](?:\*\*)?\s*[.．、:：\)）]\s*/iu, "")
    .replace(/^[-*]\s+/u, "")
    .trim();
}

function choiceIdentity(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .trim();
}

function uniqueText(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = choiceIdentity(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asTimestamp(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function localDayKey(
  timestamp: number,
  timezoneOffsetMinutes = new Date(timestamp).getTimezoneOffset(),
) {
  return new Date(timestamp - timezoneOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function isSameLocalDay(
  timestamp: number,
  reference: number,
  timezoneOffsetMinutes = new Date(reference).getTimezoneOffset(),
) {
  return (
    localDayKey(timestamp, timezoneOffsetMinutes) ===
    localDayKey(reference, timezoneOffsetMinutes)
  );
}

function inferSource(name: string, fallback: LearningSource = "manual") {
  const lower = name.toLowerCase();
  if (lower.includes("conversation") || lower.includes("chatgpt")) return "chatgpt";
  if (lower.includes("rollout") || lower.includes("codex") || lower.endsWith(".jsonl")) {
    return "codex";
  }
  return fallback;
}

function shorten(value: string, maxLength = 56) {
  const oneLine = cleanText(value).replace(/\n+/gu, " ");
  return oneLine.length <= maxLength
    ? oneLine
    : `${oneLine.slice(0, maxLength - 1)}…`;
}

function stripInjectedContext(value: string) {
  const cleaned = cleanText(value)
    .replace(INJECTED_CONTEXT_BLOCK, "")
    .replace(/<codex_internal_context\b[^>]*>[\s\S]*$/giu, "")
    .trim();
  const requestMarker = cleaned.match(/##\s*My request for Codex\s*:\s*([\s\S]+)/iu);
  return cleanText(requestMarker?.[1] || cleaned);
}

export function parseChoiceBlock(value: string) {
  const text = normalizeOptionAlphabet(cleanText(value));
  if (!text) return { stem: "", choices: [] as string[], labels: [] as string[] };

  const prepared = text.replace(
    new RegExp(String.raw`[ \t]+(?=${OPTION_PREFIX})`, "giu"),
    "\n",
  );
  const matcher = new RegExp(
    String.raw`(?:^|\n)\s*(?:[-*]\s*)?${OPTION_PREFIX}\s*([\s\S]*?)(?=(?:\n\s*(?:[-*]\s*)?${OPTION_PREFIX})|$)`,
    "giu",
  );
  const matches = [...prepared.matchAll(matcher)];
  const labels = matches.map((match) => match[1].toUpperCase());
  const choices = matches.map((match) => cleanChoice(match[2]));
  const sequential = labels.every(
    (label, index) => label.charCodeAt(0) === 65 + index,
  );
  if (choices.length < 2 || !sequential || choices.some((choice) => !choice)) {
    return { stem: text, choices: [] as string[], labels: [] as string[] };
  }
  const firstIndex = matches[0].index ?? prepared.indexOf(matches[0][0]);
  const stem = cleanText(prepared.slice(0, Math.max(0, firstIndex)));
  return { stem, choices, labels };
}

function answerLabelFromText(value: string) {
  const normalized = normalizeOptionAlphabet(value);
  const preferredPatterns = [
    /(?:the\s+)?correct\s+(?:answer|option)\s*(?:is|[:：\-])*\s*(?:\*\*|`|_)*([A-H])\b/iu,
    /\bcorrect\s*(?:is|[:：\-])+\s*(?:option\s+)?(?:\*\*|`|_)*([A-H])\b/iu,
    /(?:正确答案|参考答案)\s*(?:是|为|[:：\-])*\s*(?:\*\*|`|_)*([A-H])(?:\*\*|`|_)*/iu,
    /(?:the\s+)?answer\s+is\s+(?:option\s+)?([A-H])\b/iu,
    /^\s*(?:\*\*|`|_)*([A-H])(?:\*\*|`|_)*(?:[.．、，。:：\s]|$)/iu,
  ];
  for (const pattern of preferredPatterns) {
    const match = normalized.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  const generic = normalized.match(
    /(?:\banswer|答案)\s*(?:是|为|[:：\-])*\s*(?:option\s+)?(?:\*\*|`|_)*([A-H])\b/iu,
  );
  if (generic) {
    const tail = normalized.slice((generic.index || 0) + generic[0].length, (generic.index || 0) + generic[0].length + 28);
    if (
      !/^\s*(?:(?:is\s+)?(?:incorrect|wrong|not\s+correct)\b|(?:是|为)?(?:错误|不正确|错的|错误选项))/iu.test(
        tail,
      )
    ) {
      return generic[1].toUpperCase();
    }
  }
  return "";
}

function resolveAnswer(value: string, choices: string[]) {
  const cleaned = cleanText(value);
  const explicitLabel = answerLabelFromText(cleaned);
  const bareLabel = cleaned.match(/^\s*([A-H])\s*$/iu)?.[1]?.toUpperCase() || "";
  const label = explicitLabel || bareLabel;
  if (label) return choices[label.charCodeAt(0) - 65] || "";
  return choices.find(
    (choice) => choiceIdentity(choice) === choiceIdentity(cleaned),
  ) || cleaned;
}

function cleanExplanation(value: string) {
  const text = cleanText(value);
  if (!text) return "";
  const withoutAnswerLead = text
    .replace(
      /^\s*(?:\*\*)?(?:正确答案|参考答案|答案|correct\s+answer|answer)(?:\*\*)?\s*(?:是|为|[:：\-])*\s*(?:\*\*|`|_)*[A-H](?:\*\*|`|_)*(?:[.．、，。:：\-]\s*)?/iu,
      "",
    )
    .replace(/^\s*(?:解析|说明|理由|analysis|explanation)\s*[:：\-]\s*/iu, "")
    .trim();
  return withoutAnswerLead || text;
}

function extractKnowledgeStatement(value: string) {
  const text = cleanText(value);
  const labeled = text.match(
    /(?:^|\n)\s*(?:[-*]\s*)?(?:知识点|核心结论|考点|结论|要点|knowledge\s*point)\s*[:：\-]\s*([^\n]{2,300})/iu,
  )?.[1];
  if (labeled) return cleanText(labeled);

  const paragraph = text
    .replace(/^\s*(?:答案|answer)\s*[:：\-].*$/gimu, "")
    .split(/\n{2,}/u)
    .map((part) => part.replace(/^#+\s*/u, "").trim())
    .find((part) => {
      const compact = part.replace(/\s/gu, "");
      return compact.length >= 8 && compact.length <= 240 && !part.includes("```");
    });
  return paragraph || "";
}

function classifySection(stem: string): SichuanChoiceSection {
  const value = stem.toLowerCase();
  if (/(?:a:|b:|speaker|dialogue|conversation|对话|交际)/u.test(value)) {
    return "补全对话";
  }
  if (/(?:passage|according to|article|paragraph|本文|短文|阅读)/u.test(value)) {
    return "阅读理解";
  }
  if ((value.match(/_{2,}|＿{2,}|﹍{2,}/gu) || []).length >= 2) {
    return "完形填空";
  }
  if (/(?:choose (?:a )?sentence|选句|句子填空)/u.test(value)) {
    return "选句填空";
  }
  if (/(?:word bank|选词|词语填空)/u.test(value)) {
    return "选词填空";
  }
  return "词汇与语法结构";
}

function itemFromPair(pair: RawPair): TodayLearningItem | null {
  const parsed = parseChoiceBlock(pair.prompt);
  const responseAnswer = resolveAnswer(pair.response, parsed.choices);
  if (
    parsed.choices.length >= 2 &&
    responseAnswer &&
    parsed.choices.some(
      (choice) => choiceIdentity(choice) === choiceIdentity(responseAnswer),
    )
  ) {
    const explanation = cleanExplanation(pair.response);
    if (!explanation) return null;
    const answer = parsed.choices.find(
      (choice) => choiceIdentity(choice) === choiceIdentity(responseAnswer),
    )!;
    const stem = parsed.stem || pair.prompt;
    const identity = `${pair.source}|${pair.occurredAt}|${stem}|${answer}`;
    return {
      id: `history-${hashId(identity)}`,
      source: pair.source,
      occurredAt: pair.occurredAt,
      title: pair.title || shorten(stem),
      kind: "choice",
      stem,
      choices: parsed.choices,
      answer,
      explanation,
      knowledgePoint: answer,
      originLabel: pair.originLabel,
    };
  }

  const knowledgePoint = extractKnowledgeStatement(pair.response);
  if (!knowledgePoint) return null;
  const identity = `${pair.source}|${pair.occurredAt}|${pair.prompt}|${knowledgePoint}`;
  return {
    id: `history-${hashId(identity)}`,
    source: pair.source,
    occurredAt: pair.occurredAt,
    title: pair.title || shorten(pair.prompt),
    kind: "knowledge",
    stem: pair.prompt,
    choices: [],
    answer: knowledgePoint,
    explanation: cleanText(pair.response),
    knowledgePoint,
    originLabel: pair.originLabel,
  };
}

function splitNumberedQuestionBlocks(value: string) {
  const text = cleanText(value);
  const starts = [...text.matchAll(
    /(?:^|\n)\s*(?:第\s*)?\d{1,3}\s*(?:题|[.．、:：)）])\s*/gu,
  )];
  if (starts.length < 2) return [text];
  return starts
    .map((match, index) => {
      const start = match.index || 0;
      const end = starts[index + 1]?.index ?? text.length;
      return cleanText(text.slice(start, end));
    })
    .filter(Boolean);
}

function orderedAnswerLabels(value: string) {
  const normalized = normalizeOptionAlphabet(value);
  const numbered = [...normalized.matchAll(
    /(?:^|\n|\s)\s*(?:第\s*)?\d{1,3}\s*(?:题|[.．、:：)）])\s*(?:(?:正确答案|参考答案|答案|answer)\s*(?:是|为|[:：\-])*\s*)?([A-H])\b/giu,
  )].map((match) => match[1].toUpperCase());
  if (numbered.length) return numbered;
  return [...normalized.matchAll(
    /(?:正确答案|参考答案|答案|correct\s+answer)\s*(?:是|为|is|[:：\-])*\s*([A-H])\b/giu,
  )].map((match) => match[1].toUpperCase());
}

function itemsFromPair(pair: RawPair) {
  const promptBlocks = splitNumberedQuestionBlocks(pair.prompt)
    .filter((block) => parseChoiceBlock(block).choices.length >= 2);
  if (promptBlocks.length < 2) return [itemFromPair(pair)];

  const responseBlocks = splitNumberedQuestionBlocks(pair.response);
  const labels = orderedAnswerLabels(pair.response);
  if (labels.length < promptBlocks.length) return [itemFromPair(pair)];
  return promptBlocks.map((prompt, index) =>
    itemFromPair({
      ...pair,
      prompt,
      response: `答案：${
        responseBlocks.length === promptBlocks.length
          ? answerLabelFromText(responseBlocks[index]) ||
            orderedAnswerLabels(responseBlocks[index])[0] ||
            labels[index]
          : labels[index]
      }\n解析：${
        responseBlocks.length === promptBlocks.length
          ? responseBlocks[index]
          : pair.response
      }`,
      occurredAt: pair.occurredAt + index,
      title: `${pair.title || "组合题"} · 第 ${index + 1} 题`,
    }),
  );
}

function objectValue(
  value: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  return undefined;
}

function choicesFromUnknown(value: unknown) {
  if (Array.isArray(value)) return value.map(cleanChoice).filter(Boolean);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, choice]) => cleanChoice(choice))
      .filter(Boolean);
  }
  if (typeof value === "string") return parseChoiceBlock(value).choices;
  return [];
}

function itemFromObject(
  input: Record<string, unknown>,
  options: Required<ImportOptions>,
): TodayLearningItem | null {
  const rawTimestamp = objectValue(input, [
    "occurredAt",
    "createdAt",
    "create_time",
    "timestamp",
    "time",
    "date",
  ]);
  if (rawTimestamp === undefined || rawTimestamp === null || rawTimestamp === "") {
    return null;
  }
  const occurredAt = asTimestamp(rawTimestamp, Number.NaN);
  if (!Number.isFinite(occurredAt)) return null;
  const rawStem = cleanText(
    objectValue(input, ["stem", "question", "prompt", "query", "title"]),
  );
  const parsedBlock = parseChoiceBlock(rawStem);
  const choices = uniqueText([
    ...choicesFromUnknown(objectValue(input, ["choices", "options"])),
    ...parsedBlock.choices,
  ]);
  const rawAnswer = cleanText(
    objectValue(input, [
      "answer",
      "correctAnswer",
      "correct_answer",
      "correct",
    ]),
  );
  const response = cleanText(
    objectValue(input, [
      "explanation",
      "analysis",
      "rationale",
      "response",
      "assistant",
    ]),
  );
  const answer = resolveAnswer(rawAnswer || response, choices);
  const explicitKnowledge = cleanText(
    objectValue(input, [
      "knowledgePoint",
      "knowledge_point",
      "knowledge",
      "point",
    ]),
  );
  const source = (
    cleanText(input.source).toLowerCase() === "chatgpt"
      ? "chatgpt"
      : cleanText(input.source).toLowerCase() === "codex"
        ? "codex"
        : options.sourceHint
  ) as LearningSource;
  const stem = parsedBlock.stem || rawStem;
  const title = cleanText(input.title) || shorten(stem || explicitKnowledge);
  const originLabel = cleanText(input.originLabel) || options.originLabel;

  if (
    stem &&
    choices.length >= 2 &&
    answer &&
    choices.some((choice) => choiceIdentity(choice) === choiceIdentity(answer))
  ) {
    const resolved = choices.find(
      (choice) => choiceIdentity(choice) === choiceIdentity(answer),
    )!;
    const explanation = cleanExplanation(response);
    if (!explanation) return null;
    const identity = `${source}|${occurredAt}|${stem}|${resolved}`;
    return {
      id: `history-${hashId(identity)}`,
      source,
      occurredAt,
      title,
      kind: "choice",
      stem,
      choices,
      answer: resolved,
      explanation,
      knowledgePoint: explicitKnowledge || resolved,
      originLabel,
    };
  }

  const knowledgePoint =
    explicitKnowledge ||
    (rawAnswer && !/^[A-H]$/iu.test(rawAnswer) ? rawAnswer : "") ||
    extractKnowledgeStatement(response);
  if (!knowledgePoint || !stem) return null;
  const identity = `${source}|${occurredAt}|${stem}|${knowledgePoint}`;
  return {
    id: `history-${hashId(identity)}`,
    source,
    occurredAt,
    title,
    kind: "knowledge",
    stem,
    choices: [],
    answer: knowledgePoint,
    explanation: response || knowledgePoint,
    knowledgePoint,
    originLabel,
  };
}

function messageText(message: Record<string, unknown>) {
  const content = message.content;
  if (!content || typeof content !== "object") return "";
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return "";
  return cleanText(
    parts
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as Record<string, unknown>).text || "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n"),
  );
}

function pairsFromChatGPT(
  conversations: unknown[],
  options: Required<ImportOptions>,
) {
  const pairs: RawPair[] = [];
  conversations.forEach((rawConversation) => {
    if (!rawConversation || typeof rawConversation !== "object") return;
    const conversation = rawConversation as Record<string, unknown>;
    const mapping = conversation.mapping;
    if (!mapping || typeof mapping !== "object") return;
    const mappingRecord = mapping as Record<string, unknown>;
    const fallbackTime = asTimestamp(
      objectValue(conversation, ["create_time", "update_time"]),
      options.now,
    );
    const currentNodeId = cleanText(conversation.current_node);
    let orderedNodes = Object.values(mappingRecord);
    if (currentNodeId && mappingRecord[currentNodeId]) {
      const branch: unknown[] = [];
      const visited = new Set<string>();
      let nodeId = currentNodeId;
      while (nodeId && mappingRecord[nodeId] && !visited.has(nodeId)) {
        visited.add(nodeId);
        const node = mappingRecord[nodeId];
        branch.push(node);
        nodeId =
          node && typeof node === "object"
            ? cleanText((node as Record<string, unknown>).parent)
            : "";
      }
      if (branch.length) orderedNodes = branch.reverse();
    }
    const messages = orderedNodes
      .flatMap((rawNode, index) => {
        if (!rawNode || typeof rawNode !== "object") return [];
        const message = (rawNode as Record<string, unknown>).message;
        if (!message || typeof message !== "object") return [];
        const typed = message as Record<string, unknown>;
        const author = typed.author as Record<string, unknown> | undefined;
        const role = cleanText(author?.role).toLowerCase();
        if (role !== "user" && role !== "assistant") return [];
        const text = messageText(typed);
        if (!text) return [];
        return [{
          role,
          text,
          occurredAt: asTimestamp(
            objectValue(typed, ["create_time", "update_time"]),
            fallbackTime + index,
          ),
          index,
        }];
      })
      .sort((left, right) => (
        left.occurredAt - right.occurredAt || left.index - right.index
      ));

    let current:
      | { prompt: string; occurredAt: number; responses: string[] }
      | null = null;
    for (const message of messages) {
      if (message.role === "user") {
        if (current?.responses.length) {
          pairs.push({
            prompt: current.prompt,
            response: current.responses.join("\n\n"),
            occurredAt: current.occurredAt,
            title: cleanText(conversation.title),
            source: "chatgpt",
            originLabel: options.originLabel,
          });
        }
        current = {
          prompt: stripInjectedContext(message.text),
          occurredAt: message.occurredAt,
          responses: [],
        };
        continue;
      }
      if (current) current.responses.push(message.text);
    }
    if (current?.responses.length) {
      pairs.push({
        prompt: current.prompt,
        response: current.responses.join("\n\n"),
        occurredAt: current.occurredAt,
        title: cleanText(conversation.title),
        source: "chatgpt",
        originLabel: options.originLabel,
      });
    }
  });
  return pairs.filter((pair) => pair.prompt && pair.response);
}

function codexContentText(value: unknown) {
  if (!Array.isArray(value)) return "";
  return cleanText(
    value
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const typed = part as Record<string, unknown>;
        return cleanText(typed.text);
      })
      .filter(Boolean)
      .join("\n"),
  );
}

function pairsFromCodexRows(
  rows: Record<string, unknown>[],
  options: Required<ImportOptions>,
) {
  const meta = rows.find((row) => row.type === "session_meta")?.payload;
  if (meta && typeof meta === "object") {
    const source = (meta as Record<string, unknown>).source;
    if (
      source &&
      typeof source === "object" &&
      (source as Record<string, unknown>).subagent
    ) {
      return [] as RawPair[];
    }
  }

  const messages = rows.flatMap((row, index) => {
    if (row.type !== "response_item") return [];
    const payload = row.payload;
    if (!payload || typeof payload !== "object") return [];
    const typed = payload as Record<string, unknown>;
    if (typed.type !== "message") return [];
    const role = cleanText(typed.role).toLowerCase();
    if (role !== "user" && role !== "assistant") return [];
    const text = codexContentText(typed.content);
    if (!text) return [];
    return [{
      role,
      text,
      occurredAt: asTimestamp(row.timestamp, options.now + index),
    }];
  });

  const pairs: RawPair[] = [];
  let current:
    | { prompt: string; occurredAt: number; responses: string[] }
    | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      if (current?.responses.length) {
        pairs.push({
          prompt: current.prompt,
          response: current.responses.join("\n\n"),
          occurredAt: current.occurredAt,
          title: shorten(current.prompt),
          source: "codex",
          originLabel: options.originLabel,
        });
      }
      current = {
        prompt: stripInjectedContext(message.text),
        occurredAt: message.occurredAt,
        responses: [],
      };
      continue;
    }
    if (current) current.responses.push(message.text);
  }
  if (current?.responses.length) {
    pairs.push({
      prompt: current.prompt,
      response: current.responses.join("\n\n"),
      occurredAt: current.occurredAt,
      title: shorten(current.prompt),
      source: "codex",
      originLabel: options.originLabel,
    });
  }
  return pairs.filter(
    (pair) =>
      pair.prompt &&
      pair.response &&
      !/^<(?:codex_internal_context|environment_context)\b/iu.test(pair.prompt),
  );
}

function pairsFromPlainText(
  text: string,
  options: Required<ImportOptions>,
) {
  const rolePattern =
    /(?:^|\n)\s*(?:#{1,4}\s*)?(用户|user|human|提问|question|assistant|chatgpt|codex|助手|回答)\s*[:：]\s*/giu;
  const matches = [...text.matchAll(rolePattern)];
  const pairs: RawPair[] = [];
  if (matches.length >= 2) {
    let prompt = "";
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const role = match[1].toLowerCase();
      const content = cleanText(
        text.slice(
          (match.index || 0) + match[0].length,
          matches[index + 1]?.index ?? text.length,
        ),
      );
      const isUser = /^(?:用户|user|human|提问|question)$/iu.test(role);
      if (isUser) {
        prompt = stripInjectedContext(content);
      } else if (prompt && content) {
        pairs.push({
          prompt,
          response: content,
          occurredAt: options.now,
          title: shorten(prompt),
          source: options.sourceHint,
          originLabel: options.originLabel,
        });
        prompt = "";
      }
    }
    return pairs;
  }

  const blocks = text
    .split(/\n(?=\s*(?:#{1,4}\s*)?(?:题目|question)\s*[:：])/giu)
    .map(cleanText)
    .filter(Boolean);
  blocks.forEach((block) => {
    const question = block.match(
      /(?:^|\n)\s*(?:#{1,4}\s*)?(?:题目|question)\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:答案|answer|解析|explanation)\s*[:：]|$)/iu,
    )?.[1];
    const answer = block.match(
      /(?:^|\n)\s*(?:答案|answer)\s*[:：]\s*([^\n]+)/iu,
    )?.[1];
    const explanation = block.match(
      /(?:^|\n)\s*(?:解析|explanation|analysis)\s*[:：]\s*([\s\S]+)/iu,
    )?.[1];
    if (!question || !answer) return;
    pairs.push({
      prompt: cleanText(question),
      response: `答案：${cleanText(answer)}\n解析：${cleanText(explanation || answer)}`,
      occurredAt: options.now,
      title: shorten(question),
      source: options.sourceHint,
      originLabel: options.originLabel,
    });
  });
  return pairs;
}

function finalizeItems(
  candidateItems: Array<TodayLearningItem | null>,
  options: Required<ImportOptions>,
  originalCount: number,
  notices: string[] = [],
): LearningImportResult {
  const today = candidateItems
    .filter((item): item is TodayLearningItem => Boolean(item))
    .filter((item) =>
      isSameLocalDay(
        item.occurredAt,
        options.now,
        options.timezoneOffsetMinutes,
      ),
    );
  const seen = new Set<string>();
  const items = today.filter((item) => {
    const key = [
      item.source,
      normalizeAnswer(item.stem),
      choiceIdentity(item.answer),
    ].join("|");
    if (!normalizeAnswer(item.stem) || !choiceIdentity(item.answer) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return {
    items,
    skipped: Math.max(0, originalCount - items.length),
    notices,
  };
}

export function parseLearningImportText(
  value: string,
  inputOptions: ImportOptions = {},
): LearningImportResult {
  const options: Required<ImportOptions> = {
    now: inputOptions.now ?? Date.now(),
    timezoneOffsetMinutes:
      inputOptions.timezoneOffsetMinutes ??
      new Date(inputOptions.now ?? Date.now()).getTimezoneOffset(),
    sourceHint: inputOptions.sourceHint ?? "manual",
    originLabel: inputOptions.originLabel ?? "粘贴内容",
  };
  const text = cleanText(value);
  if (!text) return { items: [], skipped: 0, notices: ["没有可解析的内容。"] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (parsed !== undefined) {
    const root = parsed as Record<string, unknown>;
    const conversations = Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            item &&
            typeof item === "object" &&
            "mapping" in (item as Record<string, unknown>),
        )
      : Array.isArray(root?.conversations)
        ? root.conversations
        : [];
    if (conversations.length) {
      const pairs = pairsFromChatGPT(conversations, {
        ...options,
        sourceHint: "chatgpt",
      });
      return finalizeItems(
        pairs.flatMap(itemsFromPair),
        options,
        pairs.length,
      );
    }

    const rawItems = Array.isArray(parsed)
      ? parsed
      : Array.isArray(root?.items)
        ? root.items
        : [parsed];
    const objects = rawItems.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    );
    return finalizeItems(
      objects.map((item) => itemFromObject(item, options)),
      options,
      objects.length,
    );
  }

  const jsonLines = text
    .split("\n")
    .map((line) => {
      try {
        const row = JSON.parse(line);
        return row && typeof row === "object"
          ? (row as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    })
    .filter((row): row is Record<string, unknown> => Boolean(row));
  if (jsonLines.length >= 2) {
    const pairs = pairsFromCodexRows(jsonLines, {
      ...options,
      sourceHint: "codex",
    });
    if (!pairs.length) {
      return {
        items: [],
        skipped: 0,
        notices: ["已忽略 Codex 子代理/内部任务记录，未发现用户主任务题目。"],
      };
    }
    return finalizeItems(
      pairs.flatMap(itemsFromPair),
      options,
      pairs.length,
    );
  }

  const pairs = pairsFromPlainText(text, options);
  return finalizeItems(
    pairs.flatMap(itemsFromPair),
    options,
    pairs.length,
  );
}

export async function parseLearningImportFile(
  file: File,
  inputOptions: ImportOptions = {},
): Promise<LearningImportResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`${file.name} 超过 80 MB，请拆分后再导入。`);
  }
  const sourceHint = inputOptions.sourceHint ?? inferSource(file.name);
  const baseOptions = {
    ...inputOptions,
    sourceHint,
    originLabel: inputOptions.originLabel ?? file.name,
  };
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return parseLearningImportText(await file.text(), baseOptions);
  }

  const zipNotices: string[] = [];
  let archiveEntryCount = 0;
  let candidateEntryCount = 0;
  let expandedCandidateBytes = 0;
  const archiveBytes = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      archiveBytes,
      {
        filter: (entry) => {
          archiveEntryCount += 1;
          if (archiveEntryCount > MAX_ZIP_ENTRIES) {
            throw new Error("压缩包文件数量异常，已停止解析。");
          }
          const candidate =
            /(?:conversations?(?:-\d+)?\.json|\.jsonl|\.md|\.txt)$/iu.test(
              entry.name,
            );
          if (!candidate) return false;
          candidateEntryCount += 1;
          if (candidateEntryCount > MAX_ZIP_CANDIDATE_ENTRIES) {
            throw new Error("压缩包中的候选记录文件过多，请拆分后导入。");
          }
          if (entry.originalSize > MAX_IMPORT_BYTES) {
            zipNotices.push(`${entry.name} 展开后超过 80 MB，已跳过。`);
            return false;
          }
          expandedCandidateBytes += entry.originalSize;
          if (expandedCandidateBytes > MAX_ZIP_EXPANDED_BYTES) {
            throw new Error("压缩包展开后的记录超过 120 MB，请拆分后导入。");
          }
          return true;
        },
      },
      (error, data) => {
        if (error) reject(error);
        else resolve(data);
      },
    );
  });
  const candidateNames = Object.keys(entries)
    .filter((name) =>
      /(?:conversations?(?:-\d+)?\.json|\.jsonl|\.md|\.txt)$/iu.test(name),
    )
    .sort((left, right) => {
      const leftPriority = /conversations?(?:-\d+)?\.json$/iu.test(left) ? 0 : 1;
      const rightPriority = /conversations?(?:-\d+)?\.json$/iu.test(right) ? 0 : 1;
      return leftPriority - rightPriority || left.localeCompare(right);
    });
  if (!candidateNames.length) {
    return {
      items: [],
      skipped: 0,
      notices: [
        ...zipNotices,
        "压缩包中没有找到 conversations.json、JSONL、Markdown 或文本记录。",
      ],
    };
  }

  const combined: TodayLearningItem[] = [];
  const notices: string[] = [...zipNotices];
  let skipped = 0;
  for (const name of candidateNames) {
    const bytes = entries[name];
    if (bytes.byteLength > MAX_IMPORT_BYTES) {
      notices.push(`${name} 过大，已跳过。`);
      continue;
    }
    const result = parseLearningImportText(strFromU8(bytes), {
      ...baseOptions,
      sourceHint: inferSource(name, sourceHint),
      originLabel: `${file.name} / ${name}`,
    });
    combined.push(...result.items);
    skipped += result.skipped;
    notices.push(...result.notices);
  }

  const seen = new Set<string>();
  const items = combined.filter((item) => {
    const key = `${item.source}|${normalizeAnswer(item.stem)}|${choiceIdentity(item.answer)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    items,
    skipped: skipped + combined.length - items.length,
    notices,
  };
}

export function mergeTodayLearningItems(
  current: TodayLearningItem[],
  incoming: TodayLearningItem[],
) {
  const byIdentity = new Map<string, TodayLearningItem>();
  [...current, ...incoming].forEach((item) => {
    const key = `${item.source}|${normalizeAnswer(item.stem)}|${choiceIdentity(item.answer)}`;
    const existing = byIdentity.get(key);
    if (!existing || item.occurredAt > existing.occurredAt) {
      byIdentity.set(key, item);
    }
  });
  return [...byIdentity.values()].sort((left, right) => right.occurredAt - left.occurredAt);
}

export function learningItemPointId(item: Pick<TodayLearningItem, "id">) {
  return `learning-point-${item.id}`;
}

export function learningItemToKnowledgePoint(
  item: TodayLearningItem,
  confirmedClassification?: KnowledgeClassification,
): KnowledgePoint {
  const classification =
    confirmedClassification ||
    classifyKnowledge({ ...item, choices: item.choices });
  return {
    id: learningItemPointId(item),
    text: item.knowledgePoint || item.answer,
    context: item.explanation,
    explanation: item.explanation,
    question: item.stem,
    answerParts: [item.answer],
    sourceName: item.source === "chatgpt" ? "ChatGPT 今日记录" : item.source === "codex" ? "Codex 今日记录" : "手动导入",
    location: new Date(item.occurredAt).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    method: "history-import",
    createdAt: item.occurredAt,
    subject: classification.subject,
    knowledgeCategory: classification.category,
    classificationConfidence: classification.confidence,
    classificationVersion: KNOWLEDGE_TAXONOMY_VERSION,
    classificationSource: "auto",
  };
}

function answerParts(point: KnowledgePoint) {
  const explicit = (point.answerParts || []).map(cleanText).filter(Boolean);
  return explicit.length ? explicit : [cleanText(point.text)].filter(Boolean);
}

function answerShape(value: string) {
  if (/^-?\d+(?:\.\d+)?%?$/u.test(value.trim())) return "number";
  if (/^[a-z][a-z' -]*$/iu.test(value.trim())) return "english";
  if (/^[\u3400-\u9fff]/u.test(value.trim())) return "chinese";
  return "mixed";
}

function distractorsForAnswer(answer: string, pool: string[]) {
  const shape = answerShape(answer);
  return uniqueText(pool)
    .filter((candidate) => choiceIdentity(candidate) !== choiceIdentity(answer))
    .sort((left, right) => {
      const leftShape = answerShape(left) === shape ? 0 : 1;
      const rightShape = answerShape(right) === shape ? 0 : 1;
      return (
        leftShape - rightShape ||
        Math.abs(left.length - answer.length) - Math.abs(right.length - answer.length)
      );
    })
    .slice(0, 3);
}

function fillNonTargetBlanks(
  question: string,
  parts: string[],
  targetIndex: number,
) {
  let blankIndex = 0;
  return standardizeQuestionBlanks(question).replace(/______+/gu, () => {
    const current = blankIndex;
    blankIndex += 1;
    return current === targetIndex ? "______" : `「${parts[current] || "…" }」`;
  });
}

function makeFourChoices(answer: string, preferred: string[], pool: string[]) {
  const selected = uniqueText([
    ...preferred.filter(
      (choice) => choiceIdentity(choice) !== choiceIdentity(answer),
    ),
    ...distractorsForAnswer(answer, pool),
  ]).slice(0, 3);
  return selected.length === 3 ? [answer, ...selected] : [];
}

function deterministicShuffle<T>(values: T[], seed: string) {
  const copy = [...values];
  let state = Number.parseInt(hashId(seed), 36) || 1;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target = state % (index + 1);
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function buildTodayChoiceQuestionBank(
  items: TodayLearningItem[],
  points: KnowledgePoint[],
) {
  const documentPoints = points.filter((point) => point.method !== "history-import");
  const classifiedItems = items.map((item) => ({
    item,
    classification: classifyKnowledge({ ...item, choices: item.choices }),
  }));
  const classifiedDocumentPoints = documentPoints.map((point) => ({
    point,
    classification: classifyKnowledge(point),
  }));
  const answerPoolEntries = [
    ...classifiedItems.flatMap(({ item, classification }) =>
      [item.answer, item.knowledgePoint]
        .filter(Boolean)
        .map((answer) => ({ answer, classification }))
    ),
    ...classifiedDocumentPoints.flatMap(({ point, classification }) =>
      answerParts(point).map((answer) => ({ answer, classification }))
    ),
  ];
  const poolFor = (classification: KnowledgeClassification) =>
    uniqueText([
      ...answerPoolEntries
        .filter(({ classification: candidate }) =>
          candidate.subject === classification.subject &&
          candidate.category === classification.category
        )
        .map(({ answer }) => answer),
      ...answerPoolEntries
        .filter(({ classification: candidate }) =>
          candidate.subject === classification.subject &&
          candidate.category !== classification.category
        )
        .map(({ answer }) => answer),
    ]);
  const questions: TodayExamQuestion[] = [];

  classifiedItems.forEach(({ item, classification }) => {
    const preferred = item.choices.filter(
      (choice) => choiceIdentity(choice) !== choiceIdentity(item.answer),
    );
    const fourChoices = makeFourChoices(
      item.answer,
      preferred,
      poolFor(classification),
    );
    if (fourChoices.length !== 4 || !item.explanation.trim()) return;
    const recordTime = new Date(item.occurredAt).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const stem = item.kind === "choice"
      ? item.stem
      : `根据今天 ${recordTime} 的原问题“${shorten(item.stem, 72)}”，记录中归纳的核心知识点原文是哪一项？`;
    questions.push({
      id: `today-question-${item.id}`,
      pointId: learningItemPointId(item),
      type: "choice",
      stem,
      answer: item.answer,
      answerParts: [item.answer],
      choices: deterministicShuffle(fourChoices, item.id),
      explanation: item.explanation,
      section:
        classification.subject === "大学英语"
          ? classifySection(stem)
          : classification.category,
      subject: classification.subject,
      knowledgeCategory: classification.category,
      classificationConfidence: classification.confidence,
      sourceLabel:
        item.source === "chatgpt"
          ? "ChatGPT 今日记录"
          : item.source === "codex"
            ? "Codex 今日记录"
            : "手动导入",
      sourceItemId: item.id,
    });
  });

  classifiedDocumentPoints.forEach(
    ({ point, classification }, documentPointIndex) => {
    const parts = answerParts(point);
    if (!parts.length) return;
    const subjectPool = poolFor(classification);
    parts.forEach((answer, partIndex) => {
      const distractors = distractorsForAnswer(
        answer,
        subjectPool.filter((candidate) => !parts.some(
          (part) => choiceIdentity(part) === choiceIdentity(candidate),
        )),
      );
      if (distractors.length !== 3) return;
      const hasStructuredQuestion =
        Boolean(point.question?.trim()) &&
        (standardizeQuestionBlanks(point.question || "").match(/______+/gu) || []).length >=
          parts.length;
      const stem = hasStructuredQuestion
        ? fillNonTargetBlanks(point.question!, parts, partIndex)
        : `根据《${point.sourceName}》${point.location}的第 ${
            documentPointIndex + 1
          } 条提取记录，其中第 ${partIndex + 1} 个标红知识点原文是哪一项？`;
      const id = `document-choice-${point.id}-${partIndex}`;
      questions.push({
        id,
        pointId: point.id,
        type: "choice",
        stem,
        answer,
        answerParts: [answer],
        choices: deterministicShuffle([answer, ...distractors], id),
        explanation:
          point.explanation ||
          `完整答案：${parts.join("；")}。${
            point.context ? `题干依据：${point.context}` : ""
          }`,
        section:
          classification.subject === "大学英语"
            ? classifySection(stem)
            : classification.category,
        subject: classification.subject,
        knowledgeCategory: classification.category,
        classificationConfidence: classification.confidence,
        sourceLabel: `${point.sourceName} · ${point.location}`,
      });
    });
  });

  const seen = new Set<string>();
  return questions.filter((question) => {
    const key = `${normalizeAnswer(question.stem)}|${choiceIdentity(question.answer)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function selectTodayExamQuestions(
  bank: TodayExamQuestion[],
  count: number,
  seed = `${Date.now()}`,
) {
  const safeCount = Math.max(0, Math.min(Math.floor(count), bank.length));
  return deterministicShuffle(bank, seed).slice(0, safeCount).map((question) => ({
    ...question,
    choices: deterministicShuffle(question.choices, `${seed}-${question.id}`),
  }));
}

export const SICHUAN_CHOICE_EXAM_NOTE =
  "题型范围参照现行四川专升本《大学英语》考试要求中的客观选择题。本功能为自定题量专项训练，不等同于含主观题、满分 150 分的官方整卷。";

export const LEARNING_IMPORT_TEMPLATE = `{
  "items": [
    {
      "source": "chatgpt",
      "occurredAt": "${new Date().toISOString()}",
      "title": "语法：虚拟语气",
      "question": "If I ___ enough time, I would travel more.\\nA. have\\nB. had\\nC. will have\\nD. am having",
      "answer": "B",
      "explanation": "与现在事实相反的虚拟条件句，if 从句使用一般过去时。",
      "knowledgePoint": "与现在事实相反：If + 一般过去时，主句 would + 动词原形。"
    }
  ]
}`;
