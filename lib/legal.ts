// The facts the legal texts share (association, retention, notice
// version). They live with the texts in legal/details.json – edit them there.
import details from "../legal/details.json";

export const LEGAL = details;

/**
 * Version (date) of the data processing notice on the attendance form, stored
 * with each sign-in so we can show what a participant was told (Art. 5(2) GDPR).
 * Bump it in legal/details.json whenever that notice changes in substance.
 */
export const NOTICE_VERSION = details.notice_version;

/**
 * Version (date) of the participation terms (legal/terms.en.md and the short
 * version on the form), stored with each sign-in as proof of what the
 * participant accepted. Bump it in legal/details.json whenever the terms change.
 */
export const TERMS_VERSION = details.terms_version;

/**
 * Version (date) of the organisers' confidentiality rules
 * (legal/organiser-confidentiality.md). Changing it needs a migration that
 * changes public.confidentiality_version() – organisers are then asked again.
 */
export const CONFIDENTIALITY_VERSION = details.confidentiality_version;
