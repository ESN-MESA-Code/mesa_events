import { describe, expect, it } from "vitest";
import { defaultTimes, formatMinutes, monthsBetween, parseSemesterKey, repeatDates, semesterFor, shiftSemester, hasCashBox, hasPresentation, internalPath, internalStaffing, isStaffed, takesSignUps, weekdaysInMonth } from "@/lib/internal";
import { buildCalendar, foldLine, icsDate, icsEscape, type IcalItem } from "@/lib/ical";
import { cardRevenue, cashStatus, cleanCounts, countTotal, denominationLabel, difference, expectedClosing, takings } from "@/lib/cash";
import { byCategory, perEvent, totals, type CashRow, type ClaimRow, type LedgerRow } from "@/lib/finance";

describe("internal kinds", () => {
  it("staffed kinds, meetings, sign-ups and cash boxes", () => {
    expect(isStaffed("office_hour")).toBe(true);
    expect(isStaffed("stammtisch")).toBe(true);
    expect(isStaffed("internal")).toBe(false);
    expect(hasPresentation("tuesday_talk")).toBe(true);
    expect(hasPresentation("board_meeting")).toBe(true);
    expect(hasPresentation("office_hour")).toBe(false);
    expect(takesSignUps("internal")).toBe(true);
    expect(takesSignUps("stammtisch")).toBe(false);
    expect(hasCashBox("office_hour")).toBe(true);
    expect(hasCashBox("tuesday_talk")).toBe(false);
  });

  it("office hours have their own page", () => {
    expect(internalPath("office_hour", "x")).toBe("/office-hours/x");
    expect(internalPath("stammtisch", "x")).toBe("/internal/x");
  });

  it("staffing", () => {
    expect(internalStaffing(false, 3, 1)).toBe("no_oc");
    expect(internalStaffing(true, 0, 1)).toBe("short");
    expect(internalStaffing(true, 1, 1)).toBe("staffed");
  });
});

describe("Repeat: weekdays in a month", () => {
  // November 2026 starts on a Sunday: Tuesdays are the 3rd, 10th, 17th and 24th.
  it("every Tuesday", () => {
    expect(weekdaysInMonth("2026-11-01", 1, ["every"])).toEqual(["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"]);
  });
  it("selected Tuesdays: 1st and 3rd", () => {
    expect(weekdaysInMonth("2026-11-01", 1, [3, 1])).toEqual(["2026-11-03", "2026-11-17"]);
  });
  it("the last Monday, and a 5th that does not exist is skipped", () => {
    expect(weekdaysInMonth("2026-11-01", 0, ["last"])).toEqual(["2026-11-30"]);
    expect(weekdaysInMonth("2026-11-01", 6, [4, "last"])).toEqual(["2026-11-22", "2026-11-29"]);
    expect(weekdaysInMonth("2026-11-01", 1, [4, "last"])).toEqual(["2026-11-24"]);
  });
});

describe("semesters and repeating over them", () => {
  it("winter: October to March; summer: April to September", () => {
    const ws = semesterFor("2026-11-05");
    expect(ws).toMatchObject({ key: "2026-2", name: "WiSe 26/27", from: "2026-10-01", to: "2027-03-31" });
    expect(ws.months).toEqual(["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"]);
    expect(semesterFor("2027-02-10").key).toBe("2026-2");
    expect(semesterFor("2027-04-01")).toMatchObject({ key: "2027-1", name: "SoSe 27", from: "2027-04-01", to: "2027-09-30" });
    expect(shiftSemester(ws, 1).key).toBe("2027-1");
    expect(shiftSemester(ws, -1).key).toBe("2026-1");
    expect(parseSemesterKey("2026-2")?.name).toBe("WiSe 26/27");
    expect(parseSemesterKey("2026-3")).toBeNull();
    expect(monthsBetween("2026-12-15", "2027-01-02")).toEqual(["2026-12-01", "2027-01-01"]);
  });

  it("every Thursday of a period, inside its first and last day", () => {
    const days = repeatDates("2026-10-15", "2026-11-12", 3, ["every"]);
    expect(days).toEqual(["2026-10-15", "2026-10-22", "2026-10-29", "2026-11-05", "2026-11-12"]);
  });

  it("the 2nd and 4th Tuesday of each month across the year end", () => {
    expect(repeatDates("2026-12-01", "2027-01-31", 1, [2, 4])).toEqual(["2026-12-08", "2026-12-22", "2027-01-12", "2027-01-26"]);
    expect(repeatDates("2026-12-01", "2027-01-31", 1, [])).toEqual([]);
  });
});

