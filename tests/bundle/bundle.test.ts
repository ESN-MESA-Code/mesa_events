// Security: after a production build (`npm run build:local`), nothing in
// the browser bundle (.next/static) may carry server secrets – the
// service-role key, the jobs secret, Google credentials, the seeded
// password – and the local test sign-in must be compiled out.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LOCAL_ENV } from "../../scripts/local-supabase.mjs";

const STATIC = ".next/static";
let files: Array<{ name: string; text: string }> = [];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

beforeAll(() => {
  if (!fs.existsSync(STATIC)) throw new Error("No production build – run `npm run build:local` first.");
  files = walk(STATIC)
    .filter((f) => /\.(js|css|json|html|map|txt)$/.test(f))
    .map((name) => ({ name, text: fs.readFileSync(name, "utf8") }));
});

const containing = (needle: string) => files.filter((f) => f.text.includes(needle)).map((f) => f.name);

describe("the browser bundle", () => {
  it("was built (sanity check)", () => {
    expect(files.length).toBeGreaterThan(10);
    // The public anon key is meant to be there – proves the scan reads the chunks.
    expect(containing(LOCAL_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY).length).toBeGreaterThan(0);
  });

  it.each([
    ["the service-role key", LOCAL_ENV.SUPABASE_SERVICE_ROLE_KEY],
    ["the jobs secret", LOCAL_ENV.JOBS_SECRET],
    ["the seeded members' password", "local-test-password"],
    ["the service-role env name", "SUPABASE_SERVICE_ROLE_KEY"],
    ["the jobs secret env name", "JOBS_SECRET"],
    ["Google credentials", "GOOGLE_SERVICE_ACCOUNT_KEY"],
    ["a private key", "BEGIN PRIVATE KEY"],
  ])("contains no %s", (_, needle) => {
    expect(containing(needle)).toEqual([]);
  });

  it("has the local test sign-in compiled out (production build)", () => {
    expect(containing("Local test sign-in")).toEqual([]);
    expect(containing("/auth/local-login")).toEqual([]);
  });

  it("ships no source maps", () => {
    expect(files.filter((f) => f.name.endsWith(".map"))).toEqual([]);
  });
});
