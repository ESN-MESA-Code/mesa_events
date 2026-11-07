// One of the member's ideas as a card (Ideas redesign 2026-11-07): the
// proposed day as a date tile, status first, the pitch, who runs it, the
// Events team's note, and the few things to do with it at the bottom.
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, GitMerge, UserRound, Users, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import { DateTile } from "@/components/DateTile";
import { CategoryBadge } from "@/components/Sorting";
import { withdrawIdea } from "@/app/actions/planning";
import type { Category } from "@/lib/formats";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { IdeaPartnersEditor, type Member, type Partner } from "./PartnerPicker";

export type IdeaStatus = "proposed" | "accepted" | "merged" | "rejected";

export const IDEA_STATUS: Record<IdeaStatus, { label: string; icon: LucideIcon; tone: string }> = {
  proposed: { label: "Waiting for Events", icon: Clock, tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  accepted: { label: "Accepted", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  merged: { label: "Merged", icon: GitMerge, tone: "bg-esn/5 text-esn ring-esn/20" },
  rejected: { label: "Not this time", icon: XCircle, tone: "bg-gray-100 text-gray-600 ring-gray-200" },
};

const ANSWER = { invited: "asked", accepted: "said yes", declined: "said no" } as const;
const ANSWER_TONE = { invited: "text-amber-700", accepted: "text-emerald-700", declined: "text-red-700" } as const;

export function StatusChip({ status }: { status: IdeaStatus }) {
  const s = IDEA_STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", s.tone)}>
      <s.icon className="h-3.5 w-3.5" aria-hidden="true" />
      {s.label}
    </span>
  );
}

export function IdeaCard({
  idea,
  category,
  members,
  nameOf,
}: {
  idea: {
    id: string;
    title: string;
    proposed_date: string;
    pitch: string | null;
    helpers_needed: number;
    ocs_needed: number;
    wants_to_oc: boolean;
    status: IdeaStatus;
    decision_note: string | null;
    event_id: string | null;
    partners: Partner[];
  };
  category: Category | null | undefined;
  members: Member[];
  nameOf: Map<string, string>;
}) {
  const open = idea.status === "proposed";
  const { partners } = idea;
  return (
    <li className={cn("flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm sm:p-5", idea.status === "rejected" ? "border-gray-200 bg-gray-50/60" : "border-gray-200")}>
      <div className="flex gap-3">
        <DateTile iso={`${idea.proposed_date}T12:00:00Z`} tone={idea.status === "rejected" ? "muted" : "default"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip status={idea.status} />
            <CategoryBadge category={category} />
          </div>
          <h3 className="mt-1.5 font-semibold leading-snug text-gray-900 break-words">{idea.title}</h3>
        </div>
      </div>

      {idea.pitch && <p className="line-clamp-3 whitespace-pre-line text-sm text-gray-600 break-words">{idea.pitch}</p>}

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1">
          <UserRound className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
          {idea.wants_to_oc ? "You OC it" : "Someone else OCs"}
          {idea.ocs_needed > 1 && ` · ${idea.ocs_needed} OCs`}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
          {plural(idea.helpers_needed, "helper")}
        </span>
      </p>

      {!open && partners.length > 0 && (
        <p className="text-xs text-gray-600">
          <span className="font-medium text-gray-700">With </span>
          {partners.map((p, n) => (
            <span key={p.profile_id}>
              {n > 0 && ", "}
              {nameOf.get(p.profile_id) ?? "?"} ({p.role === "oc" ? "co-OC" : "helper"}, <span className={ANSWER_TONE[p.status ?? "invited"]}>{ANSWER[p.status ?? "invited"]}</span>)
            </span>
          ))}
        </p>
      )}

      {idea.decision_note && (
        <p className="rounded-lg border-l-4 border-esn/30 bg-esn/5 px-3 py-2 text-sm text-gray-700">
          <span className="font-semibold text-esn-dark">Events team: </span>
          {idea.decision_note}
        </p>
      )}

      {open && (
        <details className="group rounded-lg border border-gray-200 open:bg-gray-50/60" open={partners.some((p) => p.status === "declined") || undefined}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
            <Users className="h-4 w-4 text-gray-400" aria-hidden="true" />
            {partners.length ? (
              <span className="min-w-0 flex-1 truncate text-gray-700">
                With{" "}
                {partners.map((p, n) => (
                  <span key={p.profile_id}>
                    {n > 0 && ", "}
                    {nameOf.get(p.profile_id) ?? "?"} <span className={cn("text-xs", ANSWER_TONE[p.status ?? "invited"])}>({ANSWER[p.status ?? "invited"]})</span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="flex-1 text-gray-600">Run it with someone?</span>
            )}
            <span className="shrink-0 text-xs font-semibold text-esn group-open:hidden">{partners.length ? "Change" : "Add people"}</span>
            <span aria-hidden="true" className="hidden shrink-0 text-xs text-gray-400 group-open:inline">
              ▴
            </span>
          </summary>
          <div className="px-3 pb-3">
            <IdeaPartnersEditor ideaId={idea.id} members={members} partners={partners} />
          </div>
        </details>
      )}

      {(idea.event_id || open) && (
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          {idea.event_id && (
            <Link href={`/events/${idea.event_id}?from=me`} className="inline-flex items-center gap-1 text-sm font-semibold text-esn hover:underline">
              Event page <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          {open && (
            // A real button that asks first (usability review #31).
            <span className="ml-auto">
              <ActionButton
                action={withdrawIdea}
                input={{ id: idea.id }}
                variant="ghost"
                className="text-red-700 hover:bg-red-50 hover:text-red-800"
                confirm={{
                  title: `Withdraw “${idea.title}”?`,
                  body: "The Events team no longer sees it for the schedule. To bring it back, propose it again.",
                  confirmLabel: "Withdraw the idea",
                  danger: true,
                }}
                done="Idea withdrawn."
              >
                Withdraw idea
              </ActionButton>
            </span>
          )}
        </div>
      )}
    </li>
  );
}
