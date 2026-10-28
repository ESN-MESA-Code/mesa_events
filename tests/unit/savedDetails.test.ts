import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSavedDetails, loadSavedDetails, saveDetails, type SavedDetails } from "@/lib/savedDetails";

const KEY = "mesa_attendance_details";

// Minimal localStorage.
class MemoryStorage {
  items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

const details: SavedDetails = {
  first_name: "Jane",
  last_name: "Doe; =evil",
  nationality: "FR",
  university: "LMU",
  exchange_program: "Erasmus+",
  esn_card: "yes",
};

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  Object.assign(globalThis, { localStorage: store });
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe("saved details", () => {
  it("round-trips the details, including awkward characters", () => {
    saveDetails(details);
    expect(loadSavedDetails()).toEqual(details);
  });

  it("are stored in localStorage", () => {
    saveDetails(details);
    expect(store.items.has(KEY)).toBe(true);
  });

  it("keep optional answers that were left out", () => {
    const partial: SavedDetails = { ...details, nationality: "", university: "", exchange_program: "", esn_card: "" };
    saveDetails(partial);
    expect(loadSavedDetails()).toEqual(partial);
  });

  it("returns null when nothing is saved", () => {
    expect(loadSavedDetails()).toBeNull();
  });

  it("returns null for corrupt data", () => {
    store.setItem(KEY, "{not-json");
    expect(loadSavedDetails()).toBeNull();
  });

  it("forgets the details", () => {
    saveDetails(details);
    forgetSavedDetails();
    expect(loadSavedDetails()).toBeNull();
  });

  it("expires after a year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    saveDetails(details);
    vi.setSystemTime(new Date("2026-12-31T00:00:00Z"));
    expect(loadSavedDetails()).toEqual(details);
    vi.setSystemTime(new Date("2027-01-02T00:00:00Z"));
    expect(loadSavedDetails()).toBeNull();
    expect(store.items.has(KEY)).toBe(false);
  });

  it("works without localStorage (blocked site data)", () => {
    delete (globalThis as Record<string, unknown>).localStorage;
    expect(() => saveDetails(details)).not.toThrow();
    expect(loadSavedDetails()).toBeNull();
  });
});
