# Legal texts and data protection

Everything about data protection and the legal pages of MESAttendance is in this folder.
The app loads the texts from here, so changing a file here changes the app (after a
deploy) – no code changes needed.

| File | What it is | Shown at |
| --- | --- | --- |
| [`DATA_PROTECTION.md`](DATA_PROTECTION.md) | Full documentation of how personal data is collected, used, protected and deleted – for the board | not shown in the app |
| [`details.json`](details.json) | The facts the texts share: association, supervisory authority, processors, retention, versions | filled into the texts below |
| [`impressum.md`](impressum.md) | Impressum / legal notice (§ 5 DDG), incl. the board | `/impressum` |
| [`privacy.en.md`](privacy.en.md) | Privacy notice (Art. 13 GDPR), English | `/privacy` |
| [`privacy.de.md`](privacy.de.md) | Datenschutzerklärung, German – must say the same as the English one | `/datenschutz` |
| [`terms.en.md`](terms.en.md) | Participation terms (incl. the liability clause) participants accept when signing in | `/terms` |
| [`form-terms.en.md`](form-terms.en.md) | Short version of the participation terms on the attendance form | form |
| [`form-data-processing.en.md`](form-data-processing.en.md) | "Data processing" box on the attendance form | form |
| [`organiser-confidentiality.md`](organiser-confidentiality.md) | Confidentiality rules organisers accept before the organiser area opens (English and German) | `/confidentiality` |

## Editing

- The texts are Markdown. A line ending in `\` keeps the next line on a new line
  (addresses); `<name@example.org>` becomes an email link.
- `{{association.email}}`, `{{association.name}}` and so on are replaced with the values in
  `details.json`. An unknown placeholder makes the build and the tests fail, so typos
  cannot reach the live site.
- Change the English and German privacy notices together, and update `as_of` in
  `details.json`.

## Changes that need more than a text edit

- **Participation terms** (`terms.en.md` or `form-terms.en.md`) in substance: bump
  `terms_version` in `details.json` to the date of the change. Every sign-in stores the
  version it accepted – the proof of what was agreed (§ 305(2) BGB). Keep the old text in
  the git history (or tag the commit) so every version stays readable. Have changes to the
  liability clause (section 5) checked by a lawyer: one sentence too broad makes the whole
  clause void.
- **Data processing notice** (`form-data-processing.en.md`, or what the privacy notice
  says about sign-ins): bump `notice_version` in `details.json`. Sign-ins rest on the
  participation agreement and legitimate interest (Art. 6(1)(b) and (f)), not consent – see
  section 2.1a of `DATA_PROTECTION.md` before adding fields.
- **Retention period** (`retention` in `details.json`, incl. the ordinal words): the
  automatic deletion runs in the database, so it also needs a new migration in
  `supabase/migrations/` that changes `public.delete_expired_events()` (see
  `20261023000000_regular_events.sql`).
- **Organisers' confidentiality rules** (`organiser-confidentiality.md`): a change in
  substance needs a new `confidentiality_version` in `details.json` and a migration that
  changes `public.confidentiality_version()` (a test checks they match); every organiser
  is then asked to accept again.
