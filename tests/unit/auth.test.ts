import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { DEFAULT_AFTER_LOGIN, isWorkspaceUser, safeNext } from "@/lib/auth";

const user = (email: string | undefined, hd?: string, provider = "google") =>
  ({
    email,
    app_metadata: { provider },
    user_metadata: hd === undefined ? {} : { custom_claims: { hd } },
  }) as unknown as User;

describe("security: domain restriction on sign-in (isWorkspaceUser)", () => {
  it("accepts esnmesa.org Workspace accounts", () => {
    expect(isWorkspaceUser(user("someone@esnmesa.org", "esnmesa.org"))).toBe(true);
    expect(isWorkspaceUser(user("Someone@ESNmesa.org", "ESNMESA.org"))).toBe(true);
  });

  it("rejects no user", () => {
    expect(isWorkspaceUser(null)).toBe(false);
  });

  it("rejects other domains, even with a matching hd claim", () => {
    expect(isWorkspaceUser(user("someone@gmail.com", "esnmesa.org"))).toBe(false);
    expect(isWorkspaceUser(user("someone@esnmesa.org.evil.com", "esnmesa.org"))).toBe(false);
    expect(isWorkspaceUser(user("someone@sub.esnmesa.org", "esnmesa.org"))).toBe(false);
    expect(isWorkspaceUser(user("esnmesa.org@evil.com", "esnmesa.org"))).toBe(false);
  });

  it("rejects personal Google accounts without the Workspace hd claim", () => {
    expect(isWorkspaceUser(user("someone@esnmesa.org"))).toBe(false);
    expect(isWorkspaceUser(user("someone@esnmesa.org", ""))).toBe(false);
    expect(isWorkspaceUser(user("someone@esnmesa.org", "other.org"))).toBe(false);
  });

  it("rejects other sign-in providers (e.g. email/password)", () => {
    expect(isWorkspaceUser(user("someone@esnmesa.org", "esnmesa.org", "email"))).toBe(false);
  });

  it("rejects users without an email", () => {
    expect(isWorkspaceUser(user(undefined, "esnmesa.org"))).toBe(false);
  });
});

describe("security: open-redirect protection (safeNext)", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/events/123")).toBe("/events/123");
    expect(safeNext("/kiosk/abc?x=1")).toBe("/kiosk/abc?x=1");
    expect(safeNext("/team/comms#review")).toBe("/team/comms#review");
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.example",
    "http://evil.example/path",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "%2F%2Fevil.example",
    "javascript:alert(1)",
    "/\tjavascript:alert(1)",
    "/\n/evil.example",
    "@evil.example",
    "evil.example",
    "/%E0%A4%A",
  ])("falls back to the home page for %j", (next) => {
    expect(safeNext(next as string | null)).toBe(DEFAULT_AFTER_LOGIN);
  });
});
