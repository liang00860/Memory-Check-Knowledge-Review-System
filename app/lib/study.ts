import type { KnowledgePoint } from "./document-parser";
import { standardizeQuestionBlanks } from "./knowledge-structure";
import {
  classifyKnowledge,
  type StudySubject,
} from "./knowledge-taxonomy";

export const REVIEW_INTERVALS = [
  { label: "10 分钟", milliseconds: 10 * 60 * 1000 },
  { label: "1 天", milliseconds: 24 * 60 * 60 * 1000 },
  { label: "2 天", milliseconds: 2 * 24 * 60 * 60 * 1000 },
  { label: "4 天", milliseconds: 4 * 24 * 60 * 60 * 1000 },
  { label: "7 天", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: "15 天", milliseconds: 15 * 24 * 60 * 60 * 1000 },
  { label: "30 天", milliseconds: 30 * 24 * 60 * 60 * 1000 },
] as const;

export type ReviewRecord = {
  pointId: string;
  stage: number;
  nextReviewAt: number;
  attempts: number;
  correct: number;
  wrong: number;
  lastReviewedAt: number | null;
  lastCorrect: boolean | null;
};

export type Attempt = {
  id: string;
  pointId: string;
  correct: boolean;
  answer: string;
  createdAt: number;
  questionId?: string;
  sessionKind?: "study" | "today";
  gradingDecision?:
    | "exact"
    | "alias"
    | "strict"
    | "self-accepted"
    | "self-rejected";
  similarity?: number;
};

export type Question = {
  id: string;
  pointId: string;
  type: "fill" | "choice";
  stem: string;
  answer: string;
  choices: string[];
  answerParts?: string[];
  explanation?: string;
  section?: string;
  sourceLabel?: string;
  sourceItemId?: string;
  subject?: StudySubject;
  knowledgeCategory?: string;
  classificationConfidence?: number;
};

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function normalizeAnswer(value: string) {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t\n]+/gu, " ");
  if (/[a-z0-9]/iu.test(normalized)) {
    return normalized
      .replace(/[，。；：、!?！？”“’（）()《》〈〉[\]【】]/gu, "")
      .trim();
  }
  return normalized.replace(
    /[\s，。；：、,.!?！？“”‘’'"（）()《》〈〉[\]【】]/gu,
    "",
  );
}

const MEANING_REPLACEMENTS: Array<[RegExp, string]> = [
  [/不可以|不能够|无法/gu, "不能"],
  [/可以|能够/gu, "能"],
  [/仅仅|仅能|只可/gu, "只能"],
  [/不会/gu, "不"],
  [/读取|读出/gu, "读"],
  [/写入/gu, "写"],
  [/只能(?=读.*不能写)/gu, "能"],
  [/但(?:是)?/gu, ""],
  [/构成/gu, "组成"],
  [/丢失|消失/gu, "丢"],
  [/保存|保留/gu, "存"],
  [/增长|提升|增大/gu, "增加"],
  [/降低|下降|减小/gu, "减少"],
  [/与|及/gu, "和"],
  [/输入装置/gu, "输入设备"],
  [/输出装置/gu, "输出设备"],
  [/进行|加以|主要|就是|指的是|负责|执行|做/gu, ""],
  [/\b(?:stores?|keeps?|retains?)\b/giu, "save"],
  [/\btemporarily\b/giu, "temporary"],
  [/\b(?:allows?|permits?)\b/giu, "allow"],
];

const MEANING_ALIAS_GROUPS = [
  ["cpu", "中央处理器"],
  ["os", "操作系统"],
  ["ram", "随机存储器"],
  ["rom", "只读存储器"],
  ["cache", "高速缓冲存储器"],
  ["io设备", "输入输出设备", "inputoutputdevice"],
] as const;