describe("default times", () => {
  it("adds the length, also past midnight", () => {
    expect(defaultTimes("2026-11-05", "19:00", 90)).toEqual({ start: "2026-11-05T19:00", end: "2026-11-05T20:30" });
    expect(defaultTimes("2026-11-30", "22:00:00", 180)).toEqual({ start: "2026-11-30T22:00", end: "2026-12-01T01:00" });
  });
  it("formats minutes", () => {
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(45)).toBe("45 min");
  });
});

describe("cash box", () => {
  it("totals notes and coins and refuses anything else", () => {
    expect(countTotal({ "5000": 1, "200": 4, "5": 3 })).toBe(5815);
    expect(countTotal({})).toBe(0);
    expect(countTotal({ "300": 1 })).toBeNull();
    expect(countTotal({ "100": -1 })).toBeNull();
    expect(countTotal({ "100": 1.5 })).toBeNull();
    expect(cleanCounts({ "100": 0, "200": 2 })).toEqual({ "200": 2 });
    expect(denominationLabel(5000)).toBe("€ 50");
    expect(denominationLabel(50)).toBe("50 ct");
  });

  const box = { opening_cents: 5000, closing_cents: 9500, esncards_internal: 2, esncards_external: 3, card_price_internal_cents: 500, card_price_external_cents: 1200 };
  it("takings, expected cash and the difference", () => {
    expect(takings(box)).toBe(4500);
    expect(cardRevenue(box)).toBe(4600);
    expect(expectedClosing(box)).toBe(9600);
    expect(difference(box)).toBe(-100);
  });
  it("no expectation without prices for cards sold, or before counting", () => {
    expect(expectedClosing({ ...box, card_price_external_cents: null })).toBeNull();
    expect(expectedClosing({ ...box, esncards_external: 0, card_price_external_cents: null })).toBe(6000);
    expect(takings({ opening_cents: 5000, closing_cents: null })).toBeNull();
    expect(difference({ ...box, closing_cents: null })).toBeNull();
  });
  it("status", () => {
    expect(cashStatus(null)).toBe("not_started");
    expect(cashStatus({ closed_at: null, checked_at: null })).toBe("counting");
    expect(cashStatus({ closed_at: "x", checked_at: null })).toBe("signed_off");
    expect(cashStatus({ closed_at: "x", checked_at: "y" })).toBe("checked");
    expect(cashStatus({ closed_at: "x", checked_at: "y" }, true)).toBe("booked");
  });
});

