import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL(".", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      // Pure logic, no services needed: `npm test`
      { resolve: { alias }, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], env: { TZ: "America/New_York" } } },
      // Against the local Supabase stack (`npm run supabase:start`): `npm run test:db`
      {
        resolve: { alias },
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // The tests share one local stack and its seeded members.
          fileParallelism: false,
        },
      },
      // After `npm run build`: no secrets in the browser bundle: `npm run test:bundle`
      { resolve: { alias }, test: { name: "bundle", include: ["tests/bundle/**/*.test.ts"] } },
    ],
  },
});
