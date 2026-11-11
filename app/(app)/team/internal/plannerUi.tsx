"use client";

// Drag and drop and the side panel, shared by the Calendar and the Duty
// roster tabs of the internal planning (split 2026-11-11).
import { useEffect } from "react";
import { useDraggable, useDroppable, type Data } from "@dnd-kit/core";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Draggable({ id, data, disabled, children, className }: { id: string; data: Data; disabled: boolean; children: React.ReactNode; className?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data, disabled });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn(className, !disabled && "cursor-grab touch-none active:cursor-grabbing", isDragging && "opacity-40")}>
      {children}
    </div>
  );
}

type DayHandlers = Pick<React.HTMLAttributes<HTMLDivElement>, "onContextMenu" | "onDoubleClick" | "onPointerUp">;

export function Drop({
  id,
  disabled,
  className,
  over,
  children,
  label,
  testId,
  handlers,
}: {
  id: string;
  disabled: boolean;
  className?: string;
  over: string;
  children: React.ReactNode;
  label?: string;
  testId?: string;
  /** Right-click, double-click, double-tap (a calendar day: add a date). */
  handlers?: DayHandlers;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div ref={setNodeRef} aria-label={label} data-testid={testId} className={cn(className, isOver && over)} {...handlers}>
      {children}
    </div>
  );
}

/**
 * The panel that slides in from the right – a date, "Repeat dates", the
 * defaults per kind. Not modal: the calendar stays usable beside it. Esc
 * (outside a field) or × closes it.
 */
export function SidePanel({
  label,
  testId,
  onClose,
  eyebrow,
  title,
  meta,
  icon,
  footer,
  children,
}: {
  label: string;
  testId: string;
  onClose: () => void;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-2xl" aria-label={label} data-testid={testId}>
      <header className="flex items-start gap-3 border-b border-gray-100 px-5 py-4">
        {icon}
        <div className="min-w-0 flex-1">
          {eyebrow && <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{eyebrow}</p>}
          <h2 className="truncate text-lg font-semibold text-gray-900">{title}</h2>
          {meta && <div className="mt-0.5 text-sm text-gray-600">{meta}</div>}
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-900" aria-label="Close">
          <X className="size-5" />
        </button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <footer className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50/80 px-5 py-3">{footer}</footer>}
    </aside>
  );
}
