import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the local study application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>忆检｜本地知识考察与科学复习<\/title>/i);
  assert.match(html, /上传知识文档/);
  assert.match(html, /今日组卷/);
  assert.match(html, /复习计划/);
  assert.match(html, /NO AI EXTRACTION API/);
  assert.doesNotMatch(html, /codex-preview|Starter Project|react-loading-skeleton/i);
});

test("keeps parsing and question generation local and deterministic", async () => {
  const [
    page,
    parser,
    study,
    todayLearning,
    taxonomy,
    layout,
    packageJson,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/document-parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/study.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/today-learning.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/knowledge-taxonomy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /parseKnowledgeDocument/);
  assert.match(page, /idb-keyval/);
  assert.match(page, /import\("gsap"\)/);
  assert.match(page, /gsap\.matchMedia/);
  assert.match(page, /TaxonomyFilter/);
  assert.match(page, /gradeAnswer/);
  assert.match(page, /needs-confirmation/);
  assert.match(parser, /pdfjs-dist/);
  assert.match(parser, /tesseract\.js/);
  assert.match(parser, /DOMParser/);
  assert.doesNotMatch(parser, /fetch\(["']https?:\/\//i);
  assert.match(todayLearning, /parseLearningImportFile/);
  assert.match(todayLearning, /buildTodayChoiceQuestionBank/);
  assert.match(todayLearning, /choiceIdentity/);
  assert.match(todayLearning, /poolFor/);
  assert.doesNotMatch(todayLearning, /fetch\(["']https?:\/\//i);
  assert.match(study, /REVIEW_INTERVALS/);
  assert.match(study, /type: "fill" \| "choice"/);
  assert.match(study, /needs-confirmation/);
  assert.doesNotMatch(study, /fetch\(["']https?:\/\//i);
  assert.match(taxonomy, /classifyKnowledge/);
  assert.match(taxonomy, /计算机基础/);
  assert.doesNotMatch(taxonomy, /fetch\(["']https?:\/\//i);
  assert.match(layout, /lang="zh-CN"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
