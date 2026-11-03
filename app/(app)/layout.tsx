import Link from "next/link";
import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { BrandMark } from "@/components/BrandMark";
import { getViewer } from "@/lib/supabase/session";
import { ProfileMenu } from "@/components/ProfileMenu";
import { navItems } from "@/lib/nav";
import { volunteerForms } from "@/lib/eventStatus";
import { ROLE_LABELS } from "@/lib/roles";

// The member area. proxy.ts already sent signed-out visitors to /login and
// members who have not accepted the rules to /confidentiality.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.accepted) redirect("/confidentiality");
  const forms = await volunteerForms(viewer.id);

  const initials = viewer.name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

  return (
    <>
      <header className="bg-esn text-white shadow-md">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-4">
          <Link href="/" className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white" aria-label="ESN MESA Events – home">
            <BrandMark product="Events" />
          </Link>
          {/* No Google profile picture: loading it would show Google the member's IP address. */}
          <div className="ml-auto flex items-center gap-3 min-w-0" title={`Signed in as ${viewer.email}`}>
            <ProfileMenu
              name={viewer.name}
              email={viewer.email}
              roles={viewer.roles.length ? viewer.roles.map((r) => ROLE_LABELS[r]).join(" · ") : "Member"}
              initials={initials}
            />
          </div>
        </div>
        <Nav nav={navItems(viewer.roles, { open: forms.length > 0, submitted: forms.every((f) => f.submittedAt) })} />
      </header>
      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-8">{children}</main>
    </>
  );
}
