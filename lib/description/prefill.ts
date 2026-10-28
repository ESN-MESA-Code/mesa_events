// A new description starts from what the platform already knows about the
// event: name, date, time, venue and price (TBA while not fixed).
import { berlinDate, berlinTime } from "@/lib/dates";
import { emptyFields, type DescriptionFields } from "@/lib/description/template";

export function prefillFromEvent(e: { title: string; starts_at: string; location: string | null; price_cents: number | null }): DescriptionFields {
  return {
    ...emptyFields(e.title),
    dateIso: berlinDate(e.starts_at),
    time: berlinTime(e.starts_at),
    venue: e.location ?? "",
    price: e.price_cents === null ? "TBA" : e.price_cents === 0 ? "free" : (e.price_cents / 100).toFixed(2),
  };
}
