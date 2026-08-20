import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
const releaseDir = join(root, "release");
const archiveName = `yijian-github-source-${new Date().toISOString().slice(0, 10)}.zip`;
const archivePath = join(releaseDir, archiveName);
const stage = mkdtempSync(join(tmpdir(), "yijian-github-"));

const excludedDirectories = new Set([
  ".agents",
  ".git",
  ".next",
  ".openai",
  ".vinext",
  ".wrangler",
  "dist",
  "node_modules",
  "outputs",
  "release",
  "tmp",
]);

function shouldCopy(source) {
  const relative = source.slice(root.length + 1);
  if (!relative) return true;
  const segments = relative.split(sep);
  return !segments.some((segment) => excludedDirectories.has(segment));
}

mkdirSync(releaseDir, { recursive: true });
rmSync(archivePath, { force: true });
cpSync(root, stage, { recursive: true, filter: shouldCopy });

if (process.platform === "win32") {
  const quotePowerShell = (value) => value.replaceAll("'", "''");
  const command = [
    "$ErrorActionPreference='Stop'",
    `Compress-Archive -Path '${quotePowerShell(stage)}\\*' -DestinationPath '${quotePowerShell(archivePath)}' -Force`,
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    stdio: "inherit",
  });
} else {
  execFileSync("tar", ["-a", "-c", "-f", archivePath, "-C", stage, "."], {
    stdio: "inherit",
  });
}

rmSync(stage, { recursive: true, force: true });
console.log(`Created ${archivePath}`);
