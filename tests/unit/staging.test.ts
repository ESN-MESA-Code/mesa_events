// Security: the staging gates (demo sign-in, demo data reset) and the boot
// check that keeps a staging deployment on fakes and off the production
// database – every combination.
import { describe, expect, it } from "vitest";
import {
  MIN_ACCESS_CODE_LENGTH,
  failedStagingGates,
  parseAppEnv,
  stagingConfigProblems,
  stagingGatesHold,
  stagingSignInEnabled,
  supabaseProjectRef,
} from "@/lib/staging";
import { googleMode } from "@/lib/google";
import { securityHeaders, isPublicPath } from "@/lib/securityHeaders";
import { dmRecipient, folderPath, parseOutboxKind, readableChatText, sortOutbox } from "@/lib/demoOutbox";

const CODE = "correct-horse-battery-staple";
const ok = {
  NEXT_PUBLIC_APP_ENV: "staging",
  APP_ENV: "staging",
  NEXT_PUBLIC_SUPABASE_URL: "https://stagingref123.supabase.co",
  STAGING_SUPABASE_PROJECT_REF: "stagingref123",
  PRODUCTION_SUPABASE_PROJECT_REF: "prodref456",
};

describe("parseAppEnv", () => {
  it.each(["production", "staging", "development", " Staging "])("accepts %s", (v) => {
    expect(parseAppEnv(v, "production")).toBe(v.trim().toLowerCase());
  });
  it("defaults by NODE_ENV", () => {
    expect(parseAppEnv(undefined, "production")).toBe("production");
    expect(parseAppEnv("", "development")).toBe("development");
    expect(parseAppEnv("prod", "production")).toBe("production");
    expect(parseAppEnv("stage", "test")).toBe("development");
  });
});

describe("supabaseProjectRef", () => {
  it.each([
    ["https://abcdefgh.supabase.co", "abcdefgh"],
    ["https://ABCDEFGH.supabase.co/", "abcdefgh"],
    ["http://127.0.0.1:54421", "127.0.0.1:54421"],
    ["https://supabase.staging.example.org", "supabase.staging.example.org"],
    ["https://abcdefgh.supabase.co.evil.example", "abcdefgh.supabase.co.evil.example"],
  ])("%s → %s", (url, ref) => {
    expect(supabaseProjectRef(url)).toBe(ref);
  });
  it.each(["", undefined, "not a url", "ftp://abcdefgh.supabase.co"])("%s → null", (url) => {
    expect(supabaseProjectRef(url)).toBeNull();
  });
});