function normalizeMeaning(value: string) {
  let normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\binput\s*\/?\s*output\b/giu, "io")
    .replace(/只读(?:存储器)?/gu, "只能读不能写存储器");
  MEANING_REPLACEMENTS.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });
  return normalized
    .replace(/[的了着过在于对把将而并其这该一个一种中为以所]/gu, "")
    .replace(/[\s，。；：、,!?！？“”‘’'"（）()《》〈〉[\]【】_]/gu, "")
    .trim();
}

function meaningAlias(value: string) {
  const normalized = normalizeMeaning(value);
  const groupIndex = MEANING_ALIAS_GROUPS.findIndex((group) =>
    group.some((candidate) => normalizeMeaning(candidate) === normalized)
  );
  return groupIndex >= 0 ? `alias-${groupIndex}` : "";
}

function setDice(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  left.forEach((value) => {
    if (right.has(value)) shared += 1;
  });
  return (2 * shared) / (left.size + right.size);
}

function setCoverage(expected: Set<string>, submitted: Set<string>) {
  if (!expected.size) return 0;
  let shared = 0;
  expected.forEach((value) => {
    if (submitted.has(value)) shared += 1;
  });
  return shared / expected.size;
}

function semanticUnits(value: string) {
  const units = new Set<string>();
  (value.match(/[a-z]+|\d+(?:\.\d+)?/giu) || []).forEach((token) => {
    units.add(
      token
        .replace(/(?:ing|ed|es|s)$/u, "")
        .replace(/(?:tion|ment)$/u, ""),
    );
  });
  (value.match(/[\u3400-\u9fff]/gu) || []).forEach((character) =>
    units.add(character)
  );
  return units;
}

function semanticBigrams(value: string) {
  const compact = value.replace(/\s/gu, "");
  const bigrams = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    bigrams.add(compact.slice(index, index + 2));
  }
  return bigrams;
}

const OPPOSITE_FACT_PAIRS = [
  ["增加", "减少"],
  ["上升", "下降"],
  ["输入", "输出"],
  ["输入设备", "输出设备"],
  ["递增", "递减"],
  ["运算器", "控制器"],
  ["内存", "外存"],
  ["系统软件", "应用软件"],
  ["随机存储器", "只读存储器"],
  ["ram", "rom"],
  ["串行", "并行"],
  ["正确", "错误"],
  ["真", "假"],
  ["快", "慢"],
  ["高", "低"],
  ["大", "小"],
] as const;

const POLARITY_TERMS = [
  "读",
  "写",
  "丢",
  "存",
  "允许",
  "增加",
  "减少",
  "输入",
  "输出",
  "递增",
  "递减",
] as const;

function termPolarities(value: string, term: string) {
  const polarities = new Set<"positive" | "negative">();
  let start = 0;
  while (start < value.length) {
    const index = value.indexOf(term, start);
    if (index < 0) break;
    const prefix = value.slice(Math.max(0, index - 3), index);
    polarities.add(/不|无|非|未|否|禁止/gu.test(prefix) ? "negative" : "positive");
    start = index + term.length;
  }
  return polarities;
}

function hasCriticalContradiction(submitted: string, expected: string) {
  for (const [left, right] of OPPOSITE_FACT_PAIRS) {
    const expectedLeft = expected.includes(left);
    const expectedRight = expected.includes(right);
    const submittedLeft = submitted.includes(left);
    const submittedRight = submitted.includes(right);
    if (
      expectedLeft !== expectedRight &&
      submittedLeft !== submittedRight &&
      expectedLeft !== submittedLeft
    ) return true;
  }
  if (
    (expected.includes("和") && !expected.includes("或") && submitted.includes("或")) ||
    (expected.includes("或") && !expected.includes("和") && submitted.includes("和"))
  ) return true;

  for (const term of POLARITY_TERMS) {
    const expectedPolarities = termPolarities(expected, term);
    const submittedPolarities = termPolarities(submitted, term);
    if (
      expectedPolarities.size === 1 &&
      submittedPolarities.size === 1 &&
      [...expectedPolarities][0] !== [...submittedPolarities][0]
    ) return true;
  }
  const comparisonPattern = /[<>≤≥=]-?\d+(?:\.\d+)?/gu;
  const expectedComparisons = expected.match(comparisonPattern) || [];
  const submittedComparisons = submitted.match(comparisonPattern) || [];
  if (
    expectedComparisons.length &&
    expectedComparisons.join("|") !== submittedComparisons.join("|")
  ) return true;
  return false;
}

