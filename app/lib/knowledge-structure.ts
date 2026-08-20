export type TaggedDocumentLine = {
  text: string;
  redText?: string;
  location?: string;
};

export type StructuredQuestionAnswer = {
  question: string;
  answers: string[];
  rawAnswer: string;
  explanation?: string;
  startLine: number;
  endLine: number;
  usedRedLineIndexes: number[];
};

const QUESTION_NUMBER_PATTERN =
  /^\s*(?:[（(\[【]\s*)?(?:(?:第\s*)?(\d{1,3})|([一二三四五六七八九十百]+))\s*(?:[）)\]】]\s*|[.．、:：]\s*|题[.．、:：]?\s*)/u;

const BLANK_PATTERN =
  /_{2,}|＿{2,}|﹍{2,}|（\s*）|\(\s*\)|\[\s*\]|【\s*】/gu;

const EXPLANATION_PATTERN =
  /^(?:(?:答案解析|参考解析|解析|详解|说明|知识点|考点|重点说明|备注)\s*[:：]|[【\[（(]\s*(?:答案解析|参考解析|解析|详解|说明|知识点|考点|重点说明|备注)\s*[】\]）)])\s*/u;
const INLINE_EXPLANATION_PATTERN =
  /\s*(?:(?:答案解析|参考解析|解析|详解|说明|知识点|考点|重点说明|备注)\s*[:：]|[【\[（(]\s*(?:答案解析|参考解析|解析|详解|说明|知识点|考点|重点说明|备注)\s*[】\]）)])\s*/u;
const PAGE_FURNITURE_PATTERN =
  /^(?:第?\s*\d+\s*页|page\s*\d+|[-—–]\s*\d+\s*[-—–]|背诵清单|目录|章节目录|第\s*[一二三四五六七八九十百\d]+\s*(?:章|节|单元)|(?:chapter|unit|section|part)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b)(?:\s|$)/iu;

