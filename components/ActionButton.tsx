"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/actions/core";

export type ServerAction<T = unknown> = (input: unknown) => Promise<ActionResult<T>>;

export function describeError(r: ActionResult<unknown>): string | null {
  if (r.ok) return null;
  return r.issues?.length ? `${r.message} ${r.issues.join("; ")}` : r.message;
}

/** Runs a server action, refreshes the page's server data, keeps the error. */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run<T>(action: ServerAction<T>, input: unknown, onDone?: (data: T) => void) {
    setError(null);
    startTransition(async () => {
      const r = await action(input);
      if (!r.ok) {
        setError(describeError(r));
        return;
      }
      onDone?.(r.data);
      router.refresh();
    });
  }

  return { run, pending, error, setError };
}

/** A button that runs one server action (optionally after a confirm dialog). */
export function ActionButton({
  action,
  input,
  children,
  confirm,
  variant,
  size = "sm",
  className,
  disabled,
}: {
  action: ServerAction;
  input: unknown;
  children: React.ReactNode;
  confirm?: string;
  variant?: "default" | "outline" | "ghost" | "destructive" | "success" | "link";
  size?: "default" | "sm" | "lg";
  className?: string;
  disabled?: boolean;
}) {
  const { run, pending, error } = useAction();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={pending || disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          run(action, input);
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