export function answerMeaningSimilarity(submitted: string, expected: string) {
  const submittedMeaning = normalizeMeaning(submitted);
  const expectedMeaning = normalizeMeaning(expected);
  if (!submittedMeaning || !expectedMeaning) return 0;
  if (submittedMeaning === expectedMeaning) return 1;

  const submittedAlias = meaningAlias(submitted);
  const expectedAlias = meaningAlias(expected);
  if (submittedAlias && submittedAlias === expectedAlias) return 1;

  const expectedNegated = /不|无|非|未|否|没|禁止/gu.test(expectedMeaning);
  const submittedNegated = /不|无|非|未|否|没|禁止/gu.test(submittedMeaning);
  if (expectedNegated !== submittedNegated) return 0;
  if (hasCriticalContradiction(submittedMeaning, expectedMeaning)) return 0;
  const expectedNumbers = expectedMeaning.match(/[+-]?\d+(?:\.\d+)?/gu) || [];
  const submittedNumbers = submittedMeaning.match(/[+-]?\d+(?:\.\d+)?/gu) || [];
  if (expectedNumbers.join("|") !== submittedNumbers.join("|")) return 0;
  if (Math.min(expectedMeaning.length, submittedMeaning.length) < 4) return 0;

  const expectedUnits = semanticUnits(expectedMeaning);
  const submittedUnits = semanticUnits(submittedMeaning);
  const expectedCoverage = setCoverage(expectedUnits, submittedUnits);
  const submittedCoverage = setCoverage(submittedUnits, expectedUnits);
  const unitDice = setDice(expectedUnits, submittedUnits);
  const bigramDice = setDice(
    semanticBigrams(expectedMeaning),
    semanticBigrams(submittedMeaning),
  );
  const lengthRatio =
    Math.min(expectedMeaning.length, submittedMeaning.length) /
    Math.max(expectedMeaning.length, submittedMeaning.length);
  const score =
    expectedCoverage * 0.36 +
    submittedCoverage * 0.16 +
    unitDice * 0.24 +
    bigramDice * 0.16 +
    lengthRatio * 0.08;
  const contained =
    expectedMeaning.includes(submittedMeaning) ||
    submittedMeaning.includes(expectedMeaning);
  if (
    expectedCoverage < 0.72 ||
    submittedCoverage < 0.58 ||
    (!contained && bigramDice < 0.34)
  ) return 0;
  return Number(score.toFixed(3));
}

export function isMeaningClose(submitted: string, expected: string) {
  const submittedAlias = meaningAlias(submitted);
  const expectedAlias = meaningAlias(expected);
  if (submittedAlias && submittedAlias === expectedAlias) return true;
  if (/[a-z]/iu.test(submitted) || /[a-z]/iu.test(expected)) return false;
  const submittedMeaning = normalizeMeaning(submitted);
  const expectedMeaning = normalizeMeaning(expected);
  return Boolean(
    submittedMeaning &&
    expectedMeaning &&
    submittedMeaning === expectedMeaning,
  );
}

export type AnswerGrade = {
  verdict: "correct" | "incorrect" | "needs-confirmation";
  reason: string;
  similarity: number;
  decision: "exact" | "alias" | "strict";
};

function normalizeChoiceValue(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .trim();
}

