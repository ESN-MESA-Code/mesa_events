// The staging demo's cast: fictional members with "….demo@<domain>"
// addresses (no real people), and the personas the demo sign-in offers.
// Shared by the seed (lib/staging/seed.ts) and the sign-in (app/staging).
import type { AppRole } from "@/lib/roles";

export interface DemoPerson {
  key: string;
  id: string;
  name: string;
  /** Local part before ".demo@". */
  handle: string;
  roles: AppRole[];
  /** Has not accepted the confidentiality rules yet. */
  newcomer?: boolean;
  /** Volunteers a lot: many events, OC more often. */
  active?: boolean;
}

const id = (n: number) => `d5000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

// Order matters for nothing but the ids, which stay stable across resets.
const CAST: Array<Omit<DemoPerson, "id">> = [
  { key: "amara", name: "Amara Okafor", handle: "amara.okafor", roles: ["events"], active: true },
  { key: "lukas", name: "Lukas Brandt", handle: "lukas.brandt", roles: ["events"] },
  { key: "sofia", name: "Sofia Marino", handle: "sofia.marino", roles: ["comms"], active: true },
  { key: "kenji", name: "Kenji Watanabe", handle: "kenji.watanabe", roles: ["comms"] },
  { key: "priya", name: "Priya Raman", handle: "priya.raman", roles: ["finance"] },
  { key: "mateo", name: "Mateo Álvarez", handle: "mateo.alvarez", roles: ["treasurer"] },
  { key: "elif", name: "Elif Yıldız", handle: "elif.yildiz", roles: ["executive"] },
  { key: "jonas", name: "Jonas Lindqvist", handle: "jonas.lindqvist", roles: ["executive", "events"] },
  { key: "nadia", name: "Nadia Haddad", handle: "nadia.haddad", roles: ["admin"] },
  { key: "chloe", name: "Chloé Dubois", handle: "chloe.dubois", roles: [], active: true },
  { key: "tomasz", name: "Tomasz Nowicki", handle: "tomasz.nowicki", roles: [], active: true },
  { key: "aisha", name: "Aisha Bello", handle: "aisha.bello", roles: [] },
  { key: "diego", name: "Diego Fernández", handle: "diego.fernandez", roles: [], active: true },
  { key: "ingrid", name: "Ingrid Solberg", handle: "ingrid.solberg", roles: [] },
  { key: "hamza", name: "Hamza Qureshi", handle: "hamza.qureshi", roles: [] },
  { key: "lea", name: "Léa Fontaine", handle: "lea.fontaine", roles: [] },
  { key: "mei", name: "Mei Lin Chen", handle: "meilin.chen", roles: [] },
  { key: "oskar", name: "Oskar Virtanen", handle: "oskar.virtanen", roles: [] },
  { key: "zeynep", name: "Zeynep Arslan", handle: "zeynep.arslan", roles: [] },
  { key: "rafael", name: "Rafael Costa", handle: "rafael.costa", roles: [] },
  { key: "hannah", name: "Hannah Becker", handle: "hannah.becker", roles: [] },
  { key: "kwame", name: "Kwame Mensah", handle: "kwame.mensah", roles: [] },
  { key: "anna", name: "Anna Kowalska", handle: "anna.kowalska", roles: [] },
  { key: "yusuf", name: "Yusuf Demir", handle: "yusuf.demir", roles: [] },
  { key: "camila", name: "Camila Rojas", handle: "camila.rojas", roles: [] },
  { key: "felix", name: "Felix Hartmann", handle: "felix.hartmann", roles: [] },
  { key: "ana", name: "Ana Petrović", handle: "ana.petrovic", roles: [] },
  { key: "liam", name: "Liam O'Connor", handle: "liam.oconnor", roles: [] },
  { key: "sara", name: "Sara Nilsson", handle: "sara.nilsson", roles: [] },
  { key: "arjun", name: "Arjun Mehta", handle: "arjun.mehta", roles: [] },
  { key: "giulia", name: "Giulia Ferri", handle: "giulia.ferri", roles: [] },
  { key: "nikos", name: "Nikos Papadakis", handle: "nikos.papadakis", roles: [] },
  { key: "fatima", name: "Fatima Zahra El Idrissi", handle: "fatima.elidrissi", roles: [] },
  { key: "emil", name: "Emil Novák", handle: "emil.novak", roles: ["newbie"] },
  { key: "isabel", name: "Isabel Moreau", handle: "isabel.moreau", roles: [] },
  { key: "thanh", name: "Thanh Nguyen", handle: "thanh.nguyen", roles: [] },
  { key: "marta", name: "Marta Kovač", handle: "marta.kovac", roles: ["newbie"] },
  { key: "pedro", name: "Pedro Santos", handle: "pedro.santos", roles: ["newbie"] },
  { key: "hiro", name: "Hiro Takeda", handle: "hiro.takeda", roles: ["newbie"] },
  { key: "noor", name: "Noor Al-Sayed", handle: "noor.alsayed", roles: [], newcomer: true },
  // Added later: new ids at the end, the earlier ones stay.
  { key: "ines", name: "Ines Kraft", handle: "ines.kraft", roles: ["hr"], active: true },
  { key: "marco", name: "Marco Bianchi", handle: "marco.bianchi", roles: ["vice_president", "executive"] },
];

export const DEMO_PEOPLE: DemoPerson[] = CAST.map((p, i) => ({ ...p, id: id(i + 1) }));

export function demoEmail(p: Pick<DemoPerson, "handle">, domain: string): string {
  return `${p.handle}.demo@${domain}`.toLowerCase();
}

export function person(key: string): DemoPerson {
  const p = DEMO_PEOPLE.find((x) => x.key === key);
  if (!p) throw new Error(`No demo person "${key}"`);
  return p;
}

/** A demo address: the local part ends in ".demo" (never a real member). */
export function isDemoEmail(email: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[a-z0-9-]+(\\.[a-z0-9-]+)*\\.demo@${d}$`).test(email.toLowerCase());
}

