"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Info, Lock, MapPin, Sparkles, UserRound, Users } from "lucide-react";
import { Alert, Button, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { DateTile } from "@/components/DateTile";
import { submitVolunteerForm } from "@/app/actions/planning";
import { RANK_LABELS } from "@/lib/volunteer";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";

type Wish = { oc: number | null; helper: number | null };
/** `tone`: the colour once picked – darker for a stronger wish, grey for "No". */
type Option = { value: number | null; label: string; tone: string };

const PICKED = "bg-esn text-white";
/** From "No" up to "Top choice" (usability review #19; five levels since round 2026-11-03), each a shade darker. */
const RANK_TONE: Record<number, string> = {
  5: "bg-esn/10 text-esn-dark",
  4: "bg-esn/20 text-esn-dark",
  3: "bg-esn/35 text-esn-dark",
  2: "bg-esn/75 text-white",
  1: PICKED,
};
const RANKS: Option[] = [{ value: null, label: "No", tone: "bg-gray-200 text-gray-800" }, ...[5, 4, 3, 2, 1].map((r) => ({ value: r, label: RANK_LABELS[r], tone: RANK_TONE[r] }))];
/** How many events this month; null = no limit. */
const MAX_EVENTS: Option[] = [...[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n), tone: PICKED })), { value: null, label: "No limit", tone: PICKED }];
/** How many of them as OC; null = no limit. */
const MAX_OC: Option[] = [...[1, 2, 3].map((n) => ({ value: n, label: String(n), tone: PICKED })), { value: null, label: "No limit", tone: PICKED }];

type FormEvent = {
  id: string;
  title: string;
  /** The type when it is not a standard event ("Day trip"). */
  type: string | null;
  startsAt: string;
  /** "18:00" */
  time: string;
  /** "Mon, 4 Jan 2027, 18:00" – for the confirm dialog. */
  when: string;
  /** The venue without the street address. */
  venue: string;
  helpers: number;
  /** OCs needed (round 2026-11-04: several per event). */
  ocs: number;
  /** On the event already: the idea's proposer (OC) and the partners who accepted. Once they fill the OC slots, no OC answers. */
  fixed: Array<{ name: string; role: "oc" | "helper"; me: boolean; proposer: boolean }>;
  /** The viewer proposed the idea or joined it as partner. */
  mine: boolean;
};

