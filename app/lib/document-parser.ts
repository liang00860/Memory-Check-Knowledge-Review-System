import { strFromU8, unzipSync } from "fflate";
import {
  countQuestionBlanks,
  inferQuestionAnswerPairs,
  isProbablePageFurniture,
  tagLinesWithRedFragments,
  type TaggedDocumentLine,
} from "./knowledge-structure";
import {
  extractRedOperatorMarks,
  isRedColor,
  pdfLinesFromItems,
  redAnnotationItemIndexes,
  redItemIndexesFromMarks,
  type PdfOperatorListLike,
  type PdfTextItemLike,
} from "./pdf-text-structure";
import type { StudySubject } from "./knowledge-taxonomy";

export type ExtractionMethod =
  | "pdf-color"
  | "pdf-ocr"
  | "docx-color"
  | "history-import";

export type KnowledgePoint = {
  id: string;
  text: string;
  context: string;
  explanation?: string;
  sourceName: string;
  location: string;
  method: ExtractionMethod;
  createdAt: number;
  question?: string;
  answerParts?: string[];
  subject?: StudySubject;
  knowledgeCategory?: string;
  classificationConfidence?: number;
  classificationVersion?: number;
  classificationSource?: "auto" | "user";
};

export type ParseProgress = {
  percent: number;
  label: string;
};