describe("the staging gates", () => {
  it("hold when all four hold", () => {
    expect(failedStagingGates(ok)).toEqual([]);
    expect(stagingGatesHold(ok)).toBe(true);
    expect(stagingGatesHold({ ...ok, PRODUCTION_SUPABASE_PROJECT_REF: undefined })).toBe(true);
    expect(stagingGatesHold({ ...ok, PRODUCTION_SUPABASE_PROJECT_REF: "" })).toBe(true);
  });

  // Every subset of the four conditions failing: only "none fails" opens.
  const breakers: Record<string, Partial<typeof ok>> = {
    build: { NEXT_PUBLIC_APP_ENV: "production" },
    runtime: { APP_ENV: "production" },
    ref: { STAGING_SUPABASE_PROJECT_REF: "otherref" },
    production: { PRODUCTION_SUPABASE_PROJECT_REF: "stagingref123" },
  };
  const names = Object.keys(breakers);
  const subsets = Array.from({ length: 2 ** names.length }, (_, mask) => names.filter((_, i) => mask & (1 << i)));
  it.each(subsets.map((s) => [s.join(" + ") || "none", s] as const))("failing: %s", (_, failing) => {
    const env = Object.assign({}, ok, ...failing.map((n) => breakers[n]));
    expect(stagingGatesHold(env)).toBe(failing.length === 0);
    expect(failedStagingGates(env).length).toBeGreaterThanOrEqual(failing.length);
  });

  it("refuse a missing or mistyped environment", () => {
    expect(stagingGatesHold({ ...ok, NEXT_PUBLIC_APP_ENV: undefined })).toBe(false);
    expect(stagingGatesHold({ ...ok, APP_ENV: undefined })).toBe(false);
    expect(stagingGatesHold({ ...ok, APP_ENV: "Staging " })).toBe(false);
    expect(stagingGatesHold({ ...ok, NEXT_PUBLIC_APP_ENV: "development" })).toBe(false);
  });

  it("need the staging ref, and the database to be that project", () => {
    expect(stagingGatesHold({ ...ok, STAGING_SUPABASE_PROJECT_REF: undefined })).toBe(false);
    expect(stagingGatesHold({ ...ok, STAGING_SUPABASE_PROJECT_REF: "  " })).toBe(false);
    expect(stagingGatesHold({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "https://prodref456.supabase.co" })).toBe(false);
    expect(stagingGatesHold({ ...ok, NEXT_PUBLIC_SUPABASE_URL: undefined })).toBe(false);
    // A look-alike host is not the project.
    expect(stagingGatesHold({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "https://stagingref123.supabase.co.evil.example" })).toBe(false);
  });

  it("refuse the production project even when it is named as staging", () => {
    const prod = { ...ok, NEXT_PUBLIC_SUPABASE_URL: "https://prodref456.supabase.co", STAGING_SUPABASE_PROJECT_REF: "prodref456" };
    expect(failedStagingGates(prod)).toContain("the staging project is PRODUCTION_SUPABASE_PROJECT_REF");
    expect(stagingGatesHold({ ...prod, PRODUCTION_SUPABASE_PROJECT_REF: "PRODREF456" })).toBe(false);
  });

  it("work for the local stack and a self-hosted Supabase (host and port)", () => {
    expect(stagingGatesHold({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421", STAGING_SUPABASE_PROJECT_REF: "127.0.0.1:54421" })).toBe(true);
    expect(stagingGatesHold({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "https://db.staging.example.org", STAGING_SUPABASE_PROJECT_REF: "db.staging.example.org" })).toBe(true);
  });
});

describe("stagingSignInEnabled", () => {
  it("needs the gates and an access code of at least 16 characters", () => {
    expect(stagingSignInEnabled({ ...ok, STAGING_ACCESS_CODE: CODE })).toBe(true);
    expect(stagingSignInEnabled({ ...ok, STAGING_ACCESS_CODE: "x".repeat(MIN_ACCESS_CODE_LENGTH) })).toBe(true);
    expect(stagingSignInEnabled({ ...ok, STAGING_ACCESS_CODE: "x".repeat(MIN_ACCESS_CODE_LENGTH - 1) })).toBe(false);
    expect(stagingSignInEnabled({ ...ok, STAGING_ACCESS_CODE: undefined })).toBe(false);
    expect(stagingSignInEnabled({ ...ok, APP_ENV: "production", STAGING_ACCESS_CODE: CODE })).toBe(false);
    expect(stagingSignInEnabled({ ...ok, NEXT_PUBLIC_APP_ENV: "production", STAGING_ACCESS_CODE: CODE })).toBe(false);
  });

  it("is off in this (non-staging) build by default", () => {
    expect(stagingSignInEnabled()).toBe(false);
  });
});

describe("stagingConfigProblems (boot check)", () => {
  const env = { ...ok, GOOGLE_MODE: "fake", STAGING_ACCESS_CODE: CODE };
  const run = (e: Record<string, string | undefined>, build = "staging") => stagingConfigProblems(e, build);

  it("passes a correct staging configuration", () => {
    expect(run(env)).toEqual([]);
  });

  it("ignores production and development", () => {
    expect(run({ GOOGLE_MODE: "real", GOOGLE_SERVICE_ACCOUNT_KEY: "k" }, "production")).toEqual([]);
    expect(stagingConfigProblems({}, undefined)).toEqual([]);
    expect(stagingConfigProblems({ APP_ENV: "development" }, "development")).toEqual([]);
  });

  it("refuses a build and runtime that disagree", () => {
    expect(run({ ...env, APP_ENV: "production" })[0]).toMatch(/staging build .* APP_ENV is not staging/);
    expect(run(env, "production")[0]).toMatch(/needs a staging build/);
  });

  it("refuses any Google mode but fake", () => {
    expect(run({ ...env, GOOGLE_MODE: "real" }).join()).toMatch(/GOOGLE_MODE must be "fake"/);
    expect(run({ ...env, GOOGLE_MODE: undefined }).join()).toMatch(/GOOGLE_MODE must be "fake" on staging \(is unset\)/);
  });

  it.each(["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_KEY", "TELEGRAM_BOT_TOKEN"])("refuses real credentials: %s", (name) => {
    expect(run({ ...env, [name]: "something" }).join()).toContain(`${name} must not be set`);
    expect(run({ ...env, [name]: "  " })).toEqual([]);
  });

  it("refuses a short access code and the production database", () => {
    expect(run({ ...env, STAGING_ACCESS_CODE: "short" }).join()).toMatch(/at least 16/);
    expect(run({ ...env, NEXT_PUBLIC_SUPABASE_URL: "https://prodref456.supabase.co" }).join()).toMatch(/not STAGING_SUPABASE_PROJECT_REF/);
  });
});

describe("fakes on staging", () => {
  it("googleMode is fake on staging whatever else is set", () => {
    const real = { GOOGLE_MODE: "real", GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@b.iam.gserviceaccount.com", GOOGLE_SERVICE_ACCOUNT_KEY: "-----BEGIN PRIVATE KEY-----" };
    expect(googleMode({ ...real, APP_ENV: "staging" })).toBe("fake");
    expect(googleMode(real)).toBe("real");
  });
});

describe("noindex", () => {
  it("is sent on staging only", () => {
    expect(securityHeaders("n", { noindex: true })["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(securityHeaders("n")["X-Robots-Tag"]).toBeUndefined();
  });
  it("robots.txt and the demo sign-in need no session", () => {
    expect(isPublicPath("/robots.txt")).toBe(true);
    expect(isPublicPath("/staging")).toBe(true);
    expect(isPublicPath("/stagingx")).toBe(false);
  });
});

describe("demo outbox", () => {
  it("shows mentions as names", () => {
    const names = new Map([["anna.demo@esnmesa.org", "Anna Kowalska"]]);
    expect(readableChatText("Hi <users/anna.demo@esnmesa.org> and <users/x@esnmesa.org>! <users/all>", names)).toBe("Hi @Anna Kowalska and @x@esnmesa.org! @all");
  });
  it("knows direct messages", () => {
    expect(dmRecipient("dm:anna.demo@esnmesa.org")).toBe("anna.demo@esnmesa.org");
    expect(dmRecipient("spaces/FAKE123")).toBeNull();
  });
  it("parses the filter", () => {
    expect(parseOutboxKind("dm")).toBe("dm");
    expect(parseOutboxKind(["folder", "x"])).toBe("folder");
    expect(parseOutboxKind("<script>")).toBe("all");
    expect(parseOutboxKind(undefined)).toBe("all");
  });
  it("sorts newest first and builds folder paths", () => {
    const e = (at: string, title: string) => ({ kind: "message" as const, at, where: "", title, body: "", meta: [] });
    expect(sortOutbox([e("2026-01-01", "a"), e("2026-02-01", "b"), e("2026-02-01", "a")]).map((x) => x.at + x.title)).toEqual(["2026-02-01a", "2026-02-01b", "2026-01-01a"]);
    const folders = new Map([
      ["s", { name: "WiSe_26-27", parent: "root" }],
      ["e", { name: "2026-11-05 Pub Quiz", parent: "s" }],
    ]);
    expect(folderPath("e", folders)).toBe("WiSe_26-27 / 2026-11-05 Pub Quiz");
  });
});
