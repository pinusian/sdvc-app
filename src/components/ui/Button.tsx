import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "accent" | "secondary";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-ink text-surface hover:bg-accent-ink",
  accent: "bg-accent text-white hover:bg-accent-hover",
  secondary: "bg-surface text-ink border border-border hover:border-accent hover:text-accent-ink",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASS[variant]} ${className}`}
      {...props}
    />
  );
}
