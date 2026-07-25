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

const requiredUiProtocol = [
  'const telemetrySessionStorageKey = "brand-style-client-session-id"',
  '"x-client-session-id": clientSessionId',
  '"x-client-request-id": clientRequestId',
  'response.headers.get("x-request-id")',
  'fetch(`${apiBase}${telemetryEndpoint}`',
  'Authorization: `Bearer ${memberSessionToken}`',
  "keepalive: true",
  'trackEvent("generation_start"',
  'trackEvent("generation_success"',
  'downloadDiagnosticBundle(false)',
  'memberLoginForm.addEventListener("submit"',
  'memberLoginButton.addEventListener("click"',
];
for (const snippet of requiredUiProtocol) {
  if (!ui.includes(snippet)) {
    throw new Error(`UI telemetry protocol assertion failed: ${snippet}`);
  }
}
if (ui.includes('onclick="submitMemberLogin') || ui.includes('onsubmit="submitMemberLogin')) {
  throw new Error("Member login must not depend on inline event handlers.");
}

const stateIndex = ui.indexOf('const apiBase = "');
const telemetryIndex = ui.indexOf("const telemetrySessionStorageKey");
const apiFetchIndex = ui.indexOf("async function apiFetch");
if (!(stateIndex >= 0 && telemetryIndex > stateIndex && apiFetchIndex > telemetryIndex)) {
  throw new Error("UI build fragment order must be state -> telemetry -> API.");
}

const controller = await readFile(resolve(appRoot, "dist/code.js"), "utf8");
for (const snippet of ["createControllerIssueId", 'type: "controller-diagnostic"', 'type: "selection-error"']) {
  if (!controller.includes(snippet)) {
    throw new Error(`Controller diagnostic protocol assertion failed: ${snippet}`);
  }
}

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
