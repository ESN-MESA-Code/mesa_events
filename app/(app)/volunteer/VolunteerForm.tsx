"use client";

import { useState } from "react";
import { Alert, Badge, Button, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { submitVolunteerForm } from "@/app/actions/planning";
import { RANK_LABELS } from "@/lib/volunteer";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";

type Wish = { oc: number | null; helper: number | null };
/** `off`: the "No" answer, shown grey when picked. */
type Option = { value: number | null; label: string; off?: boolean };

/** From "no" up to "top choice", as segmented buttons (usability review #19). */
const RANKS: Option[] = [{ value: null, label: "No", off: true }, ...[5, 4, 3, 2, 1].map((r) => ({ value: r, label: RANK_LABELS[r] }))];
/** How many events this month; null = no limit. */
const MAX_EVENTS: Option[] = [...[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })), { value: null, label: "No limit" }];
/** How many of them as OC; null = no limit. */
const MAX_OC: Option[] = [...[1, 2, 3].map((n) => ({ value: n, label: String(n) })), { value: null, label: "No limit" }];

export function VolunteerForm({
  cycleId,
  month,
  events,
}: {
  cycleId: string;
  /** "December 2026" – named in the confirm dialog. */
  month: string;
  events: Array<{
    id: string;
    title: string;
    type: string;
    when: string;
    location: string;
    helpers: number;
    /** OCs needed (round 2026-11-04: several per event). */
    ocs: number;
    /** On the event already: the idea's proposer (OC) and the partners who accepted. Once they fill the OC slots, no OC answers. */
    fixed: Array<{ name: string; role: "oc" | "helper"; me: boolean; proposer: boolean }>;
    /** The viewer proposed the idea or joined it as partner. */
    mine: boolean;
  }>;
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

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (picked.length && maxEvents === undefined) {
          setMissing(true);
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
      className="space-y-4"
    >
      <ul className="divide-y divide-gray-100">
        {events.map((e) => {
          const me = e.fixed.find((f) => f.me);
          const fixedOcs = e.fixed.filter((f) => f.role === "oc");
          const fixedHelpers = e.fixed.filter((f) => f.role === "helper");
          const names = (fs: typeof e.fixed) => fs.map((f) => `${f.name} (${f.proposer ? "proposed the idea" : "from the idea"})`).join(", ");
          return (
            <li key={e.id} data-testid={`volunteer-${e.title}`} className="grid gap-2 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 break-words">
                  {e.title}
                  {e.mine && (
                    <Badge tone="blue" className="ml-2 align-middle">
                      Your idea
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-gray-500">
                  {e.when} · {e.type}
                  {e.location && ` · ${e.location}`} · {e.ocs > 1 && `${e.ocs} OCs · `}
                  {plural(e.helpers, "helper")}
                </p>
              </div>
              {me ? (
                // Their own event (proposer or partner): they are on it already, so nothing to answer.
                <p className="text-xs text-gray-600 lg:max-w-xs">
                  You are {me.role === "oc" ? "an OC" : "a helper"} – {me.proposer ? "you proposed it" : "you joined the idea"}. Nothing to answer here.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {fixedOcs.length >= e.ocs ? (
                    <p className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="w-12 shrink-0 font-medium text-gray-500">OC</span>
                      {names(fixedOcs)}
                    </p>
                  ) : (
                    <>
                      <Segmented label={`OC for ${e.title}`} short="OC" options={RANKS} value={wishes[e.id]?.oc ?? null} onChange={(v) => set(e.id, "oc", v)} />
                      {fixedOcs.length > 0 && <p className="pl-14 text-xs text-gray-500">With {names(fixedOcs)}</p>}
                    </>
                  )}
                  <Segmented label={`Helper for ${e.title}`} short="Helper" options={RANKS} value={wishes[e.id]?.helper ?? null} onChange={(v) => set(e.id, "helper", v)} />
                  {fixedHelpers.length > 0 && <p className="pl-14 text-xs text-gray-500">Helping already: {names(fixedHelpers)}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {/* Always shown, so the question is not missed (required once an event is picked). */}
      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-gray-900">How many of these events can you do?</p>
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
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-gray-900">How many of them as OC, at most?</p>
          <Segmented label="How many of them as OC, at most?" name={`${cycleId}-max-oc`} options={MAX_OC} value={maxOc} onChange={setMaxOc} />
          <p className="text-xs text-gray-500">Only matters if you pick OC for more than one event. Being OC of your own idea counts too.</p>
        </div>
      </div>
      <Textarea aria-label="Note for the Events team" placeholder="Anything the Events team should know (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      <Button disabled={pending}>{pending ? "Submitting…" : "Submit my answers"}</Button>
      <p className="text-xs text-gray-500">You submit once: afterwards your answers are locked.</p>
      <HowItWorks />
    </form>
  );
}

/** The allocation in short (lib/allocation.ts), so nobody has to guess how to answer. */
function HowItWorks() {
  return (
    <section aria-labelledby="how-roster" className="rounded-md border border-gray-200 p-3 text-xs text-gray-600">
      <h3 id="how-roster" className="mb-1.5 text-sm font-medium text-gray-900">
        How the roster is made
      </h3>
      <ul className="list-disc space-y-1 pl-4">
        <li>If you proposed the idea and want to OC it, you are its OC; partners who accepted your idea are its co-OCs or helpers. Nobody is asked for the OC slots they fill.</li>
        <li>Every event gets an OC first; nobody OCs a second event while someone else who wants to can take it.</li>
        <li>Helpers are placed in rounds: everyone gets one event before anyone gets a second, and never more than you said you can do.</li>
        <li>
          Your answers also count <strong>relative to each other</strong>: marking everything &quot;Top choice&quot; makes each one count for less. Answer honestly and
          your favourites win.
        </li>
        <li>Events with few volunteers are filled first, so you may get an &quot;If needed&quot; event when nobody else can do it.</li>
        <li>You are never put on two events at the same time. If you got nothing last month, you get a head start. Ties are drawn by lot – submitting early does not help.</li>
        <li>The Events team checks the roster and can still change it before it is published.</li>
      </ul>
    </section>
  );
}

/** One radio group as a row of buttons, e.g. No · If needed · … · Top choice. */
function Segmented({
  label,
  name = label,
  short,
  options,
  value,
  onChange,
}: {
  label: string;
  /** The radios' name: unique on the page (two months' forms can be open). */
  name?: string;
  short?: string;
  options: Option[];
  /** undefined: nothing picked yet. */
  value: number | null | undefined;
  onChange: (v: number | null) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-start gap-2">
      {short && <span className="w-12 shrink-0 pt-1.5 text-xs font-medium text-gray-500">{short}</span>}
      <div className="inline-flex flex-wrap rounded-md border border-gray-300 bg-white text-xs">
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.label}
              className={cn(
                // relative: the radio sits inside its own option, not under a neighbour.
                "relative cursor-pointer px-2 py-1.5 first:rounded-l-md last:rounded-r-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-esn-accent",
                checked ? (o.off ? "bg-gray-200 text-gray-800" : "bg-esn text-white") : "text-gray-600 hover:bg-gray-50"
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
    </div>
  );
}
