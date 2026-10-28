import { describe, expect, it } from "vitest";
import { publishedPost, rosterMessage, spaceDescription, spaceDisplayName, spaceGuidelines, welcomeMessage, type SpacePerson } from "@/lib/chatMessages";

const event = { id: "e1", title: "Pub quiz", starts_at: "2026-11-05T18:00:00Z" };
const people: SpacePerson[] = [
  { email: "oc@esnmesa.org", name: "Olga Organiser", kind: "oc" },
  { email: "h1@esnmesa.org", name: "Hugo Helper", kind: "helper" },
  { email: "h2@esnmesa.org", name: "Hana Helper", kind: "helper" },
  { email: "comms@esnmesa.org", name: "Cora Comms", kind: "team" },
];

describe("Chat texts", () => {
  it("names the space after the event and its Berlin date", () => {
    expect(spaceDisplayName(event)).toBe("Pub quiz · Thu, 5 Nov 2026, 19:00");
  });

  it("puts the date and OC into the description (150 characters max)", () => {
    expect(spaceDescription(event, people)).toBe("📅 Thu, 5 Nov 2026, 19:00 · OC: Olga Organiser");
    expect(spaceDescription(event, [])).toContain("OC: open");
    const long = spaceDescription(event, [{ email: "x", name: "N".repeat(300), kind: "oc" }]);
    expect(long.length).toBe(150);
    expect(long.endsWith("…")).toBe(true);
  });

  it("@-mentions OC and helpers in the welcome message, not the teams", () => {
    const text = welcomeMessage(event, people, "https://e/events/e1");
    expect(text).toContain("OC: <users/oc@esnmesa.org>");
    expect(text).toContain("Helpers: <users/h1@esnmesa.org>, <users/h2@esnmesa.org>");
    expect(text).not.toContain("comms@");
    expect(text).toContain("*Pub quiz*");
  });

  it("lists the roster in the guidelines", () => {
    expect(spaceGuidelines(event, people, "https://e/events/e1")).toContain("Helpers: Hugo Helper, Hana Helper");
  });

  it("announces dropouts with the claim link and tells the OC", () => {
    expect(rosterMessage("dropout", "Hugo Helper", "helper", "oc@esnmesa.org", "https://e/events/e1", "Pub quiz")).toBe(
      "⚠️ Hugo Helper dropped out as helper of *Pub quiz*. The helper slot is open – anyone can claim it on the event page: https://e/events/e1 <users/oc@esnmesa.org>"
    );
    expect(rosterMessage("claim", "Mia Member", "oc", null, "u", "Pub quiz")).toBe("✅ Mia Member took the open OC slot of *Pub quiz*.");
  });

  it("publishes descriptions with @all", () => {
    expect(publishedPost("Hello")).toBe("Hello\n\n<users/all>");
  });
});