type ProgressCallback = (progress: ParseProgress) => void;

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tidyText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function normalizeKey(value: string) {
  return tidyText(value)
    .replace(/[，。；：、,.!?！？“”‘’'"（）()《》〈〉\[\]【】\s]/g, "")
    .toLowerCase();
}

function splitUsefulLines(value: string) {
  return tidyText(value)
    .split(/\n+/)
    .map((line) => line.replace(/^[\s\-•·]+|[\s\-•·]+$/g, "").trim())
    .filter((line) => line.length >= 2);
}

function sentenceAround(fullText: string, needle: string) {
  const normalizedFull = tidyText(fullText);
  if (!normalizedFull) return needle;

  const pieces = normalizedFull
    .split(/(?<=[。！？!?；;\n])/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const compactNeedle = normalizeKey(needle);
  const matchIndex = pieces.findIndex((piece) => normalizeKey(piece).includes(compactNeedle));
  if (matchIndex < 0) return needle;
  const match = pieces[matchIndex];
  if (normalizeKey(match) === compactNeedle && pieces[matchIndex + 1]) {
    return `${match} ${pieces[matchIndex + 1]}`;
  }
  return match;
}

export function knowledgePointIdentity(
  point: Pick<KnowledgePoint, "text" | "context" | "question" | "sourceName">,
) {
  return [
    point.sourceName.toLowerCase(),
    normalizeKey(point.text),
    normalizeKey(point.question || point.context),
  ].join("::");
}

function uniquePoints(points: KnowledgePoint[]) {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = knowledgePointIdentity(point);
    if (!normalizeKey(point.text) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pointsFromTaggedLines(
  lines: TaggedDocumentLine[],
  sourceName: string,
  method: ExtractionMethod,
  fallbackLocation: string,
) {
  const createdAt = Date.now();
  const points: KnowledgePoint[] = [];
  const pairs = inferQuestionAnswerPairs(lines);
  const usedRedLineIndexes = new Set(
    pairs.flatMap((pair) => pair.usedRedLineIndexes),
  );

  pairs.forEach((pair) => {
    const location = lines[pair.startLine]?.location || fallbackLocation;
    points.push({
      id: createId(),
      text: pair.answers.join("；"),
      context: pair.question,
      question: pair.question,
      answerParts: pair.answers,
      explanation: pair.explanation,
      sourceName,
      location,
      method,
      createdAt,
    });
  });

  const fullText = lines.map((line) => line.text).join("\n");
  lines.forEach((line, index) => {
    if (
      !line.redText ||
      usedRedLineIndexes.has(index) ||
      isProbablePageFurniture(lines, index)
    ) return;
    splitUsefulLines(line.redText).forEach((text) => {
      points.push({
        id: createId(),
        text,
        context: sentenceAround(fullText, text),
        sourceName,
        location: line.location || fallbackLocation,
        method,
        createdAt,
      });
    });
  });

  return points;
}

function renderRedMask(
  canvas: HTMLCanvasElement,
): { mask: HTMLCanvasElement; redPixelRatio: number } {
  const source = canvas.getContext("2d", { willReadFrequently: true });
  if (!source) return { mask: canvas, redPixelRatio: 0 };
  const image = source.getImageData(0, 0, canvas.width, canvas.height);
  const mask = document.createElement("canvas");
  mask.width = canvas.width;
  mask.height = canvas.height;
  const maskContext = mask.getContext("2d");
  if (!maskContext) return { mask: canvas, redPixelRatio: 0 };
  const output = maskContext.createImageData(canvas.width, canvas.height);
  let redPixels = 0;

  for (let i = 0; i < image.data.length; i += 4) {
    const rgb: [number, number, number] = [
      image.data[i],
      image.data[i + 1],
      image.data[i + 2],
    ];
    const red = isRedColor(rgb);
    if (red) redPixels += 1;
    const value = red ? 0 : 255;
    output.data[i] = value;
    output.data[i + 1] = value;
    output.data[i + 2] = value;
    output.data[i + 3] = 255;
  }
  maskContext.putImageData(output, 0, 0);
  return { mask, redPixelRatio: redPixels / (canvas.width * canvas.height) };
}

async function extractPdf(file: File, onProgress: ProgressCallback) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/workers/pdf.worker.min.mjs";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const assetUrl = (path: string) => new URL(path, window.location.origin).href;
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    cMapUrl: assetUrl("/pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: assetUrl("/pdfjs/standard_fonts/"),
    wasmUrl: assetUrl("/pdfjs/wasm/"),
    iccUrl: assetUrl("/pdfjs/iccs/"),
  });
  const pdf = await loadingTask.promise;
  const points: KnowledgePoint[] = [];
  const directDocumentLines: TaggedDocumentLine[] = [];
  const ocrDocumentLines: TaggedDocumentLine[] = [];
  let ocrWorker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | null = null;

  const ensureOcrWorker = async () => {
    if (ocrWorker) return ocrWorker;
    const { createWorker } = await import("tesseract.js");
    ocrWorker = await createWorker("chi_sim+eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",
      langPath: "/tessdata",
      logger: (message) => {
        if (typeof message.progress === "number") {
          onProgress({
            percent: Math.min(96, Math.round(message.progress * 100)),
            label: `本地 OCR：${message.status}`,
          });
        }
      },
    });
    return ocrWorker;
  };

  try {
    if (pdf.numPages > 300) {
      throw new Error("PDF 超过 300 页，请拆分后再上传，以免浏览器内存不足。");
    }
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress({
        percent: Math.round(((pageNumber - 1) / pdf.numPages) * 88),
        label: `正在解析 PDF 第 ${pageNumber}/${pdf.numPages} 页`,
      });
      const page = await pdf.getPage(pageNumber);
      const [textContent, opList, annotations] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList(),
        page.getAnnotations({ intent: "display" }),
      ]);
      const textItems = textContent.items as PdfTextItemLike[];
      const operatorMarks = extractRedOperatorMarks(
        opList as unknown as PdfOperatorListLike,
        pdfjs.OPS as unknown as Record<string, number>,
      );
      const redItemIndexes = redItemIndexesFromMarks(textItems, operatorMarks);
      redAnnotationItemIndexes(
        textItems,
        annotations as unknown as Array<Record<string, unknown>>,
      ).forEach((index) => redItemIndexes.add(index));
      const directLines = pdfLinesFromItems(textItems, redItemIndexes).map((line) => ({
        ...line,
        location: `第 ${pageNumber} 页`,
      }));
      directDocumentLines.push(...directLines);
      const fullText = directLines.map((line) => line.text).join("\n");
      const directRedLineCount = directLines.filter((line) => line.redText).length;
      const directPagePoints = pointsFromTaggedLines(
        directLines,
        file.name,
        "pdf-color",
        `第 ${pageNumber} 页`,
      );

      const imageOperations = new Set(
        [
          pdfjs.OPS.paintImageXObject,
          pdfjs.OPS.paintInlineImageXObject,
          pdfjs.OPS.paintImageMaskXObject,
          pdfjs.OPS.paintSolidColorImageMask,
        ].filter((operation): operation is number => typeof operation === "number"),
      );
      const hasRasterImage = opList.fnArray.some((operation) => imageOperations.has(operation));
      const hasStructuredQuestions = directPagePoints.some((point) => Boolean(point.question));
      const hasSubstantialTextLayer = normalizeKey(fullText).length >= 80;
      if (
        directRedLineCount &&
        (!hasRasterImage || (hasStructuredQuestions && hasSubstantialTextLayer))
      ) {
        page.cleanup();
        continue;
      }

      const baseViewport = page.getViewport({ scale: 1 });
      const maximumPixels = 10_000_000;
      const scale = Math.min(
        2,
        Math.sqrt(maximumPixels / Math.max(1, baseViewport.width * baseViewport.height)),
      );
      const viewport = page.getViewport({ scale: Math.max(0.1, scale) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        page.cleanup();
        continue;
      }
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const { mask, redPixelRatio } = renderRedMask(canvas);
      if (redPixelRatio < 0.00002) {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        continue;
      }

      const worker = await ensureOcrWorker();
      onProgress({
        percent: Math.round(((pageNumber - 0.5) / pdf.numPages) * 88),
        label: `正在离线识别第 ${pageNumber} 页红字`,
      });
      const redResult = await worker.recognize(mask);
      const redLines = splitUsefulLines(redResult.data.text);
      let ocrFullText = fullText;
      if (normalizeKey(ocrFullText).length < 40 && redLines.length) {
        const fullResult = await worker.recognize(canvas);
        ocrFullText = fullResult.data.text;
      }
      const ocrLines = tagLinesWithRedFragments(ocrFullText, redLines).map((line) => ({
        ...line,
        location: `第 ${pageNumber} 页 · OCR`,
      }));
      ocrDocumentLines.push(...ocrLines);
      canvas.width = 0;
      canvas.height = 0;
      mask.width = 0;
      mask.height = 0;
      page.cleanup();
    }
    points.push(
      ...pointsFromTaggedLines(
        directDocumentLines,
        file.name,
        "pdf-color",
        "PDF",
      ),
      ...pointsFromTaggedLines(
        ocrDocumentLines,
        file.name,
        "pdf-ocr",
        "PDF · OCR",
      ),
    );
  } finally {
    const workerToTerminate = ocrWorker as Awaited<
      ReturnType<(typeof import("tesseract.js"))["createWorker"]>
    > | null;
    if (workerToTerminate) await workerToTerminate.terminate();
    await loadingTask.destroy();
  }

  return uniquePoints(points);
}

