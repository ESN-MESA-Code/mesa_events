// The demo data's mock default pictures (lib/staging/pictures.ts): a real
// PNG that Telegram and the Pictures tab take, small, and the same every run.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MOCK_HEIGHT, MOCK_WIDTH, mockLabel, mockPicture, wrapLabel } from "@/lib/staging/pictures";
import { PICTURE_MAX_BYTES } from "@/lib/telegram/picture";

describe("mock pictures", () => {
  it("writes what the pixel font can", () => {
    expect(mockLabel("Café-Crawl (new)")).toBe("CAFE-CRAWL NEW");
    expect(mockLabel("Día de los Muertos 🎃")).toBe("DIA DE LOS MUERTOS");
    expect(mockLabel("Karaoke & Quiz – it’s on!")).toBe("KARAOKE & QUIZ - IT'S ON!");
  });

  it("breaks a label at spaces and cuts a word that is too long", () => {
    expect(wrapLabel("DAY TRIP TO LAKE TEGERNSEE", 10)).toEqual(["DAY TRIP", "TO LAKE", "TEGERNSEE"]);
    expect(wrapLabel("PRINZREGENTENSTADION", 10)).toEqual(["PRINZREGEN", "TENSTADION"]);
  });

  it("is a PNG of 800 × 600 that unpacks to its pixels", () => {
    const png = mockPicture("Pub Quiz Night", "Format");
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([MOCK_WIDTH, MOCK_HEIGHT]);
    // The one IDAT chunk follows the header chunk (8 + 25 bytes).
    const length = view.getUint32(33);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe("IDAT");
    expect(inflateSync(png.subarray(41, 41 + length)).length).toBe(MOCK_HEIGHT * (1 + MOCK_WIDTH * 3));
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe("IEND");
    expect(png.length).toBeLessThan(200_000);
    expect(png.length).toBeLessThan(PICTURE_MAX_BYTES);
  });

  it("is the same every run, and differs by label", () => {
    expect(mockPicture("Hike", "Category")).toEqual(mockPicture("Hike", "Category"));
    expect(mockPicture("Hike", "Category")).not.toEqual(mockPicture("Pub", "Category"));
  });
});
