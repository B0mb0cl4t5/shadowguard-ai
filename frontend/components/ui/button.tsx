import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "danger-subtle" | "bare";
export type ButtonSize = "sm" | "md" | "icon";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink text-ground hover:bg-ink2",
  secondary: "bg-raised text-ink2 hover:bg-raised-hover",
  outline: "border border-control text-ink2 hover:bg-raised",
  ghost: "text-ink2 hover:bg-raised hover:text-ink",
  danger: "bg-danger-fill text-white hover:bg-danger-fill-hover",
  "danger-subtle": "border border-tone-danger-line bg-tone-danger text-tone-danger-ink hover:bg-raised",
  bare: "",
};

/** Compact for a mouse; 44px wherever the pointer is a finger. */
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-7 px-3 text-xs [@media(pointer:coarse)]:min-h-11",
  md: "min-h-[34px] px-3.5 text-sm [@media(pointer:coarse)]:min-h-11",
  icon: "h-[34px] w-[34px] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
};

const BASE =
  // A press shrinks the button slightly; only colour and that scale animate, never layout.
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.97] disabled:active:scale-100";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(function Button({ variant = "outline", size = "md", type = "button", className = "", ...props }, ref) {
  // "bare" is for whole-row click targets, which bring their own layout.
  const styles = variant === "bare" ? "" : `${BASE} ${SIZE[size]} ${VARIANT[variant]}`;
  return <button ref={ref} type={type} className={`${styles} ${className}`} {...props} />;
});

/** A few mutually exclusive choices side by side, like a view switch. The chosen one sits on a raised fill. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`inline-flex items-center rounded-md border border-control p-0.5 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`inline-flex min-h-7 items-center whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors [@media(pointer:coarse)]:min-h-11 ${
            o.value === value ? "bg-raised text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small filter inside a panel: selection is a line as wide as its label. */
export function TabButton({
  selected,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`inline-flex min-h-7 items-center gap-1 whitespace-nowrap border-b text-xs transition-colors [@media(pointer:coarse)]:min-h-11 ${
        selected ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
      } ${className}`}
      {...props}
    />
  );
}
