import { describe, expect, it } from "vitest";
import { isActive, navItems } from "@/lib/nav";

const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe("navigation", () => {
  it("members: personal pages only, Volunteer only while a form is open", () => {
    expect(labels(navItems([]).personal)).toEqual(["Home", "Calendar", "My events", "Ideas", "Office hours"]);
    expect(navItems([]).team).toEqual([]);
    const open = navItems([], { open: true, submitted: false }).personal.at(-1);
    expect(open).toEqual({ href: "/volunteer", label: "Volunteer", badge: "1" });
    expect(navItems([], { open: true, submitted: true }).personal.at(-1)).toEqual({ href: "/volunteer", label: "Volunteer", badge: undefined });
  });

  it("team pages are their own group; executives see all of them (incl. Finance), not Admin", () => {
    expect(labels(navItems(["events"]).team)).toEqual(["Events"]);
    expect(labels(navItems(["treasurer"]).team)).toEqual(["Finance"]);
    expect(labels(navItems(["executive"]).team)).toEqual(["Events", "Comms", "Finance", "Internal", "ESN Activities"]);
    expect(labels(navItems(["hr"]).team)).toEqual(["Internal"]);
    expect(labels(navItems(["vice_president"]).team)).toEqual(["Internal"]);
    expect(labels(navItems(["admin"]).team)).toEqual(["Admin"]);
    expect(labels(navItems(["executive"]).personal)).not.toContain("Finance");
  });

  it("Home is active only on the Home page", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/calendar", "/")).toBe(false);
    expect(isActive("/team/events/cycles/x", "/team/events")).toBe(true);
    expect(isActive("/team/eventsx", "/team/events")).toBe(false);
  });
});
