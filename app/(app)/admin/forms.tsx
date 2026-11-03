"use client";

import { useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { APP_ROLES, ROLE_LABELS } from "@/lib/roles";
import { addManualRole, updateSetting } from "@/app/actions/admin";
import { FORM_OPENS_AT, parseTimelineDays, timelineDaysError, timelineSetting, type TimelineDays } from "@/lib/timeline";
import { describeDescriptionReminders, describeHandinReminders, parseReminderDays, reminderDaysError, reminderSetting, type ReminderDays } from "@/lib/reminders";

export function AddRoleForm() {
  const { run, pending, error } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("events");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(addManualRole, { email, role }, () => setEmail(""));
      }}
    >
      <div className="grow min-w-56">
        <Label htmlFor="role-email">Email</Label>
        <Input id="role-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@esnmesa.org" required />
      </div>
      <div>
        <Label htmlFor="role-role">Role</Label>
        <Select id="role-role" value={role} onChange={(e) => setRole(e.target.value)}>
          {APP_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </div>
      <Button disabled={pending}>Add manually</Button>
      {error && (
        <p role="alert" className="w-full text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

export function SettingsForm({ settings }: { settings: Record<string, unknown> }) {
  const { run, pending, error } = useAction();
  const [helpers, setHelpers] = useState(String(settings.default_helpers_needed ?? 2));
  const [threshold, setThreshold] = useState(String(Number(settings.early_payout_threshold_cents ?? 10000) / 100));
  const [notify, setNotify] = useState(settings.chat_notifications !== false);
  const [fixDays, setFixDays] = useState(String(settings.description_fix_days ?? 4));
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(updateSetting, { key: "default_helpers_needed", value: Number(helpers) });
        }}
      >
        <Label htmlFor="s-helpers">Default helpers per event</Label>
        <div className="flex gap-2">
          <Input id="s-helpers" type="number" min={0} max={50} value={helpers} onChange={(e) => setHelpers(e.target.value)} />
          <Button variant="outline" disabled={pending}>
            Save
          </Button>
        </div>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(updateSetting, { key: "early_payout_threshold_cents", value: Math.round(Number(threshold) * 100) });
        }}
      >
        <Label htmlFor="s-threshold">Early payout above (€)</Label>
        <div className="flex gap-2">
          <Input id="s-threshold" type="number" min={0} step="0.01" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          <Button variant="outline" disabled={pending}>
            Save
          </Button>
        </div>
      </form>
      <div>
        <Label htmlFor="s-notify">Chat notifications</Label>
        <label className="flex items-center gap-2 text-sm h-9">
          <input
            id="s-notify"
            type="checkbox"
            checked={notify}
            onChange={(e) => {
              setNotify(e.target.checked);
              run(updateSetting, { key: "chat_notifications", value: e.target.checked });
            }}
          />
          Notify OCs in Chat about roster changes
        </label>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(updateSetting, { key: "description_fix_days", value: Number(fixDays) }, undefined, "Saved.");
        }}
        data-testid="fix-days-setting"
      >
        <Label htmlFor="s-fix-days">Days to fix a description Comms sent back</Label>
        <div className="flex gap-2">
          <Input id="s-fix-days" type="number" min={1} max={14} value={fixDays} onChange={(e) => setFixDays(e.target.value)} />
          <Button variant="outline" disabled={pending}>
            Save
          </Button>
        </div>
        <p className="mt-1 text-xs text-gray-500">Then the event is cancelled – never before the deadline, at the latest 24 h before it starts.</p>
      </form>
      <TimelineForm value={settings.cycle_timeline} pending={pending} save={(value) => run(updateSetting, { key: "cycle_timeline", value }, undefined, "Timeline saved.")} />
      <RemindersForm value={settings.oc_reminders} pending={pending} save={(value) => run(updateSetting, { key: "oc_reminders", value }, undefined, "Reminders saved.")} />
      {error && (
        <p role="alert" className="sm:col-span-3 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/** The cycle's timeline (round 2026-11-02): four days of the month before the events. */
function TimelineForm({ value, pending, save }: { value: unknown; pending: boolean; save: (v: ReturnType<typeof timelineSetting>) => void }) {
  const [days, setDays] = useState(() => parseTimelineDays(value));
  const problem = timelineDaysError(days);
  const fields: Array<[keyof TimelineDays, string]> = [
    ["ideasDue", "Ideas due (23:59)"],
    ["formOpens", `Form opens (${FORM_OPENS_AT})`],
    ["formCloses", "Sign-up closes (23:59)"],
    ["descriptionsDue", "Descriptions due (23:59)"],
  ];
  return (
    <form
      className="sm:col-span-3 space-y-2 border-t border-gray-100 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) save(timelineSetting(days));
      }}
      data-testid="timeline-setting"
    >
      <p className="text-sm font-medium text-gray-900">Cycle timeline – days of the month before the events&apos; month</p>
      <div className="flex flex-wrap items-end gap-3">
        {fields.map(([k, label]) => (
          <div key={k}>
            <Label htmlFor={`s-${k}`}>{label}</Label>
            <Input id={`s-${k}`} type="number" min={1} max={28} className="w-24" value={String(days[k])} onChange={(e) => setDays({ ...days, [k]: Number(e.target.value) })} />
          </div>
        ))}
        <Button variant="outline" disabled={pending || !!problem}>
          Save
        </Button>
      </div>
      {problem && <p className="text-xs text-amber-800">{problem}</p>}
    </form>
  );
}

/** The automatic reminders to the OC (round 2026-11-03): when they start and how often they repeat. */
function RemindersForm({ value, pending, save }: { value: unknown; pending: boolean; save: (v: ReturnType<typeof reminderSetting>) => void }) {
  const [days, setDays] = useState(() => parseReminderDays(value));
  const problem = reminderDaysError(days);
  const field = (k: keyof ReminderDays, label: string, min: number, max: number) => (
    <div key={k}>
      <Label htmlFor={`r-${k}`}>{label}</Label>
      <Input id={`r-${k}`} type="number" min={min} max={max} className="w-24" value={String(days[k])} onChange={(e) => setDays({ ...days, [k]: Number(e.target.value) })} />
    </div>
  );
  return (
    <form
      className="sm:col-span-3 space-y-3 border-t border-gray-100 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) save(reminderSetting(days));
      }}
      data-testid="reminder-setting"
    >
      <div>
        <p className="text-sm font-medium text-gray-900">Reminders to the OC</p>
        <p className="text-xs text-gray-500">Sent in the event&apos;s Chat space between 10:00 and 20:00, at most once a day per event. 0 days switches a reminder off.</p>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Description</legend>
        <div className="flex flex-wrap items-end gap-3">
          {field("descriptionDaysBefore", "Start, days before the deadline", 0, 14)}
          {field("descriptionEveryDays", "Repeat every … days", 1, 14)}
        </div>
        <p className="text-xs text-gray-600">{describeDescriptionReminders(days)}</p>
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hand-in (attendance list, photos, event report)</legend>
        <div className="flex flex-wrap items-end gap-3">
          {field("handinDaysAfter", "Start, days after the event", 0, 14)}
          {field("handinEveryDays", "Repeat every … days", 1, 14)}
          {field("handinMax", "At most … reminders", 1, 10)}
        </div>
        <p className="text-xs text-gray-600">{describeHandinReminders(days)}</p>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button variant="outline" disabled={pending || !!problem}>
          Save reminders
        </Button>
        {problem && <p className="text-xs text-amber-800">{problem}</p>}
      </div>
    </form>
  );
}
