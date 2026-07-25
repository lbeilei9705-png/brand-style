import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(appRoot, "public");
const fragmentNames = [
  "admin-shell.html",
  "admin-telemetry.html",
  "admin-modals-basic.html",
  "admin-modals-skills.html",
];
const fragments = await Promise.all(
  fragmentNames.map((name) => readFile(resolve(publicDir, name), "utf8")),
);
const documentStart = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Brand Style Admin</title>
    <link rel="stylesheet" href="/styles.css" />
    <link rel="stylesheet" href="/admin-base.css" />
    <link rel="stylesheet" href="/admin-tables.css" />
    <link rel="stylesheet" href="/admin-forms.css" />
    <link rel="stylesheet" href="/admin-telemetry.css" />
  </head>
  <body>
`;
const documentEnd = `    <script type="module" src="/admin.js?v=20260725-modules"></script>
  </body>
</html>
`;
const content = `${documentStart}${fragments.join("")}${documentEnd}`;
const destination = resolve(publicDir, "admin.html");
const temporary = `${destination}.tmp`;

await writeFile(temporary, content, "utf8");
await rename(temporary, destination);
console.log("Built public/admin.html");
