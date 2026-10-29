// The API of the ESN Activities browser script (brief 2026-10-29, B):
//   GET  /api/esn/events/[id]         → { ok, data } (the ESN form data)
//   POST /api/esn/events/[id]/linked  { url } → { ok } (links the saved activity)
// Cookies are not sent from activities.esn.org, so the script sends a Comms
// member's personal access token as "Authorization: Bearer mesa_esn_…".
// The token is hashed and resolved by the database (esn_token_owner: active,
// not expired, owner still in Comms); the data is then read with the service
// role – event data only, never names, claims or notes. CORS is allowed for
// https://activities.esn.org only; requests from other origins are refused.
// Rate limits per token and, for failed sign-ins, per address. Server only.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadEsn } from "@/lib/esn/load";

export const ESN_ORIGIN = "https://activities.esn.org";
export const TOKEN_PATTERN = /^mesa_esn_[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A fixed-window counter per key, in this process (one app server on the VPS). */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private max: number,
    private windowMs: number
  ) {}

  /** Seconds to wait, or 0 when the hit is allowed. */
  hit(key: string, now = Date.now()): number {
    const h = this.hits.get(key);
    if (!h || h.reset <= now) {
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return 0;
    }
    h.n++;
    return h.n > this.max ? Math.ceil((h.reset - now) / 1000) : 0;
  }

  clear() {
    this.hits.clear();
  }
}

/** 60 calls a minute per token (the script makes one or two per upload). */
export const tokenLimiter = new RateLimiter(60, 60_000);
/** 20 calls without a valid token per 10 minutes per address. */
export const failureLimiter = new RateLimiter(20, 10 * 60_000);

export function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin", "Cache-Control": "no-store" };
  if (origin === ESN_ORIGIN) {
    h["Access-Control-Allow-Origin"] = ESN_ORIGIN;
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

const json = (body: unknown, status: number, origin: string | null, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...corsHeaders(origin), ...extra } });

export function preflight(request: Request): Response {
  const origin = request.headers.get("origin");
  return new Response(null, { status: origin === ESN_ORIGIN ? 204 : 403, headers: corsHeaders(origin) });
}

const clientAddress = (request: Request) => (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

type Auth = { ok: true; hash: string; email: string } | { ok: false; response: Response };

/** Origin, token and rate limits. */
async function authenticate(request: Request, admin: SupabaseClient<Database>): Promise<Auth> {
  const origin = request.headers.get("origin");
  // Browsers send an Origin with cross-site requests; only the ESN site may call.
  if (origin && origin !== ESN_ORIGIN) return { ok: false, response: json({ ok: false, error: "This origin is not allowed." }, 403, origin) };
  const fail = (status: number, error: string) => {
    const wait = failureLimiter.hit(clientAddress(request));
    return wait
      ? { ok: false as const, response: json({ ok: false, error: "Too many attempts – try again later." }, 429, origin, { "Retry-After": String(wait) }) }
      : { ok: false as const, response: json({ ok: false, error }, status, origin, status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) };
  };
  const token = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  if (!TOKEN_PATTERN.test(token)) return fail(401, "Personal access token missing or malformed – create one on the ESN Activities page of MESA Events.");
  const hash = hashToken(token);
  const wait = tokenLimiter.hit(hash);
  if (wait) return { ok: false, response: json({ ok: false, error: "Too many requests – try again later." }, 429, origin, { "Retry-After": String(wait) }) };
  const { data, error } = await admin.rpc("esn_token_owner", { hash });
  if (error) throw new Error(error.message);
  const owner = (data ?? [])[0];
  if (!owner) return fail(401, "This token is not valid (revoked, expired, or you are no longer in the Comms team).");
  return { ok: true, hash, email: owner.email };
}

export async function getEsnEvent(request: Request, eventId: string, admin: SupabaseClient<Database>): Promise<Response> {
  const origin = request.headers.get("origin");
  const auth = await authenticate(request, admin);
  if (!auth.ok) return auth.response;
  if (!UUID.test(eventId)) return json({ ok: false, error: "No such event." }, 404, origin);
  const { data: event } = await admin.from("events").select("id, status").eq("id", eventId).maybeSingle();
  if (!event || ["draft", "dropped"].includes(event.status)) return json({ ok: false, error: "No such event." }, 404, origin);
  const entry = (await loadEsn(admin, [eventId])).get(eventId)!;
  return json({ ok: true, data: entry.data, uploaded: entry.upload?.activity_url ?? null }, 200, origin);
}

export async function linkEsnEvent(request: Request, eventId: string, admin: SupabaseClient<Database>): Promise<Response> {
  const origin = request.headers.get("origin");
  const auth = await authenticate(request, admin);
  if (!auth.ok) return auth.response;
  if (!UUID.test(eventId)) return json({ ok: false, error: "No such event." }, 404, origin);
  let url = "";
  try {
    url = String(((await request.json()) as { url?: unknown }).url ?? "");
  } catch {
    return json({ ok: false, error: "Send { url } as JSON." }, 400, origin);
  }
  const { error } = await admin.rpc("esn_api_link", { hash: auth.hash, event: eventId, url });
  if (error) {
    const status = error.code === "42501" ? 401 : error.code === "22023" ? (/No such event/.test(error.message) ? 404 : 400) : 500;
    return json({ ok: false, error: status === 500 ? "Could not link the activity." : error.message }, status, origin);
  }
  return json({ ok: true }, 200, origin);
}
