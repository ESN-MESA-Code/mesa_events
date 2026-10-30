// The local Supabase stack started by `npm run supabase:start` (ports 544xx,
// see supabase/config.toml). The keys are the fixed, public demo keys of
// every local stack – never production ones.
export const LOCAL_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  SUPABASE_SERVICE_ROLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
  NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN: "esnmesa.org",
  // Matches private.config in supabase/seed.sql (pg_cron calls the runner).
  JOBS_SECRET: "local-jobs-secret-not-for-production",
  APP_BASE_URL: "http://localhost:3000",
  GOOGLE_MODE: "fake",
  // Address suggestions and checks from a built-in list (lib/geocode.ts); dev:local uses Photon.
  ADDRESS_LOOKUP: "fake",
};
