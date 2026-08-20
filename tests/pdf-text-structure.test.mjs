import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRedOperatorMarks,
  pdfLinesFromItems,
  redItemIndexesFromMarks,
} from "../app/lib/pdf-text-structure.ts";

const OPS = {
  setFillRGBColor: 1,
  setTextMatrix: 2,
  showText: 3,
};

function textItem(str, x, y, width, height = 10) {
  return {
    str,
    transform: [height, 0, 0, height, x, y],
    width,
    height,
  };
}

test("reassembles per-character red PDF operators into visual answer words", () => {
  const fnArray = [OPS.setFillRGBColor];
  const argsArray = [[1, 0, 0]];
  const glyphs = [
    ["程", 10, 80],
    ["序", 20, 80],
    ["数", 50, 80],
    ["据", 60, 80],
    ["文", 90, 80],
    ["档", 100, 80],
  ];
  for (const [text, x, y] of glyphs) {
    fnArray.push(OPS.setTextMatrix, OPS.showText);
    argsArray.push([10, 0, 0, 10, x, y], [[{ unicode: text }]]);
  }

  const items = [
    textItem("1. 完整资料包括______、______和______。", 10, 110, 260, 14),
    textItem("程序", 10, 80, 20),
    textItem(" ", 30, 80, 0, 0),
    textItem("数据", 50, 80, 20),
    textItem(" ", 70, 80, 0, 0),
    textItem("文档", 90, 80, 20),
  ];

  const marks = extractRedOperatorMarks({ fnArray, argsArray }, OPS);
  const redIndexes = redItemIndexesFromMarks(items, marks);
  const lines = pdfLinesFromItems(items, redIndexes);

  assert.equal(marks.length, 6);
  assert.deepEqual([...redIndexes].sort((a, b) => a - b), [1, 3, 5]);
  assert.equal(lines[1].redText, "程序 数据 文档");
});

test("keeps non-red question text out of the reconstructed answer line", () => {
  const items = [
    textItem("2. 简称______。", 10, 110, 100, 14),
    textItem("答案：", 10, 80, 35),
    textItem("OS", 50, 80, 14),
  ];
  const redIndexes = new Set([2]);
  const lines = pdfLinesFromItems(items, redIndexes);

  assert.equal(lines[1].text, "答案： OS");
  assert.equal(lines[1].redText, "OS");
});
