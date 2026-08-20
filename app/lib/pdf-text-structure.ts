import type { TaggedDocumentLine } from "./knowledge-structure";

export type PdfTextItemLike = Record<string, unknown>;

export type PdfOperatorListLike = {
  fnArray: number[];
  argsArray: unknown[];
};

export type PdfRedTextMark = {
  text: string;
  x: number;
  y: number;
};

type Matrix = [number, number, number, number, number, number];

const RED_THRESHOLD = {
  minimum: 145,
  dominance: 1.35,
  maximumOther: 150,
};

function channel(value: number) {
  return value <= 1 ? Math.round(value * 255) : Math.round(value);
}

export function isRedColor(rgb: [number, number, number]) {
  const [rawR, rawG, rawB] = rgb;
  const r = channel(rawR);
  const g = channel(rawG);
  const b = channel(rawB);
  return (
    r >= RED_THRESHOLD.minimum &&
    g <= RED_THRESHOLD.maximumOther &&
    b <= RED_THRESHOLD.maximumOther &&
    r >= g * RED_THRESHOLD.dominance &&
    r >= b * RED_THRESHOLD.dominance
  );
}

function flattenNumbers(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  if (Array.isArray(value)) return value.flatMap(flattenNumbers);
  return [];
}

export function pdfColorFromArgs(args: unknown): [number, number, number] {
  const firstValue = Array.isArray(args) ? args[0] : args;
  if (typeof firstValue === "string" && /^#[0-9a-f]{6}$/i.test(firstValue)) {
    return [
      Number.parseInt(firstValue.slice(1, 3), 16),
      Number.parseInt(firstValue.slice(3, 5), 16),
      Number.parseInt(firstValue.slice(5, 7), 16),
    ];
  }
  const values = flattenNumbers(args);
  return [values[0] || 0, values[1] || 0, values[2] || 0];
}

function glyphText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((glyph) => {
      if (typeof glyph === "string") return glyph;
      if (typeof glyph === "number") return glyph < -120 ? " " : "";
      if (glyph && typeof glyph === "object" && "unicode" in glyph) {
        return String((glyph as { unicode?: string }).unicode || "");
      }
      return "";
    })
    .join("");
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function point(matrix: Matrix, x: number, y: number) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

