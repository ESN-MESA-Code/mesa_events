import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getViewer } from "@/lib/supabase/session";
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
          <Link href="/" className="shrink-0 flex items-center gap-3" aria-label="MESA Events – home">
            <Image src="/esn-mesa-logo-white.png" alt="ESN MESA München" width={600} height={334} priority className="h-11 w-auto" />
            <span className="hidden sm:inline text-lg font-semibold tracking-tight">Events</span>
          </Link>
          {/* No Google profile picture: loading it would show Google the member's IP address. */}
          <div className="ml-auto flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0" title={`Signed in as ${viewer.email}`}>
              <span aria-hidden="true" className="h-9 w-9 rounded-full bg-white/15 ring-2 ring-white/40 flex items-center justify-center text-sm font-semibold shrink-0">
                {initials}
              </span>
              <div className="hidden md:block leading-tight min-w-0">
                <p className="text-sm font-medium truncate max-w-[14rem]" data-testid="viewer-name">{viewer.name}</p>
                <p className="text-xs text-white/70 truncate max-w-[16rem]" data-testid="viewer-roles">
                  {viewer.roles.length ? viewer.roles.map((r) => ROLE_LABELS[r]).join(" · ") : "Member"}
                </p>
              </div>
            </div>
            <form action="/auth/signout" method="post">
              <button className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white/90 hover:bg-white/10">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <Nav nav={navItems(viewer.roles, { open: forms.length > 0, submitted: forms.every((f) => f.submittedAt) })} />
      </header>
      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-8">{children}</main>
    </>
  );
}
