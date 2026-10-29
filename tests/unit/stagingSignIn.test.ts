// Security: the staging demo sign-in – access code, cookie, rate limit,
// derived passwords, and a cast of demo addresses only.
import { describe, expect, it } from "vitest";
import { AttemptLimiter, accessCookieValue, clientKey, codeMatches, hasAccess } from "@/lib/staging/access";
import { DEMO_PEOPLE, PERSONAS, demoEmail, isDemoEmail, persona, person } from "@/lib/staging/people";
import { demoPassword } from "@/lib/staging/password";

const CODE = "correct-horse-battery-staple";

describe("access code", () => {
  it("matches only the exact code", () => {
    expect(codeMatches(CODE, CODE)).toBe(true);
    expect(codeMatches(CODE.toUpperCase(), CODE)).toBe(false);
    expect(codeMatches(`${CODE} `, CODE)).toBe(false);
    expect(codeMatches("", CODE)).toBe(false);
    expect(codeMatches("", "")).toBe(false);
  });

  it("leaves a cookie bound to the code and the project", () => {
    const cookie = accessCookieValue(CODE, "stagingref");
    expect(cookie).not.toContain(CODE);
    expect(hasAccess(cookie, CODE, "stagingref")).toBe(true);
    expect(hasAccess(cookie, "another-code-of-16-chars", "stagingref")).toBe(false);
    expect(hasAccess(cookie, CODE, "otherref")).toBe(false);
    expect(hasAccess(undefined, CODE, "stagingref")).toBe(false);
    expect(hasAccess(cookie, undefined, "stagingref")).toBe(false);
    expect(hasAccess(cookie, CODE, null)).toBe(false);
    expect(hasAccess("forged", CODE, "stagingref")).toBe(false);
  });

  it("knows the client from the proxy's header", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(clientKey(new Headers())).toBe("unknown");
  });
});

describe("rate limit", () => {
  it("stops a client after 5 failures for 15 minutes", () => {
    const l = new AttemptLimiter(5, 30, 15 * 60_000);
    for (let i = 0; i < 5; i++) {
      expect(l.allowed("a", 1000 + i)).toBe(true);
      l.fail("a", 1000 + i);
    }
    expect(l.allowed("a", 2000)).toBe(false);
    expect(l.allowed("b", 2000)).toBe(true);
    expect(l.allowed("a", 1000 + 15 * 60_000 + 10)).toBe(true);
  });

  it("stops everyone after too many failures overall", () => {
    const l = new AttemptLimiter(5, 30, 15 * 60_000);
    for (let i = 0; i < 30; i++) l.fail(`client-${i}`, 1000);
    expect(l.allowed("fresh", 1001)).toBe(false);
  });

  it("forgets a client's failures after a correct code", () => {
    const l = new AttemptLimiter(2, 30, 60_000);
    l.fail("a", 1);
    l.succeed("a");
    l.fail("a", 2);
    expect(l.allowed("a", 3)).toBe(true);
  });
});

describe("demo passwords", () => {
  it("are derived from the service-role key and the address", () => {
    const a = demoPassword("anna.kowalska.demo@esnmesa.org", "key-1");
    expect(a).toBe(demoPassword("ANNA.KOWALSKA.demo@esnmesa.org", "key-1"));
    expect(a).not.toBe(demoPassword("anna.kowalska.demo@esnmesa.org", "key-2"));
    expect(a).not.toBe(demoPassword("hiro.takeda.demo@esnmesa.org", "key-1"));
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
  it("need the key", () => {
    expect(() => demoPassword("x.demo@esnmesa.org", "")).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("the demo cast", () => {
  const emails = DEMO_PEOPLE.map((p) => demoEmail(p, "esnmesa.org"));

  it("has about 40 people with unique demo addresses and ids", () => {
    expect(DEMO_PEOPLE.length).toBeGreaterThanOrEqual(38);
    expect(new Set(emails).size).toBe(DEMO_PEOPLE.length);
    expect(new Set(DEMO_PEOPLE.map((p) => p.id)).size).toBe(DEMO_PEOPLE.length);
    for (const e of emails) expect(isDemoEmail(e, "esnmesa.org"), e).toBe(true);
  });

  it("covers every team role and a newcomer", () => {
    const roles = new Set(DEMO_PEOPLE.flatMap((p) => p.roles));
    for (const r of ["events", "comms", "finance", "treasurer", "executive", "admin"]) expect(roles.has(r as never), r).toBe(true);
    expect(DEMO_PEOPLE.some((p) => p.newcomer)).toBe(true);
    expect(DEMO_PEOPLE.filter((p) => p.active).length).toBeGreaterThanOrEqual(3);
  });

  it("isDemoEmail refuses real-looking and foreign addresses", () => {
    expect(isDemoEmail("anna.demo@esnmesa.org", "esnmesa.org")).toBe(true);
    expect(isDemoEmail("events@esnmesa.org", "esnmesa.org")).toBe(false);
    expect(isDemoEmail("demo@esnmesa.org", "esnmesa.org")).toBe(false);
    expect(isDemoEmail("anna.demo@esnmesa.org.evil", "esnmesa.org")).toBe(false);
    expect(isDemoEmail("anna.demo@esnmesaxorg", "esnmesa.org")).toBe(false);
    expect(isDemoEmail("anna.demox@esnmesa.org", "esnmesa.org")).toBe(false);
  });

  it("offers a persona per role, each a cast member with a description", () => {
    expect(PERSONAS.map((p) => p.key).sort()).toEqual(["admin", "comms", "events", "executive", "finance", "helper", "member", "newcomer", "oc", "treasurer"]);
    for (const p of PERSONAS) {
      expect(person(p.person)).toBeTruthy();
      expect(p.sees.length).toBeGreaterThan(30);
      expect(p.start.startsWith("/")).toBe(true);
    }
    expect(person(persona("newcomer")!.person).newcomer).toBe(true);
    expect(person(persona("events")!.person).roles).toContain("events");
    expect(person(persona("treasurer")!.person).roles).toContain("treasurer");
    expect(persona("../../admin")).toBeUndefined();
  });
});