describe("iCalendar", () => {
  it("escapes text values", () => {
    expect(icsEscape("Bar, Café; \\ back\nnext")).toBe("Bar\\, Café\\; \\\\ back\\nnext");
  });

  it("folds at 75 octets without splitting characters", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldLine(line).split("\r\n");
    expect(folded.length).toBeGreaterThan(1);
    for (const [i, part] of folded.entries()) {
      expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(75);
      if (i) expect(part.startsWith(" ")).toBe(true);
    }
    expect(folded.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
    expect(foldLine("SHORT:x")).toBe("SHORT:x");
  });

  it("UTC times", () => {
    expect(icsDate("2026-11-05T18:00:00.000Z")).toBe("20261105T180000Z");
    expect(icsDate("2026-11-05T19:00:00+01:00")).toBe("20261105T180000Z");
  });

  const item: IcalItem = {
    uid: "event-1@mesa",
    title: "Pub quiz",
    startsAt: "2026-11-05T18:00:00Z",
    endsAt: null,
    location: "Bar, Munich",
    description: "You are the OC.",
    url: "https://events.esnmesa.org/events/1",
    cancelled: false,
    updatedAt: "2026-11-01T10:00:00Z",
    category: "ESN event",
  };

  it("renders events with CRLF, a default end, location and link", () => {
    const ics = buildCalendar([item, { ...item, uid: "event-2@mesa", title: "Hike", cancelled: true, endsAt: "2026-11-06T16:00:00Z", location: null, description: null }], {
      name: "ESN MESA",
      now: new Date("2026-11-01T12:00:00Z"),
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain("DTSTART:20261105T180000Z\r\nDTEND:20261105T200000Z");
    expect(ics).toContain("LOCATION:Bar\\, Munich");
    expect(ics).toContain("DESCRIPTION:You are the OC.\\n\\nhttps://events.esnmesa.org/events/1");
    expect(ics).toContain("SUMMARY:Cancelled: Hike\r\nCATEGORIES:ESN event\r\nSTATUS:CANCELLED");
    expect(ics).toContain("DTEND:20261106T160000Z");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
});

describe("finance overview", () => {
  const ledger: LedgerRow[] = [
    { direction: "income", amount_cents: 30000, category: "Event revenue", event_id: "e1", booked_on: "2026-11-05" },
    { direction: "expense", amount_cents: 12000, category: "Event costs", event_id: "e1", booked_on: "2026-11-05" },
    { direction: "expense", amount_cents: 50000, category: "Merchandise", event_id: null, booked_on: "2026-11-10" },
    { direction: "expense", amount_cents: 1000, category: "Merchandise", event_id: null, booked_on: "2026-11-11" },
  ];
  const claims: ClaimRow[] = [
    { event_id: "e1", status: "paid", suggested_cents: 1600, approved_cents: 1500 },
    { event_id: "e1", status: "checked", suggested_cents: 800, approved_cents: 800 },
    { event_id: "e2", status: "beleg_received", suggested_cents: 400, approved_cents: null },
    { event_id: "e2", status: "rejected", suggested_cents: 999, approved_cents: null },
  ];
  const cash: CashRow[] = [
    { event_id: "e1", internal_event_id: null, opening_cents: 5000, closing_cents: 9000, closed: true, booked: false },
    { event_id: null, internal_event_id: "o1", opening_cents: 5000, closing_cents: 8000, closed: true, booked: true },
    { event_id: "e2", internal_event_id: null, opening_cents: 5000, closing_cents: 9000, closed: false, booked: false },
  ];

  it("totals: net counts the ledger and paid or due reimbursements", () => {
    expect(totals(ledger, claims, cash)).toEqual({
      income: 30000,
      expenses: 63000,
      reimbursementsPaid: 1500,
      reimbursementsDue: 800,
      reimbursementsOpen: 400,
      cashUnbooked: 4000,
      net: 30000 - 63000 - 1500 - 800,
    });
  });

  it("per category and per event", () => {
    expect(byCategory(ledger)).toEqual([
      { direction: "income", category: "Event revenue", cents: 30000, count: 1 },
      { direction: "expense", category: "Merchandise", cents: 51000, count: 2 },
      { direction: "expense", category: "Event costs", cents: 12000, count: 1 },
    ]);
    const events = perEvent(ledger, claims, cash);
    expect([...events.keys()].sort()).toEqual(["e1", "e2"]);
    expect(events.get("e1")!.net).toBe(30000 - 12000 - 1500 - 800);
    expect(events.get("e1")!.cashUnbooked).toBe(4000);
    expect(events.get("e2")!.reimbursementsOpen).toBe(400);
  });
});