export function tidyStructureText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function compactStructureKey(value: string) {
  return tidyStructureText(value)
    .replace(/[_＿﹍\s，。；：、,.!?！？“”‘’'"（）()《》〈〉\[\]【】/／|]/gu, "")
    .toLowerCase();
}

export function countQuestionBlanks(value: string) {
  return Array.from(value.matchAll(BLANK_PATTERN)).length;
}

export function standardizeQuestionBlanks(value: string) {
  return tidyStructureText(value).replace(BLANK_PATTERN, "______");
}

export function stripQuestionNumber(value: string) {
  return value.replace(QUESTION_NUMBER_PATTERN, "").trim();
}

function cleanAnswerText(value: string) {
  return tidyStructureText(value)
    .replace(/^(?:参考)?答案\s*[:：]\s*/u, "")
    .replace(/^答\s*[:：]\s*/u, "")
    .trim();
}

export function splitAnswerParts(value: string, expectedCount = 0) {
  const answer = cleanAnswerText(value);
  if (!answer) return [];
  if (expectedCount <= 1) return [answer];

  const cleanParts = (values: string[]) =>
    values
      .map((part) => part.replace(/^[、,，]+|[、,，]+$/gu, "").trim())
      .filter(Boolean);

  const explicitParts = cleanParts(answer.split(/[；;|]+/u));
  if (explicitParts.length === expectedCount) return explicitParts;

  const punctuationParts = cleanParts(answer.split(/[、,，]+/u));
  if (punctuationParts.length === expectedCount) return punctuationParts;

  const parts = cleanParts(
    answer
    .split(/(?:[ \t]+|[；;|]+)/u)
  );

  if (!parts.length) return [answer];
  if (expectedCount > 0 && parts.length > expectedCount) {
    for (let index = parts.length - 2; index >= 1; index -= 1) {
      if (!/^[（(]?\d{1,3}[）)]?$/u.test(parts[index])) continue;
      parts.splice(index - 1, 3, `${parts[index - 1]}${parts[index + 1]}`);
      if (parts.length <= expectedCount) break;
    }
  }
  if (expectedCount > 1 && parts.length === 1) return [answer];
  return parts;
}

function withoutRedText(text: string, redText: string) {
  const cleanText = tidyStructureText(text);
  const cleanRed = tidyStructureText(redText);
  if (!cleanRed) return cleanText;
  if (cleanText === cleanRed) return "";
  const withoutRed = cleanText.includes(cleanRed)
    ? tidyStructureText(cleanText.replace(cleanRed, " "))
    : cleanText;
  return withoutRed
    .replace(new RegExp(`${INLINE_EXPLANATION_PATTERN.source}[\\s\\S]*$`, "u"), "")
    .replace(/(?:参考)?答案\s*[:：]\s*$/u, "")
    .replace(/答\s*[:：]\s*$/u, "")
    .trim();
}

export function isProbablePageFurniture(
  lines: TaggedDocumentLine[],
  index: number,
) {
  const line = lines[index];
  if (!line) return false;
  const text = tidyStructureText(line.text || line.redText || "");
  if (!text) return true;
  if (PAGE_FURNITURE_PATTERN.test(text)) return true;
  if (!line.location) return false;

  let locationStart = index;
  while (
    locationStart > 0 &&
    lines[locationStart - 1]?.location === line.location
  ) {
    locationStart -= 1;
  }
  if (index - locationStart > 1) return false;
  const key = compactStructureKey(text);
  if (key.length < 3) return false;
  const locations = new Set(
    lines
      .filter((candidate) => compactStructureKey(candidate.text) === key)
      .map((candidate) => candidate.location)
      .filter(Boolean),
  );
  return locations.size >= 2;
}

export function inferQuestionAnswerPairs(
  inputLines: TaggedDocumentLine[],
): StructuredQuestionAnswer[] {
  const lines = inputLines.map((line) => ({
    ...line,
    text: tidyStructureText(line.text),
    redText: tidyStructureText(line.redText || ""),
  }));
  const questionStarts: number[] = [];
  lines.forEach((line, index) => {
    if (QUESTION_NUMBER_PATTERN.test(line.text)) {
      questionStarts.push(index);
      return;
    }
    if (countQuestionBlanks(line.text) === 0) return;
    const previousStart = questionStarts.at(-1);
    const previousAlreadyAnswered =
      previousStart !== undefined &&
      lines
        .slice(previousStart, index)
        .some((candidate) => Boolean(candidate.redText));
    if (previousStart === undefined || previousAlreadyAnswered) {
      questionStarts.push(index);
    }
  });
  const pairs: StructuredQuestionAnswer[] = [];

  questionStarts.forEach((startLine, questionIndex) => {
    const endLine = (questionStarts[questionIndex + 1] ?? lines.length) - 1;
    const firstRedLine = lines.findIndex(
      (line, index) =>
        index >= startLine &&
        index <= endLine &&
        Boolean(line.redText) &&
        !isProbablePageFurniture(lines, index),
    );
    if (firstRedLine < startLine || firstRedLine > endLine) return;

    const questionLineEnd = firstRedLine === startLine ? firstRedLine + 1 : firstRedLine;
    const questionText = lines
      .slice(startLine, questionLineEnd)
      .map((line, relativeIndex) =>
        isProbablePageFurniture(lines, startLine + relativeIndex)
          ? ""
          : withoutRedText(line.text, line.redText || "")
      )
      .filter(Boolean)
      .join(" ");
    const question = standardizeQuestionBlanks(stripQuestionNumber(questionText));
    if (compactStructureKey(question).length < 2) return;

    const explanationStart = lines.findIndex(
      (line, index) =>
        index > firstRedLine &&
        index <= endLine &&
        !isProbablePageFurniture(lines, index) &&
        (EXPLANATION_PATTERN.test(line.text) ||
          EXPLANATION_PATTERN.test(line.redText || "")),
    );
    let inlineExplanation:
      | {
          lineIndex: number;
          answerCutIndex?: number;
          text: string;
        }
      | null = null;
    for (let index = firstRedLine; index <= endLine; index += 1) {
      if (isProbablePageFurniture(lines, index)) continue;
      const redMatch = (lines[index].redText || "").match(
        INLINE_EXPLANATION_PATTERN,
      );
      const textMatch = lines[index].text.match(INLINE_EXPLANATION_PATTERN);
      const match = redMatch || textMatch;
      if (!match) continue;
      const source = redMatch ? lines[index].redText || "" : lines[index].text;
      inlineExplanation = {
        lineIndex: index,
        ...(redMatch ? { answerCutIndex: match.index || 0 } : {}),
        text: tidyStructureText(
          source.slice((match.index || 0) + match[0].length),
        ),
      };
      break;
    }
    const answerEndLine =
      inlineExplanation
        ? inlineExplanation.lineIndex
        : explanationStart >= firstRedLine
          ? explanationStart - 1
          : endLine;
    const answerRedLineIndexes = lines.flatMap((line, index) =>
      index >= firstRedLine &&
      index <= answerEndLine &&
      line.redText &&
      !isProbablePageFurniture(lines, index)
        ? [index]
        : [],
    );
    const rawAnswer = cleanAnswerText(
      answerRedLineIndexes
        .map((index) => {
          const redText = lines[index].redText || "";
          return inlineExplanation?.lineIndex === index &&
            inlineExplanation.answerCutIndex !== undefined
            ? redText.slice(0, inlineExplanation.answerCutIndex)
            : redText;
        })
        .join(" "),
    );
    const blankCount = countQuestionBlanks(question);
    const answers = splitAnswerParts(rawAnswer, blankCount);
    if (!answers.length) return;
    if (blankCount > 0 && answers.length !== blankCount) return;

    const explanation = inlineExplanation
      ? tidyStructureText(
          [
            inlineExplanation.text,
            ...lines
              .slice(inlineExplanation.lineIndex + 1, endLine + 1)
              .filter(
                (_, relativeIndex) =>
                  !isProbablePageFurniture(
                    lines,
                    inlineExplanation!.lineIndex + 1 + relativeIndex,
                  ),
              )
              .map((line) => line.text || line.redText),
          ]
            .filter(Boolean)
            .join(" "),
        )
      : explanationStart >= firstRedLine
        ? tidyStructureText(
            lines
              .slice(explanationStart, endLine + 1)
              .filter(
                (_, relativeIndex) =>
                  !isProbablePageFurniture(
                    lines,
                    explanationStart + relativeIndex,
                  ),
              )
              .map((line) => line.text || line.redText)
              .filter(Boolean)
              .join(" "),
          ).replace(EXPLANATION_PATTERN, "").trim()
        : "";
    const usedRedLineIndexes = lines.flatMap((line, index) =>
      index >= firstRedLine &&
      index <= endLine &&
      line.redText &&
      !isProbablePageFurniture(lines, index)
        ? [index]
        : [],
    );

    pairs.push({
      question,
      answers,
      rawAnswer,
      ...(explanation ? { explanation } : {}),
      startLine,
      endLine,
      usedRedLineIndexes,
    });
  });

  return pairs;
}

function matchScore(line: string, fragment: string) {
  const lineKey = compactStructureKey(line);
  const fragmentKey = compactStructureKey(fragment);
  if (!lineKey || !fragmentKey) return 0;
  if (lineKey === fragmentKey) return 1;
  if (lineKey.includes(fragmentKey)) return fragmentKey.length / lineKey.length;
  if (fragmentKey.includes(lineKey)) return (lineKey.length / fragmentKey.length) * 0.9;
  return 0;
}

export function tagLinesWithRedFragments(
  fullText: string,
  redFragments: string[],
): TaggedDocumentLine[] {
  const lines = tidyStructureText(fullText)
    .split(/\n+/u)
    .map((text) => ({ text: tidyStructureText(text), fragments: [] as string[] }))
    .filter((line) => Boolean(line.text));

  redFragments
    .map(tidyStructureText)
    .filter(Boolean)
    .forEach((fragment) => {
      let bestIndex = -1;
      let bestScore = 0;
      lines.forEach((line, index) => {
        const score = matchScore(line.text, fragment);
        if (score > bestScore) {
          bestIndex = index;
          bestScore = score;
        }
      });
      if (bestIndex >= 0 && bestScore >= 0.32) lines[bestIndex].fragments.push(fragment);
    });

  return lines.map((line) => {
    if (!line.fragments.length) return { text: line.text };
    const joinedFragments = line.fragments.join(" ");
    const lineKey = compactStructureKey(line.text);
    const fragmentKey = compactStructureKey(joinedFragments);
    const useWholeLine =
      lineKey === fragmentKey ||
      (!QUESTION_NUMBER_PATTERN.test(line.text) &&
        fragmentKey.length >= Math.max(2, Math.round(lineKey.length * 0.55)));
    return {
      text: line.text,
      redText: useWholeLine ? cleanAnswerText(line.text) : joinedFragments,
    };
  });
}
