// Lets plain `node` run the app's TypeScript modules (lib/staging/*) for the
// staging seed scripts – import it first (`import "./staging/ts-loader.mjs"`).
// Resolves the "@/…" path alias of tsconfig.json and extensionless imports,
// and compiles the app's .ts files with the project's own TypeScript
// (`transpileModule`, no type check) – Node's built-in type stripping cannot
// handle all of their syntax (constructor parameter properties).
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ROOT_URL = pathToFileURL(ROOT).href;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];
const ts = createRequire(import.meta.url)("typescript");

function findFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) if (existsSync(path.join(base, `index${ext}`))) return path.join(base, `index${ext}`);
  return null;
}

function resolve(specifier, context, nextResolve) {
  let base = null;
  if (specifier.startsWith("@/")) base = path.join(ROOT, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith(ROOT_URL) && !context.parentURL.includes("/node_modules/")) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    const file = findFile(base);
    if (file) return nextResolve(pathToFileURL(file).href, context);
  }
  return nextResolve(specifier, context);
}

function load(url, context, nextLoad) {
  if (url.startsWith(ROOT_URL) && !url.includes("/node_modules/") && /\.(ts|mts)$/.test(new URL(url).pathname)) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  // `import details from "../legal/details.json"` (bundlers need no import attribute).
  if (url.startsWith(ROOT_URL) && url.endsWith(".json")) {
    return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}

registerHooks({ resolve, load });
