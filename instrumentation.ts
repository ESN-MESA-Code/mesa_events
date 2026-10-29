// Runs once when the server starts. A staging deployment with real
// credentials, a Google mode other than fake or the production database
// refuses to start (lib/staging.ts, docs/STAGING.md).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./lib/staging/boot");
}
