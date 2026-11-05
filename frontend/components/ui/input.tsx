import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const FIELD =
  "w-full rounded-md border border-control bg-ground px-3 py-2 text-base text-ink placeholder-muted transition-colors focus:border-accent sm:text-sm";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { bare?: boolean }>(
  function Input({ bare = false, className = "", ...props }, ref) {
    return <input ref={ref} className={`${bare ? "" : FIELD} ${className}`} {...props} />;
  },
);

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD} resize-y ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${FIELD} ${className}`} {...props} />;
}