function gradeSingleAnswer(
  submitted: string,
  expected: string,
  permitsMeaningMatch: boolean,
): AnswerGrade {
  const exactMatch = permitsMeaningMatch
    ? /[a-z]/iu.test(submitted) || /[a-z]/iu.test(expected)
      ? normalizeChoiceValue(submitted) === normalizeChoiceValue(expected)
      : normalizeAnswer(submitted) === normalizeAnswer(expected)
    : normalizeChoiceValue(submitted) === normalizeChoiceValue(expected);
  if (exactMatch) {
    return {
      verdict: "correct",
      reason: permitsMeaningMatch ? "与参考答案一致" : "选项精确匹配",
      similarity: 1,
      decision: permitsMeaningMatch ? "exact" : "strict",
    };
  }
  if (!permitsMeaningMatch) {
    return {
      verdict: "incorrect",
      reason: "所选选项与正确选项不一致",
      similarity: 0,
      decision: "strict",
    };
  }
  if (isMeaningClose(submitted, expected)) {
    return {
      verdict: "correct",
      reason: "命中本地明确同义词或缩写规则",
      similarity: 1,
      decision: "alias",
    };
  }
  const similarity = answerMeaningSimilarity(submitted, expected);
  if (similarity >= 0.62) {
    return {
      verdict: "needs-confirmation",
      reason: "字面较接近，但本地规则无法安全判断关键关系是否一致",
      similarity,
      decision: "alias",
    };
  }
  return {
    verdict: "incorrect",
    reason: "与参考答案的关键内容不一致",
    similarity,
    decision: "strict",
  };
}

