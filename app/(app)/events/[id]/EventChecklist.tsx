import Link from "next/link";
import { loadEventForPage } from "@/lib/events";
import { nowMs } from "@/lib/dates";
import { DEADLINE_CANCELS, eventChecklist } from "@/lib/checklist";
import { DueLabel } from "@/components/status";
import { StepIcon } from "@/components/StepIcon";
import { checklistInput } from "@/lib/eventStatus";
import { Panel } from "@/components/Panel";
import { cn } from "@/lib/utils";

// What still has to happen for this event (OC, helpers and the teams), with
// how far along it is as a bar (redesign 2026-11-07).
export async function EventChecklist({ eventId }: { eventId: string }) {
  const { event, supabase, isStaff, isTeam, cycle } = await loadEventForPage(eventId);
  if (!isStaff && !isTeam) return null;
  const input = await checklistInput(supabase, event, cycle?.description_deadline ?? null);
  const items = eventChecklist(input);
  if (!items.length) return null;
  const done = items.filter((i) => i.state === "done").length;
  return (
    <Panel
      title="Checklist"
      aside={
        <span className="text-sm text-gray-600">
          <span className="font-semibold tabular-nums text-gray-900">
            {done}/{items.length}
          </span>{" "}
          done
        </span>
      }
    >
      <div className="-mt-1 mb-4 h-1.5 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${done} of ${items.length} done`}>
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ul className="-mx-2 space-y-0.5 text-sm" data-testid="checklist">
        {items.map((i) => (
          <li key={i.key} data-state={i.state}>
            <Link
              href={`/events/${eventId}${i.tab ? `/${i.tab}` : ""}`}
              className={cn(
                "flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50",
                i.state === "later" && "text-gray-400",
                i.state === "late" && "text-red-700",
                i.state === "done" && "text-gray-500"
              )}
            >
              <StepIcon kind={i.state} />
              <span className="min-w-0 flex-1">
                <span className={cn("font-medium", i.state === "done" && "font-normal")}>{i.label}</span>
                {(i.detail || i.due) && (
                  <span className="block text-xs text-gray-500">
                    {i.detail}
                    {i.detail && i.due && " · "}
                    {i.due && <DueLabel iso={i.due} now={nowMs()} note={i.key === "description" && ["missing", "draft"].includes(input.description) ? DEADLINE_CANCELS : undefined} />}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
