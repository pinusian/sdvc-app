import type { InputHTMLAttributes } from "react";

export function Field({
  label,
  name,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-ink">{label}</span>
      <input
        id={name}
        name={name}
        className={`w-full rounded-sm border border-border bg-surface px-3.5 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft ${className}`}
        {...props}
      />
    </label>
  );
}
