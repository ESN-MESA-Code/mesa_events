/** An event's attendance list as the organiser pages see it (events + attendance_lists). */
export interface Event {
  /** The event's id */
  id: string;
  title: string;
  /** When the event starts (events.starts_at) */
  event_date: string;
  /** The QR code's key to the public form */
  public_token: string;
  /** Shown to participants above the terms; fixed once someone signed in */
  risk_notice: string | null;
  /** When the OC signed the list off; closes it for sign-ins */
  signed_off_at: string | null;
  /** Email of the OC who signed it off */
  signed_off_by: string | null;
  /** People the OC counted, entered with the sign-off */
  headcount: number | null;
}

/** Counts per answer; "not_given" where someone left a question out. */
export type Breakdown = Record<string, number>;

/**
 * What public.event_summary() returns: the numbers, and once the list is
 * closed the counts per answer (from public.event_stats).
 */
export interface EventStats {
  signins: number;
  /** Sign-ins on an organiser's device */
  kiosk: number;
  first_signin: string | null;
  last_signin: string | null;
  nationality?: Breakdown;
  university?: Breakdown;
  exchange_program?: Breakdown;
  esn_card?: Breakdown;
}

/** What the public attendance form may know about an event (get_public_event). */
export interface PublicEvent {
  id: string;
  title: string;
  event_date: string;
  risk_notice: string | null;
  /** Sign-ins are possible from … */
  opens_at: string;
  /** … until (unless signed off earlier) */
  closes_at: string;
  /** Signed off or past closes_at: no more sign-ins */
  closed: boolean;
}

/**
 * A sign-in as organisers can read it. The optional answers (nationality,
 * university, programme, ESNcard) are not part of it – public.sign_in() only
 * counts them (EventStats).
 */
export interface Participant {
  id: string;
  event_id: string;
  first_name: string;
  last_name: string;
  /** "self" (own phone) | "kiosk" (signed in on an organiser's device) */
  entry_method: "self" | "kiosk";
  /** Email of the organiser whose device recorded a kiosk sign-in */
  recorded_by: string | null;
  /** Version (date) of the data processing notice shown */
  notice_version: string;
  /** Version (date) of the participation terms accepted */
  terms_version: string;
  created_at: string;
}

/** Legal texts the attendance form shows, as HTML rendered from legal/*.md. */
export interface FormTexts {
  terms: string;
  dataProcessing: string;
}
