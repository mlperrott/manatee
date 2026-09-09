import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const coreDirectory = fileURLToPath(new URL("../src/core/", import.meta.url));
const forbiddenImports =
  /from\s+["'](?:solid-js|@solidjs\/web)(?:\/[^"']*)?["']/;
const forbiddenDomGlobals =
  /\b(?:document|window|HTMLElement|SVGElement|ResizeObserver|MutationObserver)\b/;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    if (entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

const violations = [];

for (const path of await sourceFiles(coreDirectory)) {
  const source = await readFile(path, "utf8");
  const name = relative(root, path);

  if (forbiddenImports.test(source)) {
    violations.push(`${name}: core must not import Solid or its DOM runtime`);
  }

  if (forbiddenDomGlobals.test(source)) {
    violations.push(`${name}: core must not reference browser DOM globals`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Document core is independent of Solid and browser DOM APIs.");
}
