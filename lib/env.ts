// Configuration from the environment (documented in .env.example).

/** Public base URL of the app, e.g. https://events.esnmesa.org (own domain, no trailing slash). */
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** The time zone all dates are shown and entered in. */
export const TIME_ZONE = "Europe/Berlin";
