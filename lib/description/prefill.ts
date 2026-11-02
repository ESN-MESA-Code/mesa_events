// A new description starts from what the platform already knows about the
// event: name, date, time, venue, meeting point (round 2026-11-02) and price
// (TBA while not fixed), and the ESN activity type of its category (round
// 2026-11-01).
import { berlinDate, berlinTime } from "@/lib/dates";
import { applyEsnDefaults, emptyFields, esnType, type DescriptionFields } from "@/lib/description/template";
import { eventAddress, formatVenue } from "@/lib/address";
import { eventMeeting, meetingPlace } from "@/lib/meeting";

type AddressColumns = Parameters<typeof eventAddress>[0] & Parameters<typeof eventMeeting>[0];

/** The venue line is the place and its address: "Shamrock (Trautenwolfstraße 6, 80802 München)". */
export function prefillFromEvent(ev: { title: string; starts_at: string; location: string | null; price_cents: number | null } & AddressColumns, categoryEsnType?: string | null): DescriptionFields {
  const fields: DescriptionFields = {
    ...emptyFields(ev.title),
    dateIso: berlinDate(ev.starts_at),
    time: berlinTime(ev.starts_at),
    venue: formatVenue(ev.location, eventAddress(ev)),
    meeting: meetingPlace(eventMeeting(ev)),
    meetingTime: eventMeeting(ev)?.time ?? "",
    price: ev.price_cents === null ? "TBA" : ev.price_cents === 0 ? "free" : (ev.price_cents / 100).toFixed(2),
  };
  return categoryEsnType && esnType(categoryEsnType) ? applyEsnDefaults({ ...fields, esnType: categoryEsnType }, "") : fields;
}
