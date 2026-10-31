import { notFound } from "next/navigation";

// Unknown addresses render the member area's "Not found" inside its layout,
// so signed-in members keep the header and navigation (usability review
// #29); app/not-found.tsx stays for everything outside the member area.
export default function Missing() {
  notFound();
}
