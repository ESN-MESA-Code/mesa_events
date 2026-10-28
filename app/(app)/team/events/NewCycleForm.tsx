"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { createCycle } from "@/app/actions/planning";

export function NewCycleForm() {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [month, setMonth] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(createCycle, { month }, (data) => router.push(`/team/events/cycles/${(data as { id: string }).id}`));
      }}
    >
      <div>
        <Label htmlFor="cycle-month">New cycle: events in</Label>
        <Input id="cycle-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
        <p className="mt-1 text-xs text-gray-500">The month the events take place in – usually next month.</p>
      </div>
      <Button disabled={pending || !month}>Start planning</Button>
      {error && <Alert tone="error" className="w-full">{error}</Alert>}
    </form>
  );
}
