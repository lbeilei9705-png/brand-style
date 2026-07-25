import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoots = [
  "apps/server/src",
  "apps/web/src",
  "apps/web/public",
  "apps/web/scripts",
  "apps/figma-plugin/src",
  "apps/figma-plugin/scripts",
  "packages/shared/src",
  "scripts",
];
const codeExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".ts", ".tsx"]);
const excludedPathPatterns = [
  /^apps\/figma-plugin\/dist\//,
  /^apps\/web\/public\/admin\.html$/,
  /^apps\/web\/public\/figma-page\d+\.html$/,
  /^apps\/web\/public\/figma-(?:ppt|cover)\.html$/,
];

async function collectFiles(directory) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

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

function countLines(content) {
  if (!content) {
    return 0;
  }
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

const candidates = (await Promise.all(
  sourceRoots.map((directory) => collectFiles(resolve(root, directory))),
)).flat();
const violations = [];
let checked = 0;

for (const path of candidates) {
  const projectPath = relative(root, path);
  if (!codeExtensions.has(extname(path)) || excludedPathPatterns.some((pattern) => pattern.test(projectPath))) {
    continue;
  }

  checked += 1;
  const lines = countLines(await readFile(path, "utf8"));
  if (lines > 500) {
    violations.push(`${projectPath}: ${lines} lines`);
  }
}

if (violations.length) {
  throw new Error(`Maintained code exceeds 500 lines:\n${violations.join("\n")}`);
}

console.log(`${checked} maintained code files are <=500 lines`);
