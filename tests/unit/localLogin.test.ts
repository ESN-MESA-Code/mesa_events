// Security: the local test sign-in must never be offered against a real
// project, and never in a production build.
import { describe, expect, it } from "vitest";
import { LOCAL_USERS, isLocalSupabaseUrl, isLocalUser, localLoginEnabled } from "@/lib/localLogin";

describe("isLocalSupabaseUrl", () => {
  it.each(["http://127.0.0.1:54421", "http://localhost:54421", "http://[::1]:54421"])("%s is local", (url) => {
    expect(isLocalSupabaseUrl(url)).toBe(true);
  });

  it.each(["https://abcdefgh.supabase.co", "https://127.0.0.1.evil.example", "https://localhost.evil.example", "not a url", "", undefined])(
    "%s is not local",
    (url) => {
      expect(isLocalSupabaseUrl(url)).toBe(false);
    }
  );
});

describe("localLoginEnabled", () => {
  const local = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421", NEXT_PUBLIC_LOCAL_LOGIN: "true" };

  it("is on in development with the flag and a local Supabase", () => {
    expect(localLoginEnabled({ ...local, NODE_ENV: "development" })).toBe(true);
    expect(localLoginEnabled({ ...local, NODE_ENV: "test" })).toBe(true);
  });

  it("needs the flag", () => {
    expect(localLoginEnabled({ ...local, NODE_ENV: "development", NEXT_PUBLIC_LOCAL_LOGIN: "" })).toBe(false);
    expect(localLoginEnabled({ ...local, NODE_ENV: "development", NEXT_PUBLIC_LOCAL_LOGIN: "1" })).toBe(false);
  });

  it("needs a Supabase on this machine", () => {
    expect(localLoginEnabled({ ...local, NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co" })).toBe(false);
  });

  it("can never be enabled in a production build, whatever else is set", () => {
    expect(localLoginEnabled({ ...local, NODE_ENV: "production" })).toBe(false);
    expect(localLoginEnabled({ NODE_ENV: "production", NEXT_PUBLIC_LOCAL_LOGIN: "true", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54421" })).toBe(false);
  });

  it("only signs in as seeded members", () => {
    expect(isLocalUser("events@esnmesa.org")).toBe(true);
    expect(isLocalUser("someone.else@esnmesa.org")).toBe(false);
    expect(LOCAL_USERS.every((u) => u.email.endsWith("@esnmesa.org"))).toBe(true);
  });
});
