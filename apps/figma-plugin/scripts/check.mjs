import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

function build() {
  execFileSync(node, ["scripts/build.mjs"], {
    cwd: appRoot,
    stdio: "inherit",
  });
}

async function hash(path) {
  const content = await readFile(resolve(appRoot, path));
  return createHash("sha256").update(content).digest("hex");
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path));
    } else {
      files.push(path);
    }
  }

  return files;
}

function lineCount(content) {
  if (!content) {
    return 0;
  }
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

build();
const firstHashes = await Promise.all([hash("dist/ui.html"), hash("dist/code.js")]);
build();
const secondHashes = await Promise.all([hash("dist/ui.html"), hash("dist/code.js")]);

if (firstHashes.some((value, index) => value !== secondHashes[index])) {
  throw new Error("Build is not deterministic.");
}

execFileSync(node, ["--check", "dist/code.js"], {
  cwd: appRoot,
  stdio: "inherit",
});

const ui = await readFile(resolve(appRoot, "dist/ui.html"), "utf8");
const scriptMatch = ui.match(/<script>([\s\S]*)<\/script>/);
if (!scriptMatch) {
  throw new Error("Inline UI script was not found.");
}
new Function(scriptMatch[1]);

const maintainedFiles = [
  ...await collectFiles(resolve(appRoot, "src")),
  ...await collectFiles(resolve(appRoot, "scripts")),
].filter((path) => [".css", ".html", ".js", ".mjs", ".ts"].includes(extname(path)));

for (const path of maintainedFiles) {
  const lines = lineCount(await readFile(path, "utf8"));
  if (lines > 500) {
    throw new Error(`${path} has ${lines} lines; maximum is 500.`);
  }
}

console.log(`Deterministic SHA-256: ui=${secondHashes[0]} code=${secondHashes[1]}`);
console.log(`Syntax checks passed; ${maintainedFiles.length} maintained files are <=500 lines`);
