// Participant details remembered in this browser's localStorage (only with
// their consent), used to pre-fill the attendance form next time. Unlike a
// cookie, localStorage is never sent to the server.
const STORAGE_KEY = "mesa_attendance_details";
// Saved details are forgotten after 12 months.
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/** The optional answers are "" when left out. */
export interface SavedDetails {
  first_name: string;
  last_name: string;
  /** ISO country code, e.g. "DE", or "" */
  nationality: string;
  university: string;
  exchange_program: string;
  esn_card: "yes" | "no" | "";
}

interface Stored {
  savedAt: number;
  details: SavedDetails;
}

// localStorage can be missing or throw (private mode, blocked site data).
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSavedDetails(): SavedDetails | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    if (!stored?.details || !(Date.now() - stored.savedAt < MAX_AGE_MS)) {
      forgetSavedDetails();
      return null;
    }
    return stored.details;
  } catch {
    return null;
  }
}

export function saveDetails(details: SavedDetails) {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), details } satisfies Stored));
  } catch {
    // Storage full or blocked – the form simply is not pre-filled next time.
  }
}

export function forgetSavedDetails() {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored that could be removed.
  }
}
