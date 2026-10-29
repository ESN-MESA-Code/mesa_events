// A new description starts from what the platform already knows about the
// event: name, date, time, venue and price (TBA while not fixed).
import { berlinDate, berlinTime } from "@/lib/dates";
import { emptyFields, type DescriptionFields } from "@/lib/description/template";
import { eventAddress, formatVenue } from "@/lib/address";

type AddressColumns = Parameters<typeof eventAddress>[0];

/** The venue line is the place and its address: "Shamrock (Trautenwolfstraße 6, 80802 München)". */
export function prefillFromEvent(ev: { title: string; starts_at: string; location: string | null; price_cents: number | null } & AddressColumns): DescriptionFields {
  return {
    ...emptyFields(ev.title),
    dateIso: berlinDate(ev.starts_at),
    time: berlinTime(ev.starts_at),
    venue: formatVenue(ev.location, eventAddress(ev)),
    price: ev.price_cents === null ? "TBA" : ev.price_cents === 0 ? "free" : (ev.price_cents / 100).toFixed(2),
  };
}
