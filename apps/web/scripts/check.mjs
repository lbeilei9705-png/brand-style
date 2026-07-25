import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(appRoot, "public");
const node = process.execPath;

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
  return content ? content.split("\n").length - (content.endsWith("\n") ? 1 : 0) : 0;
}

execFileSync(node, ["scripts/build.mjs"], { cwd: appRoot, stdio: "inherit" });

const files = await collectFiles(publicDir);
const maintained = files.filter((path) => {
  const name = path.slice(publicDir.length + 1);
  if (/^figma-page\d+\.html$/.test(name) || /^figma-(?:ppt|cover)\.html$/.test(name)) {
    return false;
  }
  if (name === "admin.html") {
    return false;
  }
  return [".css", ".html", ".js", ".mjs"].includes(extname(path));
});

for (const path of maintained) {
  const content = await readFile(path, "utf8");
  if (lineCount(content) > 500) {
    throw new Error(`${path} exceeds 500 lines`);
  }
  if (extname(path) === ".js" || extname(path) === ".mjs") {
    execFileSync(node, ["--check", path], { cwd: appRoot, stdio: "inherit" });
  }
}

const adminHtml = await readFile(resolve(publicDir, "admin.html"), "utf8");
for (const required of [
  "id=\"models-page\"",
  "id=\"member-access-page\"",
  "id=\"scenario-agent-case-modal\"",
  "id=\"telemetry-page\"",
  "id=\"telemetry-filter-form\"",
  "id=\"telemetry-events-table\"",
  "id=\"telemetry-detail-modal\"",
  "id=\"export-diagnostics-button\"",
]) {
  if (!adminHtml.includes(required)) {
    throw new Error(`Generated admin.html is missing ${required}`);
  }
}

const moduleConnections = [
  ["admin.js", "./admin/events.js"],
  ["admin/events.js", "./telemetry-events.js"],
  ["admin/telemetry-events.js", "./telemetry.js"],
];
for (const [name, dependency] of moduleConnections) {
  const source = await readFile(resolve(publicDir, name), "utf8");
  if (!source.includes(dependency)) {
    throw new Error(`${name} is missing module connection ${dependency}`);
  }
}

console.log(`${maintained.length} maintained Web files are <=500 lines and scripts parse`);
