import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(appRoot, "src");
const outputDir = resolve(appRoot, "../web/public/app");
const node = process.execPath;

for (const name of await readdir(sourceDir)) {
  const path = resolve(sourceDir, name);
  const content = await readFile(path, "utf8");
  const lines = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  if (lines > 500) throw new Error(`${name} exceeds 500 lines`);
  if (extname(name) === ".js") {
    execFileSync(node, ["--check", path], { stdio: "inherit" });
  }
  const output = await readFile(resolve(outputDir, name), "utf8");
  if (output !== content) throw new Error(`${name} has not been rebuilt`);
}

const html = await readFile(resolve(sourceDir, "index.html"), "utf8");
for (const required of ["login-dialog", "prompt-input", "generate-button", "result-grid"]) {
  if (!html.includes(`id="${required}"`)) throw new Error(`Web client is missing #${required}`);
}
console.log("Web client source checks passed");