const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function attr(element: Element | null, name: string) {
  if (!element) return "";
  return (
    element.getAttribute(`w:${name}`) ||
    element.getAttribute(name) ||
    element.getAttributeNS(WORD_NAMESPACE, name) ||
    ""
  );
}

function all(element: ParentNode | null, selector: string) {
  if (!element) return [] as Element[];
  const localName = selector.includes(":") ? selector.split(":").at(-1)! : selector;
  return Array.from(
    (element as Document | Element).getElementsByTagNameNS(WORD_NAMESPACE, localName),
  );
}

function first(element: ParentNode | null, selector: string) {
  return all(element, selector)[0] || null;
}

function redWordValue(value: string) {
  const normalized = value.replace("#", "").toUpperCase();
  if (["RED", "DARKRED"].includes(normalized)) return true;
  if (!/^[0-9A-F]{6}$/.test(normalized)) return false;
  return isRedColor([
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]);
}

type WordColorState = "red" | "other" | null;

function runPropertyColorState(
  properties: Element | null,
  themeColors: Map<string, string>,
): WordColorState {
  const colorElement = first(properties, "w:color");
  const highlightElement = first(properties, "w:highlight");
  const shadingElement = first(properties, "w:shd");
  const values = [
    colorElement
      ? attr(colorElement, "val") || themeColors.get(attr(colorElement, "themeColor")) || ""
      : null,
    highlightElement ? attr(highlightElement, "val") : null,
    shadingElement
      ? attr(shadingElement, "fill") || themeColors.get(attr(shadingElement, "themeFill")) || ""
      : null,
  ].filter((value): value is string => value !== null);
  if (!values.length) return null;
  return values.some(redWordValue) ? "red" : "other";
}

function wordRunText(run: Element) {
  return Array.from(run.childNodes)
    .map((node) => {
      if (!(node instanceof Element)) return "";
      if (node.localName === "t" || node.localName === "instrText") {
        return node.textContent || "";
      }
      if (node.localName === "tab") return "\t";
      if (node.localName === "br" || node.localName === "cr") return "\n";
      return "";
    })
    .join("");
}

function belongsToParagraph(run: Element, paragraph: Element) {
  let current: Element | null = run.parentElement;
  while (current && current.localName !== "p") current = current.parentElement;
  return current === paragraph;
}

