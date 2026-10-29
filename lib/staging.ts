// App environments and the staging gates (docs/STAGING.md).
//
// APP_ENV (runtime) and NEXT_PUBLIC_APP_ENV (inlined by `next build`) are
// production | staging | development. A staging deployment is a production
// build with demo data only: a banner on every page, noindex, the fakes for
// every external service, and a demo sign-in behind an access code.
//
// The demo sign-in (and the demo data reset) need ALL of these:
//   - NEXT_PUBLIC_APP_ENV=staging at build time – written out literally below,
//     so a production build drops the staging code (tests/bundle);
//   - APP_ENV=staging at runtime;
//   - the Supabase project ref equals STAGING_SUPABASE_PROJECT_REF;
//   - and differs from PRODUCTION_SUPABASE_PROJECT_REF when that is set.
// tests/unit/staging.test.ts covers every combination.

export type AppEnv = "production" | "staging" | "development";

const APP_ENVS: readonly AppEnv[] = ["production", "staging", "development"];

export function parseAppEnv(value: string | undefined, nodeEnv: string | undefined): AppEnv {
  const v = (value ?? "").trim().toLowerCase();
  if ((APP_ENVS as readonly string[]).includes(v)) return v as AppEnv;
  return nodeEnv === "production" ? "production" : "development";
}

/** Whether this is a staging build (NEXT_PUBLIC_APP_ENV, a build-time constant). */
export function isStagingBuild(): boolean {
  return process.env.NEXT_PUBLIC_APP_ENV === "staging";
}

/** The runtime environment (APP_ENV; unset = production in production builds, else development). */
export function appEnv(env: Record<string, string | undefined> = process.env): AppEnv {
  return parseAppEnv(env.APP_ENV, process.env.NODE_ENV);
}

/** Staging build and staging runtime: banner, noindex, fakes. */
export function isStaging(env: Record<string, string | undefined> = process.env): boolean {
  return isStagingBuild() && env.APP_ENV === "staging";
}

/** The demo outbox and other presenter tools: staging, and development (dev:local). */
export function demoToolsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (isStaging(env)) return true;
  return process.env.NODE_ENV !== "production" && appEnv(env) === "development";
}

/**
 * The project a Supabase URL belongs to: the subdomain of a hosted project
 * (https://<ref>.supabase.co), otherwise host and port (a self-hosted or the
 * local stack, e.g. "127.0.0.1:54421"). Null for anything that is not a URL.
 */
export function supabaseProjectRef(url: string | undefined): string | null {
  try {
    const u = new URL(url ?? "");
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase();
    const hosted = host.match(/^([a-z0-9]+)\.supabase\.(co|in)$/);
    return hosted ? hosted[1] : u.host.toLowerCase();
  } catch {
    return null;
  }
}

export interface StagingGateEnv {
  NEXT_PUBLIC_APP_ENV?: string;
  APP_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  STAGING_SUPABASE_PROJECT_REF?: string;
  PRODUCTION_SUPABASE_PROJECT_REF?: string;
}

function gateEnv(): StagingGateEnv {
  return {
    // Literal, so `next build` inlines it.
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    APP_ENV: process.env.APP_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    STAGING_SUPABASE_PROJECT_REF: process.env.STAGING_SUPABASE_PROJECT_REF,
    PRODUCTION_SUPABASE_PROJECT_REF: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
  };
}

/** The staging gates that do not hold (empty = all hold). */
export function failedStagingGates(env: StagingGateEnv = gateEnv()): string[] {
  const failed: string[] = [];
  if (env.NEXT_PUBLIC_APP_ENV !== "staging") failed.push("NEXT_PUBLIC_APP_ENV is not staging (build time)");
  if (env.APP_ENV !== "staging") failed.push("APP_ENV is not staging");
  const ref = supabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  const staging = (env.STAGING_SUPABASE_PROJECT_REF ?? "").trim().toLowerCase();
  const production = (env.PRODUCTION_SUPABASE_PROJECT_REF ?? "").trim().toLowerCase();
  if (!staging) failed.push("STAGING_SUPABASE_PROJECT_REF is not set");
  else if (ref !== staging) failed.push(`the Supabase project (${ref ?? "no URL"}) is not STAGING_SUPABASE_PROJECT_REF`);
  if (production && (staging === production || ref === production)) {
    failed.push("the staging project is PRODUCTION_SUPABASE_PROJECT_REF");
  }
  return failed;
}

export function stagingGatesHold(env: StagingGateEnv = gateEnv()): boolean {
  return failedStagingGates(env).length === 0;
}

export const MIN_ACCESS_CODE_LENGTH = 16;

/** The demo sign-in: every gate, and an access code of at least 16 characters. */
export function stagingSignInEnabled(env: StagingGateEnv & { STAGING_ACCESS_CODE?: string } = { ...gateEnv(), STAGING_ACCESS_CODE: process.env.STAGING_ACCESS_CODE }): boolean {
  return stagingGatesHold(env) && (env.STAGING_ACCESS_CODE ?? "").length >= MIN_ACCESS_CODE_LENGTH;
}

// Real credentials of external services: none of them may be set on staging.
export const REAL_CREDENTIAL_VARS = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_KEY", "TELEGRAM_BOT_TOKEN"] as const;

/**
 * What is wrong with a staging configuration (checked at boot by
 * instrumentation.ts, which refuses to start). Empty when the environment is
 * not staging at all, or when it is configured correctly.
 */
export function stagingConfigProblems(env: Record<string, string | undefined>, buildAppEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV): string[] {
  const buildStaging = buildAppEnv === "staging";
  const runtimeStaging = env.APP_ENV === "staging";
  if (!buildStaging && !runtimeStaging) return [];
  if (buildStaging !== runtimeStaging) {
    return [
      buildStaging
        ? "This is a staging build (NEXT_PUBLIC_APP_ENV=staging) but APP_ENV is not staging"
        : "APP_ENV=staging needs a staging build (NEXT_PUBLIC_APP_ENV=staging at build time)",
    ];
  }
  const problems = failedStagingGates({ ...env, NEXT_PUBLIC_APP_ENV: buildAppEnv });
  if (env.GOOGLE_MODE !== "fake") problems.push(`GOOGLE_MODE must be "fake" on staging (is ${env.GOOGLE_MODE ? `"${env.GOOGLE_MODE}"` : "unset"})`);
  for (const name of REAL_CREDENTIAL_VARS) {
    if ((env[name] ?? "").trim()) problems.push(`${name} must not be set on staging (fakes only)`);
  }
  if ((env.STAGING_ACCESS_CODE ?? "").length < MIN_ACCESS_CODE_LENGTH) {
    problems.push(`STAGING_ACCESS_CODE must be at least ${MIN_ACCESS_CODE_LENGTH} characters`);
  }
  return problems;
}

/** Throws (refusing to start) when staging is misconfigured. */
export function assertStagingConfig(env: Record<string, string | undefined> = process.env): void {
  // The Supabase URL the build baked in is the one the app talks to.
  const problems = stagingConfigProblems({ ...env, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL });
  if (problems.length) {
    throw new Error(`Refusing to start: the staging configuration is unsafe.\n${problems.map((p) => `  - ${p}`).join("\n")}\nSee docs/STAGING.md.`);
  }
}
