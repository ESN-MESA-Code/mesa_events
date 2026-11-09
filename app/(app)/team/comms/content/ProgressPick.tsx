"use client";

import { useAction } from "@/components/ActionButton";
import { updatePostContent } from "@/app/actions/publishing";
import { PROGRESS, PROGRESS_LABEL, type Progress } from "@/lib/publishing";
import { PROGRESS_STYLE, ProgressPill } from "../schedule/PostContent";
import { cn } from "@/lib/utils";

/** A row's status on the content list: to do / in progress / ready, changed in place (posted and skipped as they are). */
export function ProgressPick({
  post,
  editable,
}: {
  post: { id: string; status: "planned" | "published" | "skipped"; progress: Progress; title: string | null; format: string | null; assignees: string[]; caption: string; designLink: string | null };
  editable: boolean;
}) {
  const { run, pending, error } = useAction();
  if (!editable || post.status !== "planned") return <ProgressPill post={post} />;
  return (
    <span className="block">
      <select
        aria-label="Status"
        value={post.progress}
        disabled={pending}
        onChange={(e) =>
          run(updatePostContent, {
            post_id: post.id,
            title: post.title ?? "",
            format: post.format ?? "",
            assignees: post.assignees,
            progress: e.target.value,
            caption: post.caption,
            design_link: post.designLink ?? "",
          })
        }
        className={cn("rounded-md border-0 py-0.5 pl-2 pr-7 text-xs font-medium focus:ring-2 focus:ring-esn", PROGRESS_STYLE[post.progress])}
      >
        {PROGRESS.map((p) => (
          <option key={p} value={p}>
            {PROGRESS_LABEL[p]}
          </option>
        ))}
      </select>
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </span>
  );
}
