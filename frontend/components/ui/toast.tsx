"use client";

import { Button } from "./button";
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from "@/components/icons";

const TONE_STYLE = {
  success: { ink: "text-tone-success-ink", icon: CheckIcon },
  warning: { ink: "text-tone-warning-ink", icon: AlertIcon },
  danger: { ink: "text-tone-danger-ink", icon: AlertIcon },
  info: { ink: "text-tone-info-ink", icon: InfoIcon },
} as const;

type ToastProps = {
  toast: {
    id: string;
    title?: string;
    description?: string;
    tone?: "success" | "warning" | "danger" | "info";
    leaving?: boolean;
  };
  onDismiss: () => void;
};

/** A single toast. It slides in from the top edge as feedback, and fades out faster than it came in. */
export function Toast({ toast, onDismiss }: ToastProps) {
  const style = TONE_STYLE[toast.tone ?? "info"];
  const Icon = style.icon;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-control bg-surface p-4 text-ink ${toast.leaving ? "animate-fade-out" : "animate-slide-in"}`}
    >
      <Icon size={16} aria-hidden className={`shrink-0 ${style.ink}`} />
      <div className="min-w-0 flex-1">
        {toast.title && <p className="text-sm font-medium text-ink">{toast.title}</p>}
        {toast.description && <p className="text-xs text-ink2">{toast.description}</p>}
      </div>
      <Button variant="ghost" size="icon" onClick={onDismiss} className="text-muted" aria-label="Dismiss">
        <CloseIcon size={16} />
      </Button>
    </div>
  );
}
