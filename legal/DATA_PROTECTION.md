# MESAttendance – data protection documentation

How the MESAttendance app collects, uses, stores, shares and deletes personal data, and
how it protects it. Written for review by the board. It follows the
structure of a record of processing activities (Art. 30 GDPR), with the technical and
organisational measures (Art. 32 GDPR) and open points.

| | |
| --- | --- |
| Controller | Münchner Erasmus Studenten Assoziation (MESA) e.V. (byname ESN MESA München), c/o Referat Internationale Angelegenheiten, Geschwister-Scholl-Platz 1, 80539 München; Amtsgericht München VR 200385; info@esnmesa.org |
| Represented by | The board: two chairs and a treasurer; any two represent the association jointly (Satzung) |
| Data protection officer | None – not required (section 9a). Data protection requests go to info@esnmesa.org |
| Supervisory authority | Bayerisches Landesamt für Datenschutzaufsicht (BayLDA), Promenade 18, 91522 Ansbach |
| System | MESAttendance web app (this repository): Next.js on Vercel, Supabase (PostgreSQL) in Frankfurt |
| Status | As of 23 October 2026, data processing notice `2026-10-23`, participation terms `2026-10-23` |

Facts in this document are taken from the code; file references point to the place that
implements them. All public-facing texts are in this folder and loaded by the app from
here (see [README](README.md)): [`privacy.en.md`](privacy.en.md) (`/privacy`),
[`privacy.de.md`](privacy.de.md) (`/datenschutz`), [`terms.en.md`](terms.en.md) (`/terms`),
[`impressum.md`](impressum.md) (`/impressum`) and the form texts `form-*.md`. Shared values
(names, email, retention, versions): [`details.json`](details.json).

---

## 1. What the app does

MESA organises events for international students. LMU does not accept digital attendance
lists, so **funded events (trips, team building) keep the paper list**; the app is used for
**regular events** only:

1. An organiser (a MESA member with an `@esnmesa.org` Google Workspace account) creates an
   event in the dashboard (title, date, optional risk notice). The app shows a QR code with a
   random link token.
2. From 2 hours before the event until 24 hours after it, participants scan the QR code with
   their own phone and fill in the form at `/event/<token>` – or sign in on an organiser's
   device ("kiosk mode") if they have no phone. They accept the participation terms.
3. The organiser sees the names live while the list is open. After the event the creator
   signs the list off with the number of people they counted. The list also closes by itself
   24 hours after the event.
4. The optional answers are never stored with a name: each sign-in only adds 1 to the event's
   count per answer. Once the list is closed, only executives see the names; everyone sees
   the numbers and counts.
5. Finance opens the event page to check that the event took place before reimbursing the
   organiser.

---

## 2. Processing activities

### 2.1 Event sign-ins (participants)

