"use client";

import { useId, useState } from "react";
import { Badge, Button, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { setIdeaPartners } from "@/app/actions/planning";

export type Member = { id: string; name: string };
export type Partner = { profile_id: string; role: "oc" | "helper"; status?: "invited" | "accepted" | "declined" };

const STATUS = { invited: { label: "asked", tone: "amber" }, accepted: { label: "said yes", tone: "green" }, declined: { label: "said no", tone: "red" } } as const;

/**
 * Partners on an idea (round 2026-11-04): members the proposer runs it with,
 * each as co-OC or helper. They are asked and count once they say yes. At
 * most five; a name is picked from the member list (type to search).
 */
export function PartnerPicker({ members, value, onChange }: { members: Member[]; value: Partner[]; onChange: (v: Partner[]) => void }) {
  const list = useId();
  const [name, setName] = useState("");
  const [role, setRole] = useState<"oc" | "helper">("helper");
  const [problem, setProblem] = useState<string | null>(null);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  const add = () => {
    const m = members.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!m) return setProblem("Pick a member from the list.");
    if (value.some((p) => p.profile_id === m.id)) return setProblem(`${m.name} is on the idea already.`);
    if (value.length >= 5) return setProblem("At most five partners.");
    onChange([...value, { profile_id: m.id, role }]);
    setName("");
    setProblem(null);
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1" data-testid="idea-partners">
          {value.map((p) => (
            <li key={p.profile_id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-gray-900">{nameOf.get(p.profile_id) ?? "?"}</span>
              <Select
                aria-label={`Role of ${nameOf.get(p.profile_id) ?? "partner"}`}
                className="w-auto py-1 text-xs"
                value={p.role}
                onChange={(e) => onChange(value.map((x) => (x.profile_id === p.profile_id ? { profile_id: x.profile_id, role: e.target.value as "oc" | "helper" } : x)))}
              >
                <option value="oc">Co-OC</option>
                <option value="helper">Helper</option>
              </Select>
              {p.status && <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>}
              <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => onChange(value.filter((x) => x.profile_id !== p.profile_id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length < 5 && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Partner's name"
            list={list}
            className="w-56"
            placeholder="Type a member's name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <datalist id={list}>
            {members.map((m) => (
              <option key={m.id} value={m.name} />
            ))}
          </datalist>
          <Select aria-label="Partner's role" className="w-auto" value={role} onChange={(e) => setRole(e.target.value as "oc" | "helper")}>
            <option value="helper">as helper</option>
            <option value="oc">as co-OC</option>
          </Select>
          <Button type="button" variant="outline" onClick={add}>
            Add
          </Button>
        </div>
      )}
      {problem && <p className="text-xs font-medium text-red-700">{problem}</p>}
    </div>
  );
}

/** Changing the partners of an open idea: unchanged ones keep their answer, a new role asks again. */
export function IdeaPartnersEditor({ ideaId, members, partners }: { ideaId: string; members: Member[]; partners: Partner[] }) {
  const { run, pending, error } = useAction();
  const [value, setValue] = useState(partners);
  const changed = JSON.stringify(value.map(({ profile_id, role }) => [profile_id, role])) !== JSON.stringify(partners.map(({ profile_id, role }) => [profile_id, role]));
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">They are asked first and count once they say yes. Nobody else is asked for the slots they take.</p>
      <PartnerPicker members={members} value={value} onChange={setValue} />
      {changed && (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => run(setIdeaPartners, { idea_id: ideaId, partners: value.map(({ profile_id, role }) => ({ profile_id, role })) }, undefined, "Partners saved – new ones are asked.")}
        >
          {pending ? "Saving…" : "Save partners"}
        </Button>
      )}
      {error && <p className="text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}
