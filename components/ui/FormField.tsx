import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

export function FormField({
  label,
  id,
  ...props
}: { label: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block text-sm font-medium text-white/80">
        {label}
      </span>
      <input
        id={id}
        className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3.5 text-white placeholder:text-white/40 transition focus:border-lime focus:outline-none focus:ring-2 focus:ring-lime/40"
        {...props}
      />
    </label>
  );
}

export function FormTextarea({
  label,
  id,
  ...props
}: {
  label: string;
  id: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block text-sm font-medium text-white/80">
        {label}
      </span>
      <textarea
        id={id}
        className="min-h-28 w-full resize-y rounded-2xl border border-white/15 bg-white/10 px-4 py-3.5 text-white placeholder:text-white/40 transition focus:border-lime focus:outline-none focus:ring-2 focus:ring-lime/40"
        {...props}
      />
    </label>
  );
}
