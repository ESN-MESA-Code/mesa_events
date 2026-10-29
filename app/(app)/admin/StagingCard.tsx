import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { RESET_CONFIRMATION } from "@/lib/actions/staging";

const MESSAGES: Record<string, { tone: "ok" | "error"; text: string }> = {
  done: { tone: "ok", text: "The demo data was reset." },
  confirm: { tone: "error", text: `Type ${RESET_CONFIRMATION} to confirm.` },
  failed: { tone: "error", text: "The reset failed – see the server log." },
};

/**
 * Staging only (the admin page renders it when lib/staging.ts says so):
 * "Reset demo data", confirmed by typing RESET. A plain form posting to
 * /admin/demo-data/reset – no client code, so a production build has none
 * of it in its browser bundle (tests/bundle).
 */
export function StagingCard({ result }: { result?: string }) {
  const message = result ? MESSAGES[result] : undefined;
  return (
    <Card data-testid="staging-reset">
      <CardHeader>
        <CardTitle>Demo data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-gray-600">
          Throws away everything that happened on this demo site – events, answers, descriptions, claims, the outbox – and builds the
          demo months again, relative to today. Members who signed in with Google keep their accounts and roles.
        </p>
        <form action="/admin/demo-data/reset" method="post" className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-sm font-medium text-gray-700">Type {RESET_CONFIRMATION} to confirm</span>
            <input
              name="confirm"
              required
              pattern={RESET_CONFIRMATION}
              autoComplete="off"
              className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Reset demo data</button>
        </form>
        {message && (
          <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? "text-emerald-700" : "text-red-600"}>
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
