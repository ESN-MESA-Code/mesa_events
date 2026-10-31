"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/actions/core";
import { useFeedback, type ConfirmOptions } from "@/components/Feedback";

export type ServerAction<T = unknown> = (input: unknown) => Promise<ActionResult<T>>;

export function describeError(r: ActionResult<unknown>): string | null {
  if (r.ok) return null;
  return r.issues?.length ? `${r.message} ${r.issues.join("; ")}` : r.message;
}

/** What to say once an action worked (usability review #7): a message, or one made from its result. */
export type DoneMessage<T = unknown> = string | ((data: T) => string | null) | null;

/**
 * Runs a server action, refreshes the page's server data, keeps the error.
 * With `done`, a short message in the page's status region says it worked.
 */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { toast, confirm } = useFeedback();

  function run<T>(action: ServerAction<T>, input: unknown, onDone?: (data: T) => void, done?: DoneMessage<T>) {
    setError(null);
    startTransition(async () => {
      const r = await action(input);
      if (!r.ok) {
        setError(describeError(r));
        return;
      }
      onDone?.(r.data);
      const message = typeof done === "function" ? done(r.data) : done;
      if (message) toast(message);
      router.refresh();
    });
  }

  return { run, pending, error, setError, confirm, toast };
}

/**
 * A button that runs one server action (optionally after the confirm dialog)
 * and says when it worked: `done`, or "Done." by default.
 */
export function ActionButton({
  action,
  input,
  children,
  confirm,
  done = "Done.",
  variant,
  size = "sm",
  className,
  disabled,
}: {
  action: ServerAction;
  input: unknown;
  children: React.ReactNode;
  confirm?: string | ConfirmOptions;
  done?: DoneMessage;
  variant?: "default" | "outline" | "ghost" | "destructive" | "success" | "link";
  size?: "default" | "sm" | "lg";
  className?: string;
  disabled?: boolean;
}) {
  const { run, pending, error, confirm: ask } = useAction();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={pending || disabled}
        onClick={async () => {
          if (confirm && !(await ask(confirm))) return;
          run(action, input, undefined, done);
        }}
      >
        {pending ? "…" : children}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-red-600 max-w-xs">
          {error}
        </span>
      )}
    </span>
  );
}
