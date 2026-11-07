import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { nowMs } from "@/lib/dates";
import { sectionEvents, type MyEventSection } from "@/lib/myEvents";
import { itemStep, itemTimed, loadMyDuties, loadMyEvents, myItems, type MyItem } from "@/lib/myEventsLoad";
import { buttonVariants, PageHeader } from "@/components/ui";
import { SectionHeader } from "@/components/home";
import { MyDutyCard, MyEventCard } from "@/components/MyEventCard";

export const metadata: Metadata = { title: "My events" };

const SECTIONS: Array<{ id: Exclude<MyEventSection, "done">; title: string; hint: string }> = [
  { id: "today", title: "Today", hint: "" },
  { id: "todo", title: "To do", hint: "Coming up – the next step is yours." },
  { id: "upcoming", title: "Coming up", hint: "Nothing for you to do right now." },
  { id: "finish", title: "To finish", hint: "Over – the hand-in or the cash box is still yours." },
];

// The member's own events and nothing else (round 2026-11-03 (2)): each
// with its next step, by what is to do – their ESN events and their duties
// at office hours and Stammtisch. Reimbursements have their own page in the
// navigation; the volunteer form is on Volunteer. Redesign 2026-11-07: the
// sections as headings over a grid of cards, as on Home.
export default async function MePage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const now = nowMs();
  const [events, duties] = await Promise.all([loadMyEvents(supabase, viewer.id, now), loadMyDuties(supabase, viewer.id, now)]);
  const items = myItems(events, duties);
  const sections = sectionEvents(items, itemTimed, itemStep, now);

  return (
    <>
      <PageHeader title="My events" description="Where you are OC or helper – events, office hours and Stammtisch – and what's next for each." />
      <div className="space-y-8">
        {!items.length && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
            <CalendarPlus className="h-8 w-8 text-gray-300" aria-hidden="true" />
            <p className="font-semibold text-gray-900">Nothing planned yet</p>
            <p className="max-w-md text-sm text-gray-600">Volunteer when the next form opens, or claim an open slot on Home.</p>
            <Link href="/" className={buttonVariants({ variant: "outline" })}>
              See open slots on Home
            </Link>
          </div>
        )}
        {SECTIONS.filter((s) => sections[s.id].length).map((s) => (
          <section key={s.id} aria-labelledby={`my-${s.id}-heading`} className="space-y-3">
            <SectionHeader id={`my-${s.id}-heading`} title={s.title} count={sections[s.id].length} note={s.hint || undefined} />
            <ul className="grid items-start gap-4 lg:grid-cols-2" data-testid={`my-${s.id}`}>
              {sections[s.id].map((x) => (
                <Item key={x.key} x={x} now={now} />
              ))}
            </ul>
          </section>
        ))}
        {sections.done.length > 0 && (
          <details className="group rounded-2xl border border-gray-200 bg-white shadow-sm" data-testid="my-done">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
              <span className="text-lg font-bold text-gray-900">Done</span>
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-gray-200 px-2 text-xs font-bold tabular-nums text-gray-700">{sections.done.length}</span>
              <span className="ml-auto text-sm font-semibold text-esn group-open:hidden">Show</span>
              <span className="ml-auto hidden text-sm font-semibold text-gray-500 group-open:inline">Hide</span>
            </summary>
            <ul className="grid items-start gap-4 px-4 pb-4 sm:px-5 sm:pb-5 lg:grid-cols-2">
              {sections.done.map((x) => (
                <Item key={x.key} x={x} now={now} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}

function Item({ x, now }: { x: MyItem; now: number }) {
  return x.type === "event" ? <MyEventCard item={x.item} now={now} from="me" /> : <MyDutyCard item={x.item} />;
}
