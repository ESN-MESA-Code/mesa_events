// The venue → the ESN form's address fields, ported from the bot's
// parseAddress_ (src/Esn.gs; its cases in tests/unit/esn.test.ts).
import { oneLine } from "@/lib/description/template";

export interface Address {
  street: string;
  postal: string;
  city: string;
}

/**
 * "Boulderwelt München Ost (Hanne-Hiob-Straße 4, 81671 München)" /
 * "Shamrock, Trautenwolfstraße 6, 80802 Munich" → { street, postal, city };
 * empty fields when not recognisable.
 */
export function parseAddress(venue: string | null | undefined): Address {
  const s = oneLine(venue ?? "");
  const m = s.match(/([^,()]*?\d+[a-z]?)\s*,\s*(\d{5})\s+([^,()]+)/i);
  if (m) return { street: m[1].trim(), postal: m[2], city: m[3].trim() };
  const pc = s.match(/(\d{5})\s+([^,()]+)/);
  if (pc) return { street: "", postal: pc[1], city: pc[2].trim() };
  return { street: "", postal: "", city: "" };
}
