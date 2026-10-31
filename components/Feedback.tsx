"use client";

// Feedback after actions (usability review 2026-10-30, #7 and #8): one
// status region for short messages ("toasts", role="status", optionally with
// an Undo) and one styled confirm dialog that names what is affected and what
// happens, instead of the browser's confirm(). Mounted once in the root layout.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  /** The question: "Help at Hike to the Kampenwand?" */
  title: string;
  /** What it means: date, consequence. */
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive or hard to undo: the confirm button is red. */
  danger?: boolean;
}

export interface ToastOptions {
  tone?: "success" | "error" | "info";
  /** An action in the message, e.g. Undo. */
  action?: { label: string; onClick: () => void };
  /** How long it stays (ms); 0 keeps it until closed. */
  duration?: number;
  /** Called when the message goes away without its action being used. */
  onExpire?: () => void;
}

interface Toast extends ToastOptions {
  id: number;
  message: string;
}

interface Feedback {
  toast: (message: string, options?: ToastOptions) => void;
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
}

const FeedbackContext = createContext<Feedback | null>(null);

/** Outside the provider (should not happen): the browser's own dialog, no messages. */
const fallback: Feedback = {
  toast: () => {},
  confirm: async (o) => window.confirm(typeof o === "string" ? o : [o.title, typeof o.body === "string" ? o.body : ""].filter(Boolean).join("\n\n")),
};

export function useFeedback(): Feedback {
  return useContext(FeedbackContext) ?? fallback;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [request, setRequest] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const nextId = useRef(1);
  // The messages' callbacks, outside state so onExpire runs exactly once.
  const live = useRef(new Map<number, Toast>());

  const dismiss = useCallback((id: number, expired: boolean) => {
    const t = live.current.get(id);
    if (!t) return;
    live.current.delete(id);
    if (expired) t.onExpire?.();
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = nextId.current++;
      const t = { id, message, ...options };
      live.current.set(id, t);
      setToasts((list) => [...list.slice(-2), t]);
      const duration = options.duration ?? (options.action ? 8000 : 5000);
      if (duration) setTimeout(() => dismiss(id, true), duration);
    },
    [dismiss]
  );

  const confirm = useCallback(
    (options: ConfirmOptions | string) =>
      new Promise<boolean>((resolve) => {
        setRequest({ ...(typeof options === "string" ? { title: options } : options), resolve });
      }),
    []
  );

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" data-testid="toasts">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg",
              t.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : t.tone === "info" ? "border-gray-200 bg-white text-gray-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"
            )}
            data-testid="toast"
          >
            <span className="mr-auto">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id, false);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="Close message" className="opacity-60 hover:opacity-100" onClick={() => dismiss(t.id, true)}>
              ✕
            </button>
          </div>
        ))}
      </div>
      {request && (
        <ConfirmDialog
          {...request}
          onClose={(ok) => {
            request.resolve(ok);
            setRequest(null);
          }}
        />
      )}
    </FeedbackContext.Provider>
  );
}

/** A modal <dialog>: focus stays inside, Escape cancels, focus returns to the button afterwards. */
function ConfirmDialog({ title, body, confirmLabel = "Yes", cancelLabel = "Cancel", danger, onClose }: ConfirmOptions & { onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-0 shadow-xl backdrop:bg-gray-900/40"
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
      data-testid="confirm-dialog"
    >
      <div className="space-y-3 p-5">
        <h2 id={titleId} className="text-base font-semibold text-gray-900">
          {title}
        </h2>
        {body && (
          <div id={bodyId} className="space-y-2 text-sm text-gray-600 whitespace-pre-line">
            {body}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="outline" autoFocus={danger} onClick={() => onClose(false)}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={danger ? "destructive" : "default"} autoFocus={!danger} onClick={() => onClose(true)} data-testid="confirm-yes">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