export function extractRedOperatorMarks(
  opList: PdfOperatorListLike,
  ops: Record<string, number>,
) {
  let fill: [number, number, number] = [0, 0, 0];
  let transform: Matrix = [1, 0, 0, 1, 0, 0];
  let textMatrix: Matrix = [1, 0, 0, 1, 0, 0];
  let leading = 0;
  let textRise = 0;
  const stack: Array<{
    fill: [number, number, number];
    transform: Matrix;
    textMatrix: Matrix;
    leading: number;
    textRise: number;
  }> = [];
  const marks: PdfRedTextMark[] = [];

  opList.fnArray.forEach((fn, index) => {
    const args = opList.argsArray[index];
    if (fn === ops.save) {
      stack.push({
        fill: [...fill],
        transform: [...transform],
        textMatrix: [...textMatrix],
        leading,
        textRise,
      });
      return;
    }
    if (fn === ops.restore) {
      const restored = stack.pop();
      if (restored) {
        fill = restored.fill;
        transform = restored.transform;
        textMatrix = restored.textMatrix;
        leading = restored.leading;
        textRise = restored.textRise;
      }
      return;
    }
    if (fn === ops.transform) {
      const values = flattenNumbers(args);
      if (values.length >= 6) {
        transform = multiply(transform, values.slice(0, 6) as Matrix);
      }
      return;
    }
    if (fn === ops.setFillRGBColor) {
      fill = pdfColorFromArgs(args);
      return;
    }
    if (fn === ops.setFillGray) {
      const [gray = 0] = flattenNumbers(args);
      fill = [gray, gray, gray];
      return;
    }
    if (fn === ops.setFillCMYKColor) {
      const [c = 0, m = 0, y = 0, k = 0] = flattenNumbers(args).map((item) =>
        item > 1 ? item / 255 : item,
      );
      fill = [
        255 * (1 - Math.min(1, c * (1 - k) + k)),
        255 * (1 - Math.min(1, m * (1 - k) + k)),
        255 * (1 - Math.min(1, y * (1 - k) + k)),
      ];
      return;
    }
    if (fn === ops.beginText) {
      textMatrix = [1, 0, 0, 1, 0, 0];
      return;
    }
    if (fn === ops.setTextMatrix) {
      const values = flattenNumbers(args);
      if (values.length >= 6) textMatrix = values.slice(0, 6) as Matrix;
      return;
    }
    if (fn === ops.moveText || fn === ops.setLeadingMoveText) {
      const [x = 0, y = 0] = flattenNumbers(args);
      textMatrix = [
        textMatrix[0],
        textMatrix[1],
        textMatrix[2],
        textMatrix[3],
        textMatrix[4] + x,
        textMatrix[5] + y,
      ];
      if (fn === ops.setLeadingMoveText) leading = -y;
      return;
    }
    if (fn === ops.setLeading) {
      [leading = 0] = flattenNumbers(args);
      return;
    }
    if (fn === ops.setTextRise) {
      [textRise = 0] = flattenNumbers(args);
      return;
    }
    if (
      fn === ops.nextLine ||
      fn === ops.nextLineShowText ||
      fn === ops.nextLineSetSpacingShowText
    ) {
      textMatrix = [
        textMatrix[0],
        textMatrix[1],
        textMatrix[2],
        textMatrix[3],
        textMatrix[4],
        textMatrix[5] - leading,
      ];
    }

    const showsText =
      fn === ops.showText ||
      fn === ops.showSpacedText ||
      fn === ops.nextLineShowText ||
      fn === ops.nextLineSetSpacingShowText;
    if (!showsText || !isRedColor(fill)) return;

    const values = Array.isArray(args) ? args : [args];
    const text = glyphText(
      fn === ops.nextLineSetSpacingShowText ? values[2] : values[0],
    ).trim();
    if (!text) return;
    const origin = point(transform, textMatrix[4], textMatrix[5] + textRise);
    marks.push({ text, x: origin.x, y: origin.y });
  });

  return marks;
}

type PositionedTextItem = {
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  red: boolean;
};

function positionedItems(
  items: PdfTextItemLike[],
  redIndexes: ReadonlySet<number>,
) {
  return items.flatMap((item, index): PositionedTextItem[] => {
    const text = String(item.str || "");
    const transform = item.transform as number[] | undefined;
    if (!text || !transform || transform.length < 6) return [];
    return [{
      index,
      text,
      x: Number(transform[4]) || 0,
      y: Number(transform[5]) || 0,
      width: Math.max(0, Number(item.width) || 0),
      height: Math.max(
        0,
        Number(item.height) || Math.abs(Number(transform[3]) || 0),
      ),
      red: redIndexes.has(index),
    }];
  });
}

export function redItemIndexesFromMarks(
  items: PdfTextItemLike[],
  marks: PdfRedTextMark[],
) {
  const positioned = positionedItems(items, new Set());
  const redIndexes = new Set<number>();

  for (const mark of marks) {
    let best: { index: number; score: number } | null = null;
    for (const item of positioned) {
      if (!item.text.trim()) continue;
      const yTolerance = Math.max(2.5, item.height * 0.55);
      if (Math.abs(item.y - mark.y) > yTolerance) continue;
      const xTolerance = Math.max(2.5, item.height * 0.45);
      if (mark.x < item.x - xTolerance || mark.x > item.x + item.width + xTolerance) {
        continue;
      }
      const markKey = mark.text.replace(/\s+/g, "").toLowerCase();
      const itemKey = item.text.replace(/\s+/g, "").toLowerCase();
      const textPenalty =
        markKey && itemKey && (itemKey.includes(markKey) || markKey.includes(itemKey))
          ? 0
          : 8;
      const xDistance =
        mark.x < item.x
          ? item.x - mark.x
          : mark.x > item.x + item.width
            ? mark.x - item.x - item.width
            : 0;
      const score = Math.abs(item.y - mark.y) * 3 + xDistance + textPenalty;
      if (!best || score < best.score) best = { index: item.index, score };
    }
    if (best && best.score < 12) redIndexes.add(best.index);
  }

  return redIndexes;
}

