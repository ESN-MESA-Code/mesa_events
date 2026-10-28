import { describe, expect, it } from "vitest";
import { backLink, withFrom } from "@/lib/breadcrumbs";

describe("event breadcrumbs", () => {
  it("lead back to where the event was opened", () => {
    expect(backLink("me")).toEqual({ label: "My events", href: "/me" });
    expect(backLink("home")).toEqual({ label: "Home", href: "/" });
    expect(backLink("cycle:0b4a3c2e-1111-4222-8333-444455556666")).toEqual({ label: "Month schedule", href: "/team/events/cycles/0b4a3c2e-1111-4222-8333-444455556666" });
  });

  it("anything else falls back to the calendar and is not passed on", () => {
    for (const f of [null, "", "https://evil.example", "cycle:../../admin", "javascript:alert(1)"]) expect(backLink(f)).toEqual({ label: "Calendar", href: "/calendar" });
    expect(withFrom("/events/1/hand-in", "https://evil.example")).toBe("/events/1/hand-in");
    expect(withFrom("/events/1/hand-in", "me")).toBe("/events/1/hand-in?from=me");
    expect(withFrom("/events/1?x=1", "calendar")).toBe("/events/1?x=1&from=calendar");
  });
});
