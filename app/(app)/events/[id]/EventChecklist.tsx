import Link from "next/link";
import { loadEventForPage } from "@/lib/events";
import { nowMs } from "@/lib/dates";
import { DEADLINE_CANCELS, eventChecklist } from "@/lib/checklist";
import { DueLabel } from "@/components/status";
import { StepIcon } from "@/components/StepIcon";
import { checklistInput } from "@/lib/eventStatus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/utils";


// What still has to happen for this event (OC, helpers and the teams).
export async function EventChecklist({ eventId }: { eventId: string }) {
  const { event, supabase, isStaff, isTeam, cycle } = await loadEventForPage(eventId);
  if (!isStaff && !isTeam) return null;
  const input = await checklistInput(supabase, event, cycle?.description_deadline ?? null);
  const items = eventChecklist(input);
  if (!items.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Checklist</CardTitle>
        <span className="text-xs text-gray-500">
          {items.filter((i) => i.state === "done").length}/{items.length} done
        </span>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm" data-testid="checklist">
          {items.map((i) => (
            <li key={i.key} data-state={i.state}>
              <Link
                href={`/events/${eventId}${i.tab ? `/${i.tab}` : ""}`}
                className={cn("flex flex-wrap items-baseline gap-x-2 rounded px-1 -mx-1 hover:bg-gray-50", i.state === "later" && "text-gray-400", i.state === "late" && "text-red-700")}
              >
                <StepIcon kind={i.state} />
                <span className="hover:underline">{i.label}</span>
                <span className="ml-auto text-xs text-gray-500">
                  {i.detail}
                  {i.due && <DueLabel iso={i.due} now={nowMs()} note={i.key === "description" && ["missing", "draft"].includes(input.description) ? DEADLINE_CANCELS : undefined} className="block text-right" />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
