import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(appRoot, "package.json"), "utf8"));

function getCommit() {
  if (process.env.BRAND_STYLE_BUILD_HASH || process.env.GITHUB_SHA) {
    return process.env.BRAND_STYLE_BUILD_HASH || process.env.GITHUB_SHA;
  }
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: appRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

const buildPreamble = `const pluginBuild = Object.freeze(${JSON.stringify({
  version: packageJson.version || "0.0.0",
  commit: getCommit(),
})});`;

const uiParts = [
  "src/ui/document-start.html",
  "src/ui/styles/base.css",
  "src/ui/styles/layout.css",
  "src/ui/styles/components.css",
  "src/ui/styles/composer.css",
  "src/ui/styles/responsive.css",
  "src/ui/markup.html",
  "src/ui/state.js",
  "src/ui/telemetry.js",
  "src/ui/api-auth.js",
  "src/ui/version.js",
  "src/ui/result.js",
  "src/ui/attachments.js",
  "src/ui/palette-material.js",
  "src/ui/scenario.js",
  "src/ui/result-render.js",
  "src/ui/config.js",
  "src/ui/chat.js",
  "src/ui/window.js",
  "src/ui/auth-events.js",
  "src/ui/events.js",
  "src/ui/bootstrap.js",
];

const controllerParts = [
  "src/controller/bootstrap.js",
  "src/controller/image-metadata.js",
  "src/controller/selection.js",
  "src/controller/insert.js",
  "src/controller/messages.js",
];

async function readParts(paths) {
  return Promise.all(paths.map((path) => readFile(resolve(appRoot, path), "utf8")));
}

async function writeGenerated(path, content) {
  const destination = resolve(appRoot, path);
  const temporary = `${destination}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, content, "utf8");
  await rename(temporary, destination);
}

const [uiSources, controllerSources] = await Promise.all([
  readParts(uiParts),
  readParts(controllerParts),
]);
const stateIndex = uiParts.indexOf("src/ui/state.js");
if (stateIndex < 0 || !uiSources[stateIndex].includes("<script>")) {
  throw new Error("UI state script anchor was not found.");
}
uiSources[stateIndex] = uiSources[stateIndex].replace("<script>", `<script>${buildPreamble}`);

await Promise.all([
  writeGenerated("dist/ui.html", uiSources.join("")),
  writeGenerated("dist/code.js", controllerSources.join("")),
]);

console.log("Built dist/ui.html and dist/code.js");