| | |
| --- | --- |
| Data subjects | Event participants, mostly international students in Munich |
| Data | First and last name; time of sign-in; entry method (own device / organiser's device) and, for kiosk sign-ins, the organiser's email; versions of the data processing notice and of the participation terms shown |
| Only counted | The optional answers – nationality (ISO country code), university (LMU / TUM / Other), exchange programme (Erasmus+ / LMUexchange / Full-time degree / Other), ESNcard yes/no. `public.sign_in()` adds 1 per answer to `public.event_stats` (event, question, answer, total) and never stores them with the sign-in. The counts hold no personal data |
| Not collected | Signatures, email, phone, address, date of birth, student ID, photos, IP address in the database, location |
| Purposes | (a) Proof that the participant accepted the participation terms and defence against legal claims from the event; (b) proof towards finance that the event took place (counts only); (c) anonymous statistics for planning and reports |
| Legal basis | (a) **Performance of the participation agreement**, Art. 6(1)(b) GDPR, and **legitimate interest** in proving what was agreed, Art. 6(1)(f); (b) and (c) **legitimate interest**, Art. 6(1)(f) (balancing test in section 2.1a). No consent checkbox. Information in [`form-data-processing.en.md`](form-data-processing.en.md) on the form ([`components/AttendanceForm.tsx`](../components/AttendanceForm.tsx)) |
| Proof (Art. 5(2) GDPR, § 305(2) BGB) | Each row stores `notice_version`, `terms_version` and `created_at`; the database refuses rows without them ([migration](../supabase/migrations/20261023000000_regular_events.sql)). The texts of every version are in the git history |
| Obligation to provide | None by law. Name and acceptance of the terms are needed to take part; whoever does not want to sign in digitally can sign a paper list. The optional questions can be left out or declined ("Prefer not to say") |
| Objection (Art. 21) | By email to info@esnmesa.org; the entry is deleted unless it is needed for legal claims (e.g. after an incident at that event) – the person is told (procedure in section 6) |
| Recipients | MESA organisers (Workspace accounts) see names while the list is open; executives always; finance and organisers the counts; processors in section 4 |
| Retention | Until the end of the third calendar year after the event, then deleted automatically with the event's counts (section 5); earlier after a successful objection |
| Special categories (Art. 9) | None. Nationality is not an Art. 9 category |

### 2.1a Balancing of interests (Art. 6(1)(f))

| | |
| --- | --- |
| Our interest | Being able to prove that participants accepted the participation terms (incl. the liability clause and the event's risk notice) if a claim is raised; proper accounts – finance reimburses organisers only for events that took place; planning events from anonymous statistics |
| Necessity | Name, time and terms version are the minimum that proves who accepted which terms. The optional answers are needed only as counts, so only counts are stored. Finance needs numbers, not names. Names are needed after the event only if something happens – so only executives see them then |
| Participants' interests | Names could be misused if leaked; nationality could reveal origin. Participants reasonably expect an attendance list at an organised event |
| Safeguards | Optional answers only counted, never stored with a name; counts per answer shown only once the list is closed, so they cannot be matched with names appearing live; names for non-executive organisers only while the list is open (RLS); participants never see each other's entries; sign-ins only inside the event's window; fixed retention with automatic deletion; no signatures, exports or printouts; no use for marketing; right to object at any time; measures in section 7 |
| Result | The interests of the association prevail. Reassess if the purpose, the fields or the circle of recipients change |

Why not consent: participation needs the acceptance of the terms anyway, and a withdrawal
would delete exactly the proof the list exists for.

### 2.2 "Save my details" (participants, optional)

| | |
| --- | --- |
| Data | Name and any optional answers the participant gave |
| Where | Only in the participant's browser: `localStorage`, key `mesa_attendance_details`, ignored and removed after 12 months. Never sent to the server ([`lib/savedDetails.ts`](../lib/savedDetails.ts)) |
| Purpose | Pre-filling the form at the next event |
| Legal basis | Consent, § 25(1) TDDDG (storage on the device) and Art. 6(1)(a) GDPR: only saved after clicking "Save my details" on the thank-you screen |
| Withdrawal | "No, thanks", "Not you? Remove saved details" or "Remove them" deletes the details; or deleting the site data in the browser |
| Kiosk | Never offered and never pre-filled on organiser devices (shared device) |

### 2.3 Organiser accounts, executives and actions

| | |
| --- | --- |
| Data subjects | MESA members acting as organisers; members of the executives' Google group |
| Data | From Google: name, email, account ID (in Supabase Auth); session cookies; IP address and user agent of logins (Supabase Auth: `auth.audit_log_entries`, `auth.sessions`); in events: creator email, sign-off (time, email, headcount), kiosk sign-ins recorded (email); acceptance of the confidentiality rules (email, text version, time); `executives`: email addresses of the group's members and when they were last synced |
| Purpose | Secure access to the dashboard; accountability for each list; deciding who sees names of closed lists; proof that everyone with access is bound to confidentiality |
| Legal basis | Legitimate interest, Art. 6(1)(f) GDPR (and the membership relationship) |
| Executives | The members of the Google Workspace group `EXECUTIVES_GROUP`, read with a service account through the Admin SDK Directory API: at every organiser login for that person ([`app/auth/callback`](../app/auth/callback/route.ts)) and daily for everyone ([`app/api/cron/sync-executives`](../app/api/cron/sync-executives/route.ts)) |
| Cookies | Supabase session cookies, strictly necessary – § 25(2) No. 2 TDDDG, no consent |
| Retention | Event-related data as long as the event (section 5); acceptances of the confidentiality rules until the end of the fifth calendar year after they were given; executives until they leave the group (next sync or login); login IP addresses and user agents 30 days (nightly job, section 5); Auth accounts are deleted by an admin when the person leaves the organiser role |

### 2.4 Hosting and technical logs

| | |
| --- | --- |
| Data | IP address, time, requested URL, user agent – processed by Vercel and Supabase in their logs |
| Purpose | Delivering the app, security, error analysis |
| Legal basis | Legitimate interest, Art. 6(1)(f) GDPR |
| Retention | Providers' log retention (short, plan-dependent). The app's database stores no participant IP addresses; organisers' login IPs see section 2.3 |

### 2.5 What finance sees

Finance (and every organiser) sees on the event page: title, date, responsible organiser,
sign-off (who, when), headcount, number of sign-ins, kiosk sign-ins, the time range of the
sign-ins and – once the list is closed – the counts by university, programme, ESNcard and
nationality ([`components/EventSummary.tsx`](../components/EventSummary.tsx),
`public.event_summary()`). Organisers share the page's link ("Copy link for finance"); it
opens only with an `@esnmesa.org` account that accepted the confidentiality rules. There are
no exports or printouts.

---

## 3. Data flow

```
Participant's phone ──HTTPS──▶ Vercel (Next.js, EU) ──▶ page only, no personal data stored
        │
        └──HTTPS (Supabase API, anon key)──▶ Supabase Postgres, Frankfurt
                                               public.sign_in(): one participants row
                                               (name, terms), +1 per answer in event_stats;
                                               only inside the window, never read back

Organiser's browser ──Google Workspace login──▶ Supabase Auth (Google OAuth, hd=esnmesa.org)
        │
        └──HTTPS──▶ Supabase: names (RLS: open lists, or executives), counts
                    (event_summary), live updates via Supabase Realtime

Vercel (login, daily cron) ──service account──▶ Google Admin SDK: members of the
        executives' group ──service role──▶ Supabase: public.executives
```

The public form never reads the events table; it gets title, date, risk notice and the
sign-in window of one event by its token through `get_public_event()`, which does not return
organiser names.

---

## 4. Processors and transfers

| Processor | Role | Location of data | Transfer safeguard |
| --- | --- | --- | --- |
| Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA | Hosting of the app (functions pinned to Frankfurt, `fra1`, in [`vercel.json`](../vercel.json)); daily cron | EU; CDN edge may serve from the nearest location | Vercel DPA with EU standard contractual clauses; EU–US Data Privacy Framework where certified |
| Supabase Inc., 970 Toa Payoh North #07-04, Singapore 318992 | Database, authentication, realtime | AWS eu-central-1 (Frankfurt) | Supabase DPA with standard contractual clauses (support access from third countries) |
| Google Ireland Limited, Gordon House, Barrow Street, Dublin 4 | Organiser login (Google Workspace); group membership (Admin SDK) | EU / Google infrastructure | Google Workspace data processing terms; DPF for transfers to Google LLC |

GitHub (source code and CI) holds no personal data of participants: tests use a local
database with fake data.

**Status of the data processing agreements:** Supabase's and Vercel's DPAs are part of their
terms of service and apply automatically – nothing to sign. Google Workspace's Cloud Data
Processing Addendum is accepted in the admin console (open point 2). Dated copies of the
DPAs (and Supabase's transfer impact assessment) are kept with the association's data
protection documents as evidence (Art. 5(2)).

---

## 5. Retention and deletion

| What | When deleted | How |
| --- | --- | --- |
| Optional answers | Never stored with a sign-in – only counted | `public.sign_in()` |
| Events, their sign-ins and counts | End of the third calendar year after the event (event in 2026 → 31 Dec 2029) | Nightly `pg_cron` job `delete-expired-events` (03:30 UTC) runs `public.delete_expired_events()`; sign-ins and counts are deleted with their event (`on delete cascade`) ([migration](../supabase/migrations/20261023000000_regular_events.sql), tested in [`tests/db/retention.test.ts`](../tests/db/retention.test.ts)) |
| Events with an incident | Until the matter is settled | Manually: before the deletion, an admin copies the event's sign-ins (SQL, section 6) into the incident file, which is deleted once the matter is settled |
| Executives | When they leave the Google group | Daily sync (`replace_executives()`) or at their next login (`set_executive()`) |
| Acceptances of the confidentiality rules | End of the fifth calendar year after acceptance (the organiser is then asked again) | Nightly `pg_cron` job `delete-expired-acknowledgements` (03:50 UTC) |
| Organisers' login IP addresses and user agents | After 30 days | Nightly `pg_cron` job `purge-auth-ip-addresses` (03:45 UTC) |
| A single sign-in after an objection | Promptly after the request, unless needed for legal claims (section 2.1) | Manually by an admin (section 6) |
| Events deleted early | Any time | Only by an admin in SQL; its sign-ins go with it. The API refuses deletes of events and sign-ins for everyone |
| Saved details | After 12 months, or when the participant removes them | Browser |
| Supabase backups | Per Supabase plan (daily backups, limited retention) | Provider |

Why three years: the lists prove that participants accepted the participation terms. Claims
from an event become time-barred after three years from the end of the year in which the
claimant learned of them (§§ 195, 199 BGB). The lists are no longer needed for funders, who
get paper lists. Changing the period needs `details.json` plus a new migration for the
deletion job.

---

## 6. Data subject rights – how to handle requests

Requests reach info@esnmesa.org. Answer within one month (Art. 12(3)).
Verify the requester's identity sensibly (e.g. reply from the address they used, or ask
which events they attended) – the app stores no contact data.

Run in the Supabase dashboard → SQL editor (service role) – the API refuses deletes:

```sql
-- Access (Art. 15): all sign-ins of a person
select e.title, e.event_date, p.*
from participants p join events e on e.id = p.event_id
where lower(p.first_name) = lower('Erika') and lower(p.last_name) = lower('Mustermann')
order by e.event_date;

-- Objection / erasure (Art. 21, 17): delete those rows – unless they are needed for
-- legal claims (an incident at that event); then tell the person and keep them
delete from participants where id in ('<id>', '<id>');

-- Rectification (Art. 16)
update participants set last_name = 'Musterfrau' where id = '<id>';
```

Deleting a sign-in does not change the event's counts (`event_stats`), which hold no personal
data and cannot be traced back to anyone. Deleted rows remain in Supabase's backups until these rotate out; they are not
restored from there. Portability (Art. 20) applies to data processed on contract – the name,
time and terms version of each sign-in; export those columns of the query result as CSV. The
saved details (consent) are on the participant's own device.

### 6a. Data breaches (Art. 33, 34)

E.g. a leaked service role or service account key, a lost unlocked organiser device.

1. Whoever notices it tells the board at once (info@esnmesa.org); stop the leak (rotate the
   key, sign the account out, …).
2. The board reports it to BayLDA within **72 hours** of becoming aware
   (online form on lda.bayern.de), unless it is unlikely to put anyone at risk.
3. If the risk is high, also inform the participants affected.
4. Note every breach – facts, effects, measures, and why it was or was not reported – in
   the association's breach log, even if not reported (Art. 33(5)).

---

## 7. Technical and organisational measures (Art. 32)

**Access control**
- Organiser area and kiosk require a Google login with an `@esnmesa.org` Workspace account;
  checked on the server (`hd` claim and email domain, [`lib/auth.ts`](../lib/auth.ts),
  [`proxy.ts`](../proxy.ts)) and again in the database.
- Row Level Security on all tables: anyone may **sign in** through `public.sign_in()` inside
  the event's window (2 hours before to 24 hours after, not after the sign-off) – nobody
  inserts into `participants` directly; Workspace members **read the names** of open lists,
  executives (`public.is_executive()`) of all lists; nobody may update participant rows;
  events are readable by Workspace members only. Nobody may **delete** events or sign-ins
  through the API – only the retention job and admins in SQL. A trigger rejects sign-ups from
  other domains.
- **Counts:** `public.event_stats` is not readable or writable through the API; only
  `public.sign_in()` adds to it and `public.event_summary()` reports it, per answer only once
  the list is closed.
- Executives are whoever the Google group lists; the table is written only by the app's
  server (service role) and not readable through the API.
- Confidentiality before access: on first login every organiser must accept the rules in
  [`organiser-confidentiality.md`](organiser-confidentiality.md) (`/confidentiality`). The
  database records email, text version and time (`organiser_acknowledgements`) and
  `is_workspace_member()` – used by every organiser policy – refuses organisers without an
  acceptance of the current version. A new text version means everyone accepts again.
- What participants accepted cannot be changed afterwards: once someone signed in, the event
  date and risk notice are fixed (trigger `guard_event_writes()`); the sign-off (who, when,
  headcount) is recorded by the database and final; the counts are written by
  `public.sign_in()` only.
- The service role key and the service account key are used only server-side and kept only
  in the hosting environment (never in the repository or logs); they are rotated if they may
  have leaked. The cron route needs `CRON_SECRET`.
- Two-factor authentication for every account with access: the `@esnmesa.org` Google
  accounts (enforced in the Workspace admin console) and the Supabase, Vercel, Google Cloud
  and GitHub accounts (open point 12).
- Few admins: only the people who maintain the app have access to the Supabase, Vercel and
  Google Cloud projects; access is removed when someone leaves the role.

**Confidentiality and integrity**
- HTTPS only. Encryption at rest: the database and its backups are stored encrypted by
  Supabase (AES-256, AWS Frankfurt).
- Input validation in the form and in database constraints (field lengths, allowed values,
  notice and terms versions, risk notice length, headcount range).
- Security headers: no framing (`X-Frame-Options: DENY`, `frame-ancestors 'none'`),
  `nosniff`, `Referrer-Policy: same-origin` so the QR token is not leaked
  ([`next.config.ts`](../next.config.ts)).

**Data minimisation and privacy by default**
- No signatures, no email or contact data from participants; no exports, printouts or
  downloads; no tracking, analytics or ads; no external fonts, scripts or profile pictures.
- The optional questions are optional ("Prefer not to say") and only counted – never stored
  with a name. The counts per answer are shown only once the names are hidden from
  non-executive organisers.
- Saved details are opt-in, stay in the browser and are never sent to the server.
- Kiosk mode never stores or pre-fills anyone's details, and tells the browser not to
  remember entered names (`autocomplete="off"`); the form resets after each person.
- Organisers' login IP addresses are removed after 30 days (section 5).

**Organisational rules for organisers**
- Never copy names out of the app (screenshots, lists by messenger); show finance the event
  page, not names.
- Carry a paper list for participants who do not want to sign in digitally; it carries the
  same participation terms.
- Count the participants at the event and sign the list off afterwards – finance reimburses
  on the basis of the event page.
- **Kiosk mode (signing in on your device):** your device is signed in to the organiser
  area, so anyone holding it can leave the form and see the open lists. Never leave the
  device alone with a participant – stay next to them while they sign in. Where possible pin
  the browser to the form (Android: app pinning; iPhone/iPad: Guided Access) and lock the
  device when you put it down.
- Organisers commit to these rules in the app before they see any list (confidentiality
  commitment, see access control above).

**Change management**
- Database changes only as reviewed migration files, applied by CI on `main`; the
  test suite (unit, database/RLS, end-to-end) runs on every pull request, so a change
  that weakens the privacy rules fails before it reaches production.

---

## 8. Transparency (Art. 12–14)

- **On the form, before signing in:** the short participation terms with a link to the full
  terms (`/terms`), the event's risk notice if any, and a "Data processing" box as the first
  layer (who, why, legal basis, who sees what, retention, that no law obliges anyone to sign
  in, the right to object set apart in bold as Art. 21(4) requires, and a direct link to the
  full notice for the other rights). No consent checkbox – the processing does not rest on
  consent.
- **Full notice:** `/privacy` and `/datenschutz`, linked in the footer of every page (new
  tab on the form so nothing is lost).
- **Impressum:** `/impressum` (§ 5 DDG), linked in the footer of every page.
- **Executives' emails** come from Google, not from them (Art. 14): the privacy notice,
  section 4, tells organisers.

---

## 9. Data protection impact assessment (Art. 35)

Assessment: **not required.** No special categories, no profiling or automated decisions,
no systematic monitoring, no new technologies with high risk, moderate scale (a few
thousand sign-ins a year, kept for three years; the optional answers only as counts). The processing is not on the BayLDA list of operations that require a DPIA. Main
risk – exposure of names – is mitigated by the measures in section 7.

---

## 9a. Data protection officer (Art. 37 GDPR, § 38 BDSG)

Assessment: **not required**, so none is appointed.

- Art. 37(1): MESA is not a public body; its core activities are not large-scale regular
  and systematic monitoring, nor large-scale processing of special categories.
- § 38(1) BDSG: fewer than 20 people are regularly engaged in the automated processing of
  personal data, and no processing needs a DPIA (section 9). **Count everyone in the
  association who regularly works with personal data** (board, organisers using this app,
  member and finance administration) – not only this app's users. Re-check yearly.

Without a DPO the board stays responsible for compliance. There is no separate data
protection contact: questions and requests go to the association's general address,
info@esnmesa.org, named in the privacy notice and Impressum.

---

## 10. Open points for the board

1. **New purposes and balancing test** (23 October 2026): regular events only, proof of the
   participation terms, finance, anonymous statistics. The board should confirm section 2.1a.
2. **Data processing agreements:** accept the Cloud Data Processing Addendum in the Google
   Workspace admin console (it also covers the Admin SDK). Save dated PDFs of the Supabase
   DPA and TIA and of vercel.com/legal/dpa.
3. **Paper alternative:** the notice tells people who don't want to sign in digitally to
   ask for a paper list – organisers need to know this and carry one with the same terms.
4. **Participation terms:** have `terms.en.md` (especially the liability clause, section 5)
   checked once by a lawyer or ESN Germany before relying on it. The paper template for
   funded events still carries the old disclaimer – replace it there too, unless LMU
   prescribes that text.
5. **Organisational rules** (section 7): tell all organisers; the board should approve the
   new text in [`organiser-confidentiality.md`](organiser-confidentiality.md) (version
   `2026-10-23`, every organiser accepts again at their next login).
6. **Executives group:** decide which group it is (`EXECUTIVES_GROUP`), set up the service
   account (README, step 5a) and `CRON_SECRET`. Without them nobody sees names of closed
   lists.
7. **DPO** (section 9a): recount the people processing personal data each year and appoint
   a DPO once there are 20 or more.
8. **Record of processing activities:** take sections 2 and 4 into the association's
   Art. 30 record.
9. **Impressum contact:** besides email only office hours are given; a phone number or
   contact form would be safer under § 5 DDG.
10. **esnmesa.org Impressum** lacks board and register entry and links the discontinued
    EU ODR platform.
11. **Incidents:** agree how an executive keeps an event's list beyond the retention period
    when something happened (section 5) and who decides.
12. **Two-factor authentication:** enforce it in the Google Workspace admin console and
    check it on the Supabase, Vercel, Google Cloud and GitHub accounts with access.
13. **Minors:** the terms require participants to be 18 or older. If minors may attend, the
    terms and the sign-in (parents' consent) need changes.
14. **Old test data:** all sign-ins and events from before 23 October 2026 were test data and
    were deleted by the migration. Empty the old `signatures` storage bucket in the Supabase
    dashboard if anything is left in it.
