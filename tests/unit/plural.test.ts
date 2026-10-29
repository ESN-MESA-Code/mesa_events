// One plural helper for the UI (review 2026-10-29 B3), and no "(s)" or
// "(e)" left in the app's texts.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAre, plural } from "@/lib/plural";

describe("plural", () => {
  it("counts regular and irregular nouns", () => {
    expect(plural(1, "helper slot")).toBe("1 helper slot");
    expect(plural(2, "helper slot")).toBe("2 helper slots");
    expect(plural(0, "helper")).toBe("0 helpers");
    expect(plural(1, "Beleg", "Belege")).toBe("1 Beleg");
    expect(plural(3, "Beleg", "Belege")).toBe("3 Belege");
    expect(`${plural(1, "helper slot")} ${isAre(1)} open`).toBe("1 helper slot is open");
    expect(`${plural(2, "helper slot")} ${isAre(2)} open`).toBe("2 helper slots are open");
  });
});

describe("UI texts", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });

  it('use plural() instead of "slot(s)", "Beleg(e)" or `n === 1 ? "" : "s"`', () => {
    const offenders: string[] = [];
    for (const f of [...files("app"), ...files("components"), ...files("lib")].filter((f) => !/plural.ts$/.test(f))) {
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((line, i) => {
        if (/[A-Za-z]\((s|e|es)\)(?![\w(])/.test(line.replace(/\b(paragraph|oneLine|String|isTbaPrice|add|test)\(s\)/g, "")) || /=== 1 \? "" : "s"/.test(line)) {
          offenders.push(`${f}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
