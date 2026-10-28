import Link from "next/link";
import { loadEventForPage } from "@/lib/events";
import { formatDue, nowMs } from "@/lib/dates";
import { eventChecklist } from "@/lib/checklist";
import { checklistInput } from "@/lib/eventStatus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/utils";

const ICON = { done: "✅", todo: "⬜", late: "⚠️", later: "◻️" } as const;

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
                <span aria-hidden="true">{ICON[i.state]}</span>
                <span className="hover:underline">{i.label}</span>
                <span className="ml-auto text-xs text-gray-500">
                  {i.detail}
                  {i.due && <span className={cn("block text-right", i.state === "late" ? "text-red-700" : "text-gray-600")}>{formatDue(i.due, nowMs())}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
