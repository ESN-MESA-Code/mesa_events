import { redirect } from "next/navigation";

// The office hours overview is gone (round 2026-11-03 (2)): a member's own
// duties are in My events, all office hours on the Calendar, who is on duty
// in Internal planning, the cash boxes under Finance. Old links land on the
// Calendar's ESN events, where office hours belong (2026-11-04).
export default function OfficeHoursPage() {
  redirect("/calendar?show=events");
}