export function VolunteerForm({
  cycleId,
  month,
  events,
}: {
  cycleId: string;
  /** "December 2026" – named in the confirm dialog. */
  month: string;
  events: FormEvent[];
}) {
  const { run, pending, error, confirm } = useAction();
  const [wishes, setWishes] = useState<Record<string, Wish>>({});
  // undefined = not answered yet (required once an event is picked).
  const [maxEvents, setMaxEvents] = useState<number | null | undefined>(undefined);
  const [maxOc, setMaxOc] = useState<number | null>(1);
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState("");

  const set = (id: string, key: keyof Wish, value: number | null) =>
    setWishes((w) => ({ ...w, [id]: { oc: w[id]?.oc ?? null, helper: w[id]?.helper ?? null, [key]: value } }));
  const picked = events.filter((ev) => wishes[ev.id]?.oc || wishes[ev.id]?.helper);
  const ocPicks = events.filter((ev) => wishes[ev.id]?.oc).length;
  const open = events.filter((ev) => !ev.fixed.some((f) => f.me));
  const limitsId = `${cycleId}-limits`;
  const needLimit = picked.length > 0 && maxEvents === undefined;
  // The sticky count on phones hides once the summary itself is in view.
  const summary = useRef<HTMLDivElement>(null);
  const [summaryInView, setSummaryInView] = useState(false);
  useEffect(() => {
    const el = summary.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setSummaryInView(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (needLimit) {
          setMissing(true);
          document.getElementById(limitsId)?.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        const choices = Object.entries(wishes).map(([event_id, w]) => ({ event_id, oc_rank: w.oc, helper_rank: w.helper }));
        // Submitting locks the answers: the dialog lists them, and an empty form says what it means (usability review #8).
        const ok = await confirm(
          picked.length
            ? {
                title: `Submit your answers for ${month}?`,
                body: (
                  <>
                    <ul className="list-disc pl-5">
                      {picked.map((ev) => {
                        const w = wishes[ev.id]!;
                        return (
                          <li key={ev.id}>
                            {ev.title} ({ev.when}): {[w.oc && `OC – ${RANK_LABELS[w.oc]}`, w.helper && `helper – ${RANK_LABELS[w.helper]}`].filter(Boolean).join(", ")}
                          </li>
                        );
                      })}
                    </ul>
                    <p>
                      {maxEvents ? `At most ${plural(maxEvents, "event")}` : "No limit on events"}
                      {ocPicks > 1 ? (maxOc ? `, OC of at most ${plural(maxOc, "event")}.` : ", no limit on OC roles.") : "."}
                    </p>
                    <p>You submit once – afterwards ask the Events team to change anything.</p>
                  </>
                ),
                confirmLabel: `Submit (${plural(picked.length, "event")})`,
              }
            : {
                title: `Submit without any event?`,
                body: `You'll be listed as unavailable for all ${plural(events.length, "event")} of ${month}, and your answers are locked. To volunteer, pick OC or helper for at least one event first.`,
                confirmLabel: "Submit – I can't help this month",
                cancelLabel: "Back to the form",
                danger: true,
              }
        );
        if (!ok) return;
        run(
          submitVolunteerForm,
          { cycle_id: cycleId, choices, note, max_events: maxEvents ?? null, max_oc: maxOc },
          undefined,
          picked.length ? `Answers sent – you signed up for ${plural(picked.length, "event")}. The roster follows after the deadline.` : "Answers sent – you're unavailable this month."
        );
      }}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
    >
      <div className="min-w-0 space-y-8">
        <Step n={1} title="Pick your events" note="For each event, say how much you'd like to be its OC or a helper. Leave “No” where you can't.">
          <Legend />
          <ul className="space-y-3">
            {events.map((e) => (
              <EventCard key={e.id} event={e} wish={wishes[e.id]} onChange={(key, v) => set(e.id, key, v)} />
            ))}
          </ul>
        </Step>

        <Step n={2} title="Your limits" note="The roster never gives you more than this.">
          <div id={limitsId} className={cn("scroll-mt-24 space-y-5 rounded-2xl border bg-white p-4 shadow-sm sm:p-5", missing ? "border-red-300 ring-2 ring-red-100" : "border-gray-200")}>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">How many of these events can you do?</p>
              <Segmented
                label="How many of these events can you do?"
                name={`${cycleId}-max-events`}
                options={MAX_EVENTS}
                value={maxEvents}
                onChange={(v) => {
                  setMaxEvents(v);
                  setMissing(false);
                }}
              />
              {missing && <p className="text-xs font-medium text-red-700">Pick how many events you can do.</p>}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">How many of them as OC, at most?</p>
              <Segmented label="How many of them as OC, at most?" name={`${cycleId}-max-oc`} options={MAX_OC} value={maxOc} onChange={setMaxOc} />
              <p className="text-xs text-gray-500">Only matters if you pick OC for more than one event. Being OC of your own idea counts too.</p>
            </div>
          </div>
        </Step>

        <Step n={3} title="Anything else?" note="Optional – e.g. “only after 18:00 on weekdays”.">
          <Textarea aria-label="Note for the Events team" placeholder="A note for the Events team" rows={3} className="rounded-xl" value={note} onChange={(e) => setNote(e.target.value)} />
        </Step>

        {/* Phones and tablets: the count stays in view above the tab bar, until the summary below scrolls in. */}
        <div className={cn("sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 lg:hidden", summaryInView && "invisible")} aria-hidden={summaryInView || undefined}>
          <a
            href={`#${cycleId}-answers`}
            className="flex items-center gap-3 rounded-xl bg-esn px-4 py-3 text-sm text-white shadow-lg"
          >
            <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-white/15 px-2 font-bold tabular-nums">{picked.length}</span>
            <span className="min-w-0 flex-1 truncate">
              {picked.length ? `${plural(picked.length, "event")} picked${ocPicks ? ` · ${ocPicks} as OC` : ""}` : "Nothing picked yet"}
            </span>
            <span className="shrink-0 font-semibold">Review &amp; submit ↓</span>
          </a>
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20">
        <div ref={summary} id={`${cycleId}-answers`} className="scroll-mt-20 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-live="polite">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">Your answers</h3>
          <p className="mt-1 text-gray-900">
            <span className="text-3xl font-bold tabular-nums">{picked.length}</span>
            <span className="text-sm text-gray-600">
              {" "}
              of {plural(open.length, "event")} picked{ocPicks > 0 && ` · ${ocPicks} as OC`}
            </span>
          </p>
          {picked.length > 0 ? (
            <ul className="mt-3 space-y-1.5 text-sm">
              {picked.map((ev) => {
                const w = wishes[ev.id]!;
                return (
                  <li key={ev.id} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-esn" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-900">{ev.title}</span>
                      <span className="block text-xs text-gray-600">{[w.oc && `OC: ${RANK_LABELS[w.oc]}`, w.helper && `Helper: ${RANK_LABELS[w.helper]}`].filter(Boolean).join(" · ")}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-600">Nothing picked yet. Can&apos;t help this month? Submit as it is and you&apos;re listed as unavailable.</p>
          )}
          {needLimit && (
            <a href={`#${limitsId}`} className={cn("mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium", missing ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800")}>
              <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
              Still to answer: how many events you can do (step 2).
            </a>
          )}
          {error && (
            <Alert tone="error" className="mt-3">
              {error}
            </Alert>
          )}
          <Button size="lg" className="mt-4 w-full" disabled={pending}>
            {pending ? "Submitting…" : "Submit my answers"}
          </Button>
          <p className="mt-2 text-center text-xs text-gray-500">You submit once: afterwards your answers are locked.</p>
        </div>
        <HowItWorks />
      </aside>
    </form>
  );
}

/** A numbered step of the form. */
function Step({ n, title, note, children }: { n: number; title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-esn text-sm font-bold text-white" aria-hidden="true">
          {n}
        </span>
        <div>
          <h3 className="font-bold text-gray-900">{title}</h3>
          {note && <p className="text-sm text-gray-600">{note}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** The scale in one line, with the one rule that matters while answering. */
function Legend() {
  return (
    <div className="space-y-2 rounded-xl bg-esn/5 px-4 py-3 text-xs text-esn-dark">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold">Less keen</span>
        {[5, 4, 3, 2, 1].map((r) => (
          <span key={r} className={cn("rounded-md px-2 py-0.5 font-medium", RANK_TONE[r])}>
            {RANK_LABELS[r]}
          </span>
        ))}
        <span className="font-semibold">More keen</span>
      </div>
      <p className="flex items-start gap-1.5 text-gray-700">
        <Sparkles className="mt-px h-3.5 w-3.5 shrink-0 text-esn" aria-hidden="true" />
        Your answers count relative to each other: keep “Top choice” for real favourites – if everything is top, nothing stands out.
      </p>
    </div>
  );
}

function EventCard({ event: e, wish, onChange }: { event: FormEvent; wish: Wish | undefined; onChange: (key: keyof Wish, v: number | null) => void }) {
  const me = e.fixed.find((f) => f.me);
  const fixedOcs = e.fixed.filter((f) => f.role === "oc");
  const fixedHelpers = e.fixed.filter((f) => f.role === "helper");
  const names = (fs: typeof e.fixed) => fs.map((f) => `${f.name} (${f.proposer ? "proposed the idea" : "from the idea"})`).join(", ");
  const chosen = !!(wish?.oc || wish?.helper);
  return (
    <li
      data-testid={`volunteer-${e.title}`}
      className={cn("rounded-2xl border bg-white p-4 shadow-sm transition-colors sm:p-5", chosen ? "border-esn/40 ring-1 ring-esn/20" : "border-gray-200", me && "bg-emerald-50/40")}
    >
      <div className="flex gap-3">
        <DateTile iso={e.startsAt} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-gray-600">
            <span className="tabular-nums">{e.time}</span>
            {e.type && <span className="rounded bg-gray-100 px-1.5 py-px text-gray-700">{e.type}</span>}
            {e.mine && <span className="rounded bg-esn/10 px-1.5 py-px font-semibold text-esn">Your idea</span>}
            {chosen && (
              <span className="ml-auto inline-flex items-center gap-0.5 font-semibold text-esn">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Picked
              </span>
            )}
          </p>
          <p className="mt-0.5 font-semibold leading-snug text-gray-900 break-words">{e.title}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
            {e.venue && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                <span className="truncate">{e.venue}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
              Needs {e.ocs > 1 ? `${e.ocs} OCs` : "1 OC"} · {plural(e.helpers, "helper")}
            </span>
          </p>
        </div>
      </div>

      {me ? (
        // Their own event (proposer or partner): they are on it already, so nothing to answer.
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          You are {me.role === "oc" ? "an OC" : "a helper"} – {me.proposer ? "you proposed it" : "you joined the idea"}. Nothing to answer here.
        </p>
      ) : (
        <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          <RoleRow icon={UserRound} title="OC" sub="organise it">
            {fixedOcs.length >= e.ocs ? (
              <p className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <Lock className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                {names(fixedOcs)}
              </p>
            ) : (
              <>
                <Segmented label={`OC for ${e.title}`} options={RANKS} value={wish?.oc ?? null} onChange={(v) => onChange("oc", v)} scale />
                {fixedOcs.length > 0 && <p className="mt-1 text-xs text-gray-500">With {names(fixedOcs)}</p>}
              </>
            )}
          </RoleRow>
          <RoleRow icon={Users} title="Helper" sub="lend a hand">
            <Segmented label={`Helper for ${e.title}`} options={RANKS} value={wish?.helper ?? null} onChange={(v) => onChange("helper", v)} scale />
            {fixedHelpers.length > 0 && <p className="mt-1 text-xs text-gray-500">Helping already: {names(fixedHelpers)}</p>}
          </RoleRow>
        </div>
      )}
    </li>
  );
}

/** One role's answer: its name on the left on wide screens, above the buttons on phones. */
function RoleRow({ icon: Icon, title, sub, children }: { icon: typeof Users; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-3">
      <p className="flex items-center gap-1.5 text-sm">
        <Icon className="h-4 w-4 text-gray-400" aria-hidden="true" />
        <span className="font-semibold text-gray-900">{title}</span>
        <span className="text-xs text-gray-500 sm:hidden">– {sub}</span>
      </p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The roster rules in short (lib/allocation.ts), folded beside the form. */
function HowItWorks() {
  return (
    <details className="group rounded-2xl border border-gray-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-900 sm:px-5 [&::-webkit-details-marker]:hidden">
        <Info className="h-4 w-4 text-esn" aria-hidden="true" />
        How the roster is made
        <span aria-hidden="true" className="ml-auto text-xs text-gray-400 transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ul className="list-disc space-y-1.5 px-4 pb-4 pl-8 text-xs text-gray-600 sm:px-5 sm:pl-9">
        <li>If you proposed the idea and want to OC it, you are its OC; partners who accepted your idea are its co-OCs or helpers. Nobody is asked for the OC slots they fill.</li>
        <li>Every event gets an OC first; nobody OCs a second event while someone else who wants to can take it.</li>
        <li>Helpers are placed in rounds: everyone gets one event before anyone gets a second, and never more than you said you can do.</li>
        <li>
          Your answers also count <strong>relative to each other</strong>: marking everything &quot;Top choice&quot; makes each one count for less. Answer honestly and your
          favourites win.
        </li>
        <li>Events with few volunteers are filled first, so you may get an &quot;If needed&quot; event when nobody else can do it.</li>
        <li>You are never put on two events at the same time. If you got nothing last month, you get a head start. Ties are drawn by lot – submitting early does not help.</li>
        <li>The Events team checks the roster and can still change it before it is published.</li>
      </ul>
    </details>
  );
}

/**
 * One radio group as a row of buttons, e.g. No · If needed · … · Top choice.
 * `scale`: equal-width cells across the whole row (two-line labels on phones), each answer in its own shade.
 */
function Segmented({
  label,
  name = label,
  options,
  value,
  onChange,
  scale,
}: {
  label: string;
  /** The radios' name: unique on the page (two months' forms can be open). */
  name?: string;
  options: Option[];
  /** undefined: nothing picked yet. */
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  scale?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("rounded-lg border border-gray-300 bg-white p-0.5 text-xs", scale ? "grid w-full grid-cols-6 gap-0.5" : "inline-flex flex-wrap gap-0.5")}
    >
      {options.map((o) => {
        const checked = value === o.value;
        return (
          <label
            key={o.label}
            className={cn(
              // relative: the radio sits inside its own option, not under a neighbour.
              "relative flex min-h-10 cursor-pointer items-center justify-center rounded-md px-2 py-1 text-center font-medium leading-tight has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-esn-accent sm:min-h-9",
              scale ? "px-1" : "min-w-10",
              checked ? o.tone : "text-gray-600 hover:bg-gray-100"
            )}
          >
            {/* An invisible radio over the whole option (round 2026-11-03 (2)): a click lands on the radio itself –
                a 1-pixel sr-only radio left the label on top, which automated clicks refuse. */}
            <input type="radio" className="absolute inset-0 m-0 cursor-pointer opacity-0" name={name} checked={checked} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
