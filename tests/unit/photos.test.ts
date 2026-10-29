// Photo folder names as the description bot made them (its test cases in
// test/harness.js) and the "photos handed in" rule.
import { describe, expect, it } from "vitest";
import { driveFolderUrl, photoFolderName, photoFolderPath, photosIn, semesterFolderName, semesterOf } from "@/lib/photos";
import { photoStartMessage, photoUploadMessage } from "@/lib/chatMessages";

describe("semesters", () => {
  it("names the semester folders like the bot", () => {
    expect(semesterFolderName("2026-04-01")).toBe("SoSe_26");
    expect(semesterFolderName("2026-03-31")).toBe("WiSe_25-26");
    expect(semesterFolderName("2026-09-30")).toBe("SoSe_26");
    expect(semesterFolderName("2026-10-01")).toBe("WiSe_26-27");
    expect(semesterFolderName("2026-12-31")).toBe("WiSe_26-27");
    expect(semesterFolderName("2000-01-15")).toBe("WiSe_99-00");
  });

  it("names the Sheet's semester tabs like the bot (semesterOf_)", () => {
    expect(semesterOf("2026-11-02")).toEqual({ key: "2026-2", name: "WiSe 26/27" });
    expect(semesterOf("2027-02-10")).toEqual({ key: "2026-2", name: "WiSe 26/27" });
    expect(semesterOf("2026-05-01")).toEqual({ key: "2026-1", name: "SoSe 26" });
  });
});

describe("event folders", () => {
  it("is <yyyy-MM-dd Title> inside the semester, slashes replaced", () => {
    expect(photoFolderPath("2026-11-02", "Pub quiz")).toEqual(["WiSe_26-27", "2026-11-02 Pub quiz"]);
    expect(photoFolderName("2026-05-01", "  Hike / Tegernsee\\Day  ")).toBe("2026-05-01 Hike - Tegernsee-Day");
    expect(driveFolderUrl("abc")).toBe("https://drive.google.com/drive/folders/abc");
  });

  it("counts as handed in with a file in the folder or the tick", () => {
    expect(photosIn(null)).toBe(false);
    expect(photosIn({ photo_count: null, marked_uploaded_at: null })).toBe(false);
    expect(photosIn({ photo_count: 0, marked_uploaded_at: null })).toBe(false);
    expect(photosIn({ photo_count: 3, marked_uploaded_at: null })).toBe(true);
    expect(photosIn({ photo_count: 0, marked_uploaded_at: "2026-11-03T09:00:00Z" })).toBe(true);
  });
});

describe("reminders in the event's space", () => {
  it("says to take pictures at the start, with @all", () => {
    expect(photoStartMessage("Pub quiz")).toBe("<users/all> 📸 *Pub quiz* starts now – please take lots of pictures and videos for our socials! 🎉");
  });

  it("links the folder the next morning, and the report until it is in", () => {
    const folder = { url: "https://drive.google.com/drive/folders/f1", name: "2026-11-02 Pub quiz" };
    const text = photoUploadMessage("Pub quiz", folder, "https://events.test/events/1/hand-in#event-report");
    expect(text).toContain("<users/all> 📤 Thanks for making *Pub quiz* happen! Please upload your pictures and videos here: <https://drive.google.com/drive/folders/f1|📁 2026-11-02 Pub quiz>");
    expect(text).toContain("*event report* (for ESN Activities): https://events.test/events/1/hand-in#event-report");
    expect(photoUploadMessage("Pub quiz", folder, null)).not.toContain("event report");
  });
});