export function gradeAnswer(
  value: string,
  question: Pick<Question, "answer" | "answerParts"> &
    Partial<Pick<Question, "type">>,
): AnswerGrade {
  const permitsMeaningMatch = question.type !== "choice";
  const gradeExpected = (submitted: string, expected: string) => {
    const slashParts = expected
      .split(/[\/／|]/u)
      .map((part) => part.trim())
      .filter(Boolean);
    const isFraction =
      slashParts.length === 2 &&
      slashParts.every((part) => /^[+-]?\d+(?:\.\d+)?$/u.test(part));
    const isSimpleAlgebra =
      slashParts.length === 2 &&
      slashParts.every((part) => /^[a-z](?:\^\d+)?$/iu.test(part));
    const isProtocolPair =
      slashParts.length === 2 &&
      slashParts.every((part) => /^[A-Z][A-Z0-9.+-]{1,7}$/u.test(part));
    const alternatives =
      slashParts.length < 2 ||
      isFraction ||
      isSimpleAlgebra ||
      isProtocolPair
        ? [expected]
        : slashParts;
    const grades = alternatives
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .map((candidate) =>
        gradeSingleAnswer(submitted, candidate, permitsMeaningMatch)
      );
    return (
      grades.find((grade) => grade.verdict === "correct") ||
      grades.find((grade) => grade.verdict === "needs-confirmation") ||
      grades[0] || {
        verdict: "incorrect",
        reason: "参考答案为空",
        similarity: 0,
        decision: "strict",
      }
    ) as AnswerGrade;
  };

  const expectedParts = (question.answerParts || [])
    .map((part) => part.trim())
    .filter(Boolean);
  if (expectedParts.length <= 1) {
    return gradeExpected(value, expectedParts[0] || question.answer);
  }

  const explicitParts = value
    .split(/[；;\n|]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const whitespaceParts = value
    .trim()
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const submittedParts =
    explicitParts.length === expectedParts.length
      ? explicitParts
      : whitespaceParts.length === expectedParts.length
        ? whitespaceParts
        : [];
  if (submittedParts.length !== expectedParts.length) {
    return {
      verdict: "incorrect",
      reason: `需要按顺序填写 ${expectedParts.length} 个答案`,
      similarity: 0,
      decision: "strict",
    };
  }

  const grades = expectedParts.map((expected, index) =>
    gradeExpected(submittedParts[index], expected)
  );
  const incorrect = grades.find((grade) => grade.verdict === "incorrect");
  if (incorrect) return incorrect;
  const uncertain = grades.find(
    (grade) => grade.verdict === "needs-confirmation",
  );
  if (uncertain) {
    return {
      ...uncertain,
      similarity: Math.min(...grades.map((grade) => grade.similarity)),
    };
  }
  return {
    verdict: "correct",
    reason: "各空均与参考答案一致",
    similarity: 1,
    decision: grades.some((grade) => grade.decision === "alias")
      ? "alias"
      : "exact",
  };
}

function pointAnswerParts(point: KnowledgePoint) {
  const parts = (point.answerParts || [])
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [point.text.trim()].filter(Boolean);
}

function pointAnswer(point: KnowledgePoint) {
  return pointAnswerParts(point).join("；");
}

function blankStem(point: KnowledgePoint) {
  if (point.question?.trim()) return standardizeQuestionBlanks(point.question);
  const answer = pointAnswer(point);
  const context = point.context.trim();
  if (context && context !== answer && context.includes(answer)) {
    return context.split(answer).join(" ______ ");
  }
  return `根据《${point.sourceName}》${point.location}的标红内容，写出完整知识点：______`;
}

function distractorsFor(point: KnowledgePoint, all: KnowledgePoint[]) {
  const answer = pointAnswer(point);
  const seen = new Set([normalizeAnswer(answer)]);
  return all
    .filter((candidate) => {
      if (pointAnswerParts(candidate).length !== 1) return false;
      const key = normalizeAnswer(pointAnswer(candidate));
      if (candidate.id === point.id || !key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (
      Math.abs(pointAnswer(a).length - answer.length) -
      Math.abs(pointAnswer(b).length - answer.length)
    ))
    .slice(0, 3)
    .map(pointAnswer);
}

export function buildQuestions(points: KnowledgePoint[], limit = points.length) {
  const validPoints = points.filter((point) => normalizeAnswer(pointAnswer(point)));
  const source = shuffle(validPoints).slice(0, limit);
  return source.map((point, index): Question => {
    const answerParts = pointAnswerParts(point);
    const answer = answerParts.join("；");
    const distractors = distractorsFor(point, validPoints);
    const classification = classifyKnowledge(point);
    const useChoice =
      answerParts.length === 1 &&
      distractors.length === 3 &&
      index % 2 === 1;
    return {
      id: makeId(),
      pointId: point.id,
      type: useChoice ? "choice" : "fill",
      stem: blankStem(point),
      answer,
      answerParts,
      choices: useChoice ? shuffle([answer, ...distractors]) : [],
      explanation: point.explanation || `完整答案：${answer}`,
      subject: classification.subject,
      knowledgeCategory: classification.category,
      classificationConfidence: classification.confidence,
    };
  });
}

export function isAnswerCorrect(
  value: string,
  question: Pick<Question, "answer" | "answerParts"> &
    Partial<Pick<Question, "type">>,
) {
  return gradeAnswer(value, question).verdict === "correct";
}

export function initialRecord(pointId: string): ReviewRecord {
  return {
    pointId,
    stage: 0,
    nextReviewAt: Date.now(),
    attempts: 0,
    correct: 0,
    wrong: 0,
    lastReviewedAt: null,
    lastCorrect: null,
  };
}

export function updateRecord(
  record: ReviewRecord,
  correct: boolean,
  now = Date.now(),
  canAdvance = true,
) {
  const firstAttempt = record.attempts === 0;
  const nextStage = correct
    ? firstAttempt
      ? 0
      : canAdvance
        ? Math.min(record.stage + 1, REVIEW_INTERVALS.length - 1)
        : record.stage
    : 0;
  const keepExistingSchedule = correct && !firstAttempt && !canAdvance;
  return {
    ...record,
    stage: nextStage,
    attempts: record.attempts + 1,
    correct: record.correct + (correct ? 1 : 0),
    wrong: record.wrong + (correct ? 0 : 1),
    lastReviewedAt: now,
    lastCorrect: correct,
    nextReviewAt: keepExistingSchedule
      ? record.nextReviewAt
      : now + REVIEW_INTERVALS[nextStage].milliseconds,
  };
}

export function formatDue(timestamp: number, now = Date.now()) {
  const difference = timestamp - now;
  if (difference <= 0) return "现在";
  const minutes = Math.ceil(difference / 60000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.ceil(hours / 24)} 天后`;
}
