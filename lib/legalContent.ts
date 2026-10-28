// Renders the legal texts in legal/*.md for the pages that show them. The
// texts use {{placeholders}} for the facts in legal/details.json, so a change
// of address or email is one edit. Server only: reads the files from disk.
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { LEGAL } from "@/lib/legal";

const DIR = path.join(process.cwd(), "legal");

/** Replaces {{a.b}} with the value at that path in details.json; unknown names fail loudly. */
export function fillPlaceholders(text: string, values: object = LEGAL): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = key
      .split(".")
      .reduce<unknown>((obj, part) => (obj as Record<string, unknown> | undefined)?.[part], values);
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`legal texts: unknown placeholder {{${key}}}`);
    }
    return String(value);
  });
}

function read(name: string): string {
  return fillPlaceholders(fs.readFileSync(path.join(DIR, `${name}.md`), "utf8"));
}

/** A legal text as HTML (the files are ours, so no sanitising is needed). */
export function legalHtml(name: string): string {
  return marked.parse(read(name), { async: false });
}

/** Links in a form text open a new tab, so the form keeps what was entered. */
function inNewTab(html: string): string {
  return html.replace(/<a href="\//g, '<a target="_blank" rel="noopener" href="/');
}

/** Everything the attendance form shows from legal/, rendered on the server. */
export function attendanceFormTexts() {
  return {
    terms: inNewTab(legalHtml("form-terms.en")),
    dataProcessing: inNewTab(legalHtml("form-data-processing.en")),
  };
}