function annotationRectangles(annotation: Record<string, unknown>) {
  const quads = flattenNumbers(annotation.quadPoints);
  const rectangles: number[][] = [];
  if (quads.length >= 8) {
    for (let index = 0; index + 7 < quads.length; index += 8) {
      const xs = [quads[index], quads[index + 2], quads[index + 4], quads[index + 6]];
      const ys = [
        quads[index + 1],
        quads[index + 3],
        quads[index + 5],
        quads[index + 7],
      ];
      rectangles.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  } else {
    const rect = flattenNumbers(annotation.rect);
    if (rect.length >= 4) {
      rectangles.push([
        Math.min(rect[0], rect[2]),
        Math.min(rect[1], rect[3]),
        Math.max(rect[0], rect[2]),
        Math.max(rect[1], rect[3]),
      ]);
    }
  }
  return rectangles;
}

export function redAnnotationItemIndexes(
  items: PdfTextItemLike[],
  annotations: Array<Record<string, unknown>>,
) {
  const positioned = positionedItems(items, new Set());
  const redIndexes = new Set<number>();

  annotations.forEach((annotation) => {
    if (
      annotation.subtype !== "Highlight" ||
      !isRedColor(pdfColorFromArgs(annotation.color))
    ) {
      return;
    }
    annotationRectangles(annotation).forEach(([x1, y1, x2, y2]) => {
      positioned.forEach((item) => {
        const itemX2 = item.x + Math.max(item.width, item.height * 0.4);
        const itemY1 = item.y - item.height;
        const itemY2 = item.y + item.height * 0.3;
        if (itemX2 >= x1 && item.x <= x2 && itemY2 >= y1 && itemY1 <= y2) {
          redIndexes.add(item.index);
        }
      });
    });
  });

  return redIndexes;
}

function joinItems(items: PositionedTextItem[], redOnly: boolean) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let output = "";
  let previousEnd: number | null = null;
  let previousHeight = 0;
  let pendingSpace = false;

  sorted.forEach((item) => {
    const rawText = item.text.replace(/\s+/g, " ");
    if (!rawText.trim()) {
      pendingSpace = true;
      return;
    }
    if (redOnly && !item.red) {
      if (output) pendingSpace = true;
      return;
    }

    const gap = previousEnd === null ? 0 : item.x - previousEnd;
    const gapThreshold = Math.max(
      1.2,
      Math.min(previousHeight || item.height || 6, item.height || previousHeight || 6) *
        0.22,
    );
    if (output && (pendingSpace || gap > gapThreshold) && !output.endsWith(" ")) {
      output += " ";
    }
    output += rawText.trim();
    previousEnd = item.x + Math.max(item.width, item.height * 0.25);
    previousHeight = item.height || previousHeight;
    pendingSpace = false;
  });

  return output.replace(/[ \t]+/g, " ").trim();
}

export function pdfLinesFromItems(
  items: PdfTextItemLike[],
  redIndexes: ReadonlySet<number>,
): TaggedDocumentLine[] {
  const rows: Array<{
    y: number;
    height: number;
    items: PositionedTextItem[];
  }> = [];
  const positioned = positionedItems(items, redIndexes).sort(
    (a, b) => b.y - a.y || a.x - b.x,
  );

  positioned.forEach((item) => {
    const row = rows.find((candidate) => {
      const comparableHeight = Math.min(
        candidate.height || item.height || 8,
        item.height || candidate.height || 8,
      );
      return Math.abs(candidate.y - item.y) <= Math.max(2.5, comparableHeight * 0.24);
    });
    if (row) {
      row.items.push(item);
      row.y = (row.y * (row.items.length - 1) + item.y) / row.items.length;
      row.height = Math.max(row.height, item.height);
    } else {
      rows.push({ y: item.y, height: item.height, items: [item] });
    }
  });

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const text = joinItems(row.items, false);
      const redText = joinItems(row.items, true);
      return redText ? { text, redText } : { text };
    })
    .filter((line) => Boolean(line.text));
}
