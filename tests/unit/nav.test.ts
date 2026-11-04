import { describe, expect, it } from "vitest";
import { isActive, navItems } from "@/lib/nav";

const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe("navigation", () => {
  it("members: personal pages only, Volunteer only while a form is open", () => {
    expect(labels(navItems([]).personal)).toEqual(["Home", "My events", "Expenses", "Ideas", "Calendar", "Ranking"]);
    expect(navItems([]).team).toEqual([]);
    // While a form is open Volunteer follows Reimbursements (round 2026-11-03 (2)).
    const open = navItems([], { open: true, submitted: false }).personal;
    expect(labels(open)).toEqual(["Home", "My events", "Expenses", "Volunteer", "Ideas", "Calendar", "Ranking"]);
    expect(open[3]).toEqual({ href: "/volunteer", label: "Volunteer", badge: "1" });
    expect(navItems([], { open: true, submitted: true }).personal[3]).toEqual({ href: "/volunteer", label: "Volunteer", badge: undefined });
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
    // Reimbursements live under /me but are their own item.
    expect(isActive("/me/reimbursements", "/me")).toBe(false);
    expect(isActive("/me/reimbursements", "/me/reimbursements")).toBe(true);
    expect(isActive("/me", "/me")).toBe(true);
  });
});
