import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function dayKey(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u00a0/gu, " ")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function stripInjectedContext(value) {
  const cleaned = cleanText(value)
    .replace(
      /<(?:codex_internal_context|in-app-browser-context|environment_context|app-context|permissions|recommended_plugins|developer_context)\b[^>]*>[\s\S]*?<\/(?:codex_internal_context|in-app-browser-context|environment_context|app-context|permissions|recommended_plugins|developer_context)>/giu,
      "",
    )
    .trim();
  const requestMarker = cleaned.match(/##\s*My request for Codex\s*:\s*([\s\S]+)/iu);
  return cleanText(requestMarker?.[1] || cleaned);
}

function contentText(content) {
  if (!Array.isArray(content)) return "";
  return cleanText(
    content
      .map((part) =>
        part && typeof part === "object" ? String(part.text || "") : "",
      )
      .filter(Boolean)
      .join("\n"),
  );
}

async function jsonlFiles(root) {
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
          files.push(path);
        }
      }),
    );
  }
  await visit(root);
  return files;
}

async function readCodexPairs(file, targetDay, timezone, debug = false) {
  const rows = [];
  let subagent = false;
  const input = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.type === "session_meta" && row.payload?.source?.subagent) {
      subagent = true;
      break;
    }
    if (
      row?.type !== "response_item" ||
      row.payload?.type !== "message" ||
      !["user", "assistant"].includes(row.payload.role)
    ) {
      continue;
    }
    const timestamp = Date.parse(row.timestamp);
    const text = contentText(row.payload.content);
    if (!Number.isFinite(timestamp) || !text) continue;
    rows.push({ role: row.payload.role, timestamp, text });
  }
  if (subagent) return [];

  const pairs = [];
  let current = null;
  for (const message of rows) {
    if (message.role === "user") {
      if (current?.responses.length && dayKey(current.timestamp, timezone) === targetDay) {
        pairs.push({
          source: "codex",
          occurredAt: new Date(current.timestamp).toISOString(),
          title: cleanText(current.prompt).replace(/\n+/gu, " ").slice(0, 80),
          prompt: current.prompt,
          response: current.responses.join("\n\n"),
          originLabel: basename(file),
        });
      }
      current = {
        prompt: stripInjectedContext(message.text),
        timestamp: message.timestamp,
        responses: [],
      };
      continue;
    }
    if (current) current.responses.push(message.text);
  }
  if (current?.responses.length && dayKey(current.timestamp, timezone) === targetDay) {
    pairs.push({
      source: "codex",
      occurredAt: new Date(current.timestamp).toISOString(),
      title: cleanText(current.prompt).replace(/\n+/gu, " ").slice(0, 80),
      prompt: current.prompt,
      response: current.responses.join("\n\n"),
      originLabel: basename(file),
    });
  }
  if (debug && rows.length && !subagent) {
    const matchingUsers = rows.filter(
      (row) =>
        row.role === "user" &&
        dayKey(row.timestamp, timezone) === targetDay,
    ).length;
    if (matchingUsers) {
      console.log(`${basename(file)}：今日用户消息 ${matchingUsers}，已配对 ${pairs.length}`);
    }
  }
  return pairs.filter(
    (pair) =>
      pair.prompt &&
      pair.response &&
      !/^<(?:codex_internal_context|environment_context)\b/iu.test(pair.prompt),
  );
}

const timezone = argument("--timezone") || DEFAULT_TIMEZONE;
const targetDay = argument("--date") || dayKey(Date.now(), timezone);
const debug = process.argv.includes("--debug");
const sessionRoot = resolve(
  argument("--sessions") || join(homedir(), ".codex", "sessions"),
);
const output = resolve(
  argument("--out") || join("tmp", `codex-today-learning-${targetDay}.json`),
);

const files = await jsonlFiles(sessionRoot);
if (debug) console.log(`扫描 ${sessionRoot}：${files.length} 个 JSONL`);
const collected = [];
for (const file of files) {
  const pairs = await readCodexPairs(file, targetDay, timezone, debug);
  if (debug && pairs.length) {
    console.log(`${basename(file)}：${pairs.length} 条`);
  }
  collected.push(...pairs);
}

const seen = new Set();
const items = collected
  .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
  .filter((item) => {
    const key = `${item.occurredAt}|${item.prompt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `${JSON.stringify({
    schemaVersion: 1,
    source: "codex",
    exportedAt: new Date().toISOString(),
    timezone,
    targetDay,
    items,
  }, null, 2)}\n`,
  "utf8",
);

console.log(`已导出 ${items.length} 条 Codex 主任务记录：${output}`);
