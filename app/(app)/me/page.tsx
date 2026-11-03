import type { Metadata } from "next";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { nowMs } from "@/lib/dates";
import { sectionEvents, type MyEventSection } from "@/lib/myEvents";
import { itemStep, itemTimed, loadMyDuties, loadMyEvents, myItems, type MyItem } from "@/lib/myEventsLoad";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
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
// navigation; the volunteer form is on Volunteer.
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
      <div className="max-w-3xl space-y-6">
        {!items.length && (
          <Card>
            <CardContent className="pt-5">
              <EmptyState>Nothing planned – volunteer when the next form opens, or claim an open slot on Home.</EmptyState>
            </CardContent>
          </Card>
        )}
        {SECTIONS.filter((s) => sections[s.id].length).map((s) => (
          <Section key={s.id} id={s.id} title={s.title} hint={s.hint} list={sections[s.id]} now={now} />
        ))}
        {sections.done.length > 0 && (
          <Card>
            <details data-testid="my-done">
              <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-base font-semibold text-gray-900">
                Done
                <Badge tone="gray">{sections.done.length}</Badge>
                <span className="ml-auto text-sm font-normal text-esn">Show</span>
              </summary>
              <CardContent>
                <ul className="space-y-3">
                  {sections.done.map((x) => (
                    <Item key={x.key} x={x} now={now} />
                  ))}
                </ul>
              </CardContent>
            </details>
          </Card>
        )}
      </div>
    </>
  );
}

function Item({ x, now }: { x: MyItem; now: number }) {
  return x.type === "event" ? <MyEventCard item={x.item} now={now} from="me" /> : <MyDutyCard item={x.item} />;
}

function Section({ id, title, hint, list, now }: { id: MyEventSection; title: string; hint: string; list: MyItem[]; now: number }) {
  return (
    <Card>
      <CardHeader>
        <div className="mr-auto">
          <CardTitle className="flex items-center gap-2">
            {title}
            <Badge tone={id === "todo" || id === "finish" ? "amber" : "gray"}>{list.length}</Badge>
          </CardTitle>
          {hint && <p className="text-xs text-gray-500">{hint}</p>}
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3" data-testid={`my-${id}`}>
          {list.map((x) => (
            <Item key={x.key} x={x} now={now} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
