import { redirect } from "next/navigation";

// ESN Activities moved to the executive board (round 2026-10-30): old links still work.
export default function OldEsnActivitiesPage() {
  redirect("/team/esn-activities");
}