function extractDocx(file: File, onProgress: ProgressCallback) {
  return file.arrayBuffer().then((buffer) => {
    onProgress({ percent: 28, label: "正在读取 Word 文档结构" });
    let expandedBytes = 0;
    const archive = unzipSync(new Uint8Array(buffer), {
      filter: (entry) => {
        const wanted =
          entry.name === "word/document.xml" ||
          entry.name === "word/styles.xml" ||
          /^word\/theme\/theme\d+\.xml$/i.test(entry.name);
        if (!wanted) return false;
        expandedBytes += entry.originalSize;
        if (entry.originalSize > 20 * 1024 * 1024 || expandedBytes > 28 * 1024 * 1024) {
          throw new Error("DOCX 文本结构过大，请拆分文档后再上传。");
        }
        return true;
      },
    });
    const documentBytes = archive["word/document.xml"];
    if (!documentBytes) throw new Error("不是有效的 DOCX 文件，或文档结构已损坏。");
    const parser = new DOMParser();
    const documentXml = parser.parseFromString(strFromU8(documentBytes), "application/xml");
    const stylesBytes = archive["word/styles.xml"];
    const stylesXml = stylesBytes
      ? parser.parseFromString(strFromU8(stylesBytes), "application/xml")
      : null;
    const themeColors = new Map<string, string>();
    const themeBytes = Object.entries(archive).find(([name]) =>
      /^word\/theme\/theme\d+\.xml$/i.test(name),
    )?.[1];
    if (themeBytes) {
      const themeXml = parser.parseFromString(strFromU8(themeBytes), "application/xml");
      const scheme = themeXml.getElementsByTagNameNS("*", "clrScheme")[0];
      if (scheme) {
        Array.from(scheme.children).forEach((slot) => {
          const color = slot.firstElementChild;
          const value = color?.getAttribute("val") || color?.getAttribute("lastClr") || "";
          if (value) themeColors.set(slot.localName, value);
        });
      }
    }

    const styles = new Map<string, { color: WordColorState; basedOn: string }>();
    if (stylesXml) {
      all(stylesXml, "w:style").forEach((style) => {
        styles.set(attr(style, "styleId"), {
          color: runPropertyColorState(first(style, "w:rPr"), themeColors),
          basedOn: attr(first(style, "w:basedOn"), "val"),
        });
      });
    }

    const styleColorState = (styleId: string): WordColorState => {
      let current = styleId;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const style = styles.get(current);
        if (!style) return null;
        if (style.color !== null) return style.color;
        current = style.basedOn;
      }
      return null;
    };
    const defaultColor = stylesXml
      ? runPropertyColorState(
        first(first(first(stylesXml, "w:docDefaults"), "w:rPrDefault"), "w:rPr"),
        themeColors,
      )
      : null;

    const taggedLines: TaggedDocumentLine[] = [];
    const paragraphs = all(documentXml, "w:p");
    let numberedParagraph = 0;
    paragraphs.forEach((paragraph, paragraphIndex) => {
      const paragraphStyle = attr(first(first(paragraph, "w:pPr"), "w:pStyle"), "val");
      const runs = all(paragraph, "w:r").filter((run) =>
        belongsToParagraph(run, paragraph),
      );
      const paragraphLines = [{ text: "", redText: "", redGap: false }];
      const appendText = (value: string, red: boolean) => {
        value.replace(/\r\n?/g, "\n").split(/(\n)/).forEach((part) => {
          if (part === "\n") {
            paragraphLines.push({ text: "", redText: "", redGap: false });
            return;
          }
          const target = paragraphLines[paragraphLines.length - 1];
          target.text += part;
          if (red) {
            if (target.redText && target.redGap && !target.redText.endsWith(" ")) {
              target.redText += " ";
            }
            target.redText += part;
            target.redGap = false;
          } else if (part && target.redText) {
            target.redGap = true;
          }
        });
      };
      runs.forEach((run) => {
        const text = wordRunText(run);
        const runProperties = first(run, "w:rPr");
        const runStyle = attr(first(runProperties, "w:rStyle"), "val");
        const color =
          runPropertyColorState(runProperties, themeColors) ??
          styleColorState(runStyle) ??
          styleColorState(paragraphStyle) ??
          defaultColor;
        appendText(text, color === "red");
      });

      const hasNumbering = Boolean(first(first(paragraph, "w:pPr"), "w:numPr"));
      paragraphLines.forEach((line, lineIndex) => {
        let text = tidyText(line.text);
        const redText = tidyText(line.redText);
        if (!text) return;
        if (hasNumbering && lineIndex === 0 && countQuestionBlanks(text) > 0) {
          numberedParagraph += 1;
          text = `${numberedParagraph}. ${text}`;
        }
        taggedLines.push({
          text,
          redText: redText || undefined,
          location: `第 ${paragraphIndex + 1} 段`,
        });
      });
    });

    onProgress({ percent: 94, label: "正在整理标红知识点" });
    return uniquePoints(
      pointsFromTaggedLines(
        taggedLines,
        file.name,
        "docx-color",
        "Word 文档",
      ),
    );
  });
}

export async function parseKnowledgeDocument(
  file: File,
  onProgress: ProgressCallback,
): Promise<KnowledgePoint[]> {
  if (file.size > 60 * 1024 * 1024) {
    throw new Error("文件超过 60 MB。请压缩文档或拆分后再上传。");
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  onProgress({ percent: 4, label: "正在检查文档" });
  let points: KnowledgePoint[];
  if (extension === "pdf") points = await extractPdf(file, onProgress);
  else if (extension === "docx") points = await extractDocx(file, onProgress);
  else if (extension === "doc") {
    throw new Error("旧版 .doc 暂不支持，请在 Word 中另存为 .docx 后重新上传。");
  } else {
    throw new Error("仅支持 PDF 与 DOCX 文件。");
  }
  onProgress({ percent: 100, label: `已提取 ${points.length} 个知识点` });
  return points;
}
