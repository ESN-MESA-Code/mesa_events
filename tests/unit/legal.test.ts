// The legal texts in legal/*.md: every placeholder resolves, and the form
// texts say what the privacy notice promises.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL } from "@/lib/legal";
import { attendanceFormTexts, fillPlaceholders, legalHtml } from "@/lib/legalContent";

const texts = fs
  .readdirSync("legal")
  .filter((f) => f.endsWith(".md") && f !== "DATA_PROTECTION.md")
  .map((f) => f.replace(/\.md$/, ""));

describe("fillPlaceholders", () => {
  it("fills nested values", () => {
    expect(fillPlaceholders("Mail {{association.email}}, {{ retention.years }} years")).toBe(
      `Mail ${LEGAL.association.email}, ${LEGAL.retention.years} years`
    );
  });

  it("fails on unknown placeholders", () => {
    expect(() => fillPlaceholders("{{association.phone}}")).toThrow("unknown placeholder {{association.phone}}");
    expect(() => fillPlaceholders("{{association}}")).toThrow();
  });
});

describe("legal texts", () => {
  it("has the pages and form texts", () => {
    expect(texts).toEqual(
      expect.arrayContaining([
        "impressum",
        "privacy.en",
        "privacy.de",
        "terms.en",
        "form-terms.en",
        "form-data-processing.en",
      ])
    );
  });

  it.each(texts)("%s renders with every placeholder filled", (name) => {
    const html = legalHtml(name);
    expect(html).not.toMatch(/\{\{|\}\}/);
    expect(html.length).toBeGreaterThan(100);
  });

  it("the example deletion year matches the retention period", () => {
    const { years, example_event_year, example_deletion_year } = LEGAL.retention;
    expect(example_deletion_year).toBe(example_event_year + years);
  });

  it("the retention period is spelled out the same everywhere", () => {
    expect(LEGAL.retention).toMatchObject({ years: 3, ordinal_en: "third", ordinal_de: "dritten" });
  });

  it.each(["notice_version", "terms_version", "confidentiality_version"] as const)("%s is a date", (key) => {
    expect(LEGAL[key]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the form's terms box names the version and links the full terms", () => {
    const { terms } = attendanceFormTexts();
    expect(terms).toContain(`(version ${LEGAL.terms_version})`);
    expect(terms).toContain('<a target="_blank" rel="noopener" href="/terms">Full participation terms</a>');
    // The corrected liability clause, not the old invalid disclaimer.
    expect(terms).toContain("injury to life, body or health");
    expect(terms).not.toMatch(/gross breach of duty|at your own risk|of legal full age/i);
  });

  it("the full terms carry the same version", () => {
    expect(legalHtml("terms.en")).toContain(`version ${LEGAL.terms_version}`);
  });

  it("the form names the contact email and the retention period", () => {
    const { dataProcessing } = attendanceFormTexts();
    expect(dataProcessing).toContain(`mailto:${LEGAL.association.email}`);
    expect(dataProcessing).toContain(`end of the ${LEGAL.retention.ordinal_en} year after the event`);
    // Legitimate interest with a right to object – not consent.
    expect(dataProcessing).toContain("Art. 6(1)(f) GDPR");
    expect(dataProcessing).toMatch(/<strong>You can object at any time, on grounds relating to your particular situation/);
    // Names for organisers while the event is on, then executives; no funders.
    expect(dataProcessing).toContain("afterwards only our executives");
    // The optional answers are only counted.
    expect(dataProcessing).toContain("never stored with your name");
    expect(dataProcessing).not.toMatch(/funder|auditor|signature/i);
    expect(dataProcessing).toContain("paper list");
    // The full notice is one click away, in a new tab.
    expect(dataProcessing).toContain('<a target="_blank" rel="noopener" href="/privacy">');
    expect(dataProcessing).toContain('<a target="_blank" rel="noopener" href="/datenschutz">');
    expect(dataProcessing).not.toMatch(/consent/i);
  });
});