export interface Persona {
  key: string;
  person: string;
  label: string;
  /** What this role sees, for the picker. */
  sees: string;
  /** Where the persona starts. */
  start: string;
}

// The picker on /staging, in the order of the month's workflow.
export const PERSONAS: Persona[] = [
  {
    key: "events",
    person: "amara",
    label: "Events team",
    sees: "Plans the month: turns ideas into the schedule, opens and closes the volunteer form, runs the allocation, adjusts and confirms the roster.",
    start: "/team/events",
  },
  {
    key: "member",
    person: "hannah",
    label: "Member",
    sees: "Any member: proposes ideas, fills in the volunteer form, sees the calendar and claims open slots.",
    start: "/",
  },
  {
    key: "oc",
    person: "chloe",
    label: "OC (organiser)",
    sees: "Owns events: details, description, attendance list, photos and receipts; decides whether an under-staffed event runs.",
    start: "/",
  },
  {
    key: "helper",
    person: "kwame",
    label: "Helper",
    sees: "Helps at events: sees the event and its roster, checks people in, can drop out and claim open slots.",
    start: "/",
  },
  {
    key: "comms",
    person: "sofia",
    label: "Comms team",
    sees: "Reviews descriptions, asks for changes, approves and publishes them; tracks ESN Activities uploads.",
    start: "/team/comms",
  },
  {
    key: "finance",
    person: "priya",
    label: "Finance team",
    sees: "Receipts and paper receipts (Belege), checks claims, monthly payout batches and early payouts.",
    start: "/team/finance",
  },
  {
    key: "treasurer",
    person: "mateo",
    label: "Treasurer",
    sees: "Finance, plus the reimbursement rules and the pre-approvals for weekend trips.",
    start: "/team/finance",
  },
  {
    key: "hr",
    person: "ines",
    label: "HR",
    sees: "Plans internal events, office hours, Stammtisch, Tuesday Talks and board meetings, and staffs office hours and Stammtisch.",
    start: "/team/internal",
  },
  {
    key: "vice_president",
    person: "marco",
    label: "Vice President",
    sees: "Plans internal events with HR, and reads everything as a member of the executive board.",
    start: "/team/internal",
  },
  {
    key: "executive",
    person: "elif",
    label: "Executive (board)",
    sees: "Reads everything: all team pages, Finance read-only, names on closed attendance lists.",
    start: "/",
  },
  {
    key: "admin",
    person: "nadia",
    label: "Admin (IT)",
    sees: "Role mapping, settings, background jobs – and the demo data reset.",
    start: "/admin",
  },
  {
    key: "newcomer",
    person: "noor",
    label: "Newcomer",
    sees: "A new member who has not accepted the confidentiality rules yet: sees them first.",
    start: "/confidentiality",
  },
];

export function persona(key: string): Persona | undefined {
  return PERSONAS.find((p) => p.key === key);
}
