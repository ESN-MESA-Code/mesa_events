// Node runtime only (instrumentation.ts): stop the server when the staging
// configuration is unsafe.
import { assertStagingConfig } from "@/lib/staging";

try {
  assertStagingConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
