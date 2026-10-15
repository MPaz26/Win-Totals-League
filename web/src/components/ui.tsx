import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-orange-600 text-white hover:bg-orange-700 disabled:bg-orange-300",
  secondary: "bg-white text-zinc-900 ring-1 ring-zinc-300 hover:bg-zinc-50 disabled:text-zinc-400",
  danger: "bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50 disabled:text-red-300",
  ghost: "text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 disabled:text-zinc-300",
};

export function Button({
  variant = "primary",
  size = "md",
  busy,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; busy?: boolean }) {
  const sizing = size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${sizing} ${variants[variant]} ${className}`}
      disabled={disabled || busy}
      {...props}
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className = "" }: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl bg-white p-5 shadow-sm ring-1 ring-zinc-200 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
      aria-label="Loading"
    />
  );
}

export function PageSpinner() {
  return (
    <div className="flex justify-center py-24 text-zinc-400">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  return (
    <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
      {error instanceof Error ? error.message : "Something went wrong."}
    </div>
  );
}

export function Badge({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "orange" | "green" | "blue" }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-700",
    orange: "bg-orange-100 text-orange-800",
    green: "bg-green-100 text-green-800",
    blue: "bg-blue-100 text-blue-800",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}
