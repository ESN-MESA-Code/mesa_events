// The staging gates for the local stack (build:staging, start:staging, the
// staging-mode E2E): a staging build and runtime whose "staging project" is
// the local Supabase. The access code is a local test value, not a secret.
export const STAGING_LOCAL_ENV = {
  NEXT_PUBLIC_APP_ENV: "staging",
  APP_ENV: "staging",
  STAGING_SUPABASE_PROJECT_REF: "127.0.0.1:54421",
  STAGING_ACCESS_CODE: "local-staging-access-code",
  GOOGLE_MODE: "fake",
};
