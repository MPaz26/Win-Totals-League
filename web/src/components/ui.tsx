import { useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from "react";
import type { LeagueStatus } from "../lib/types";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-mint text-night hover:bg-mint-deep disabled:bg-mint/30 disabled:text-night/60",
  secondary: "bg-raised text-ink ring-1 ring-line hover:bg-hover disabled:text-faint",
  danger: "bg-rose/10 text-rose ring-1 ring-rose/30 hover:bg-rose/20 disabled:text-rose/40",
  ghost: "text-mute hover:bg-raised hover:text-ink disabled:text-faint disabled:hover:bg-transparent",
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
  const sizing = size === "sm" ? "px-3 py-1.5 text-xs" : "px-5 py-2.5 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold transition-colors disabled:cursor-not-allowed ${sizing} ${variants[variant]} ${className}`}
      disabled={disabled || busy}
      {...props}
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className = "", flush }: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Drop the body padding, for edge-to-edge lists. */
  flush?: boolean;
}) {
  return (
    <section className={`rounded-2xl bg-panel ring-1 ring-line/70 ${flush ? "" : "p-4 sm:p-5"} ${className}`}>
      {(title || actions) && (
        <div className={`flex items-center justify-between gap-3 ${flush ? "px-4 pt-4 pb-3 sm:px-5 sm:pt-5" : "mb-4"}`}>
          {title && <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-mute">{title}</h2>}
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
    <div className="flex justify-center py-24 text-mint">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  return (
    <div className="rounded-xl bg-rose/10 p-4 text-sm text-rose ring-1 ring-rose/30">
      {error instanceof Error ? error.message : "Something went wrong."}
    </div>
  );
}

export type Tone = "neutral" | "live" | "mint";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const tones = {
    neutral: "bg-raised text-mute",
    live: "bg-gold/15 text-gold",
    mint: "bg-mint/15 text-mint",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tones[tone]}`}>
      {tone === "live" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />}
      {children}
    </span>
  );
}

export const statusBadge: Record<LeagueStatus, { label: string; tone: Tone }> = {
  lobby: { label: "Pre-draft", tone: "neutral" },
  drafting: { label: "Drafting", tone: "live" },
  complete: { label: "In season", tone: "mint" },
};

/** Up to two initials, plus a stable non-negative hash for picking a color. */
function monogram(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const initials = name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return { initials, hash: Math.abs(hash) };
}

/** A square league avatar: initials on a gradient picked from the name. */
export function LeagueMark({ name, className = "h-12 w-12 text-base" }: { name: string; className?: string }) {
  const gradients = [
    "from-mint to-sky-500",
    "from-gold to-orange-500",
    "from-rose to-fuchsia-500",
    "from-indigo-400 to-violet-600",
    "from-sky-400 to-blue-600",
  ];
  const { initials, hash } = monogram(name);
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br font-extrabold text-night ${gradients[hash % gradients.length]} ${className}`}
      aria-hidden
    >
      {initials}
    </span>
  );
}

const AVATAR_COLORS = ["#16d9c0", "#ffc53d", "#ff5c7a", "#7c8cff", "#4cc3ff", "#c084fc", "#fb923c", "#4ade80"];

/** Initials on a color picked from the name, like a default fantasy avatar. */
export function Avatar({ name, className = "h-9 w-9 text-sm" }: { name: string; className?: string }) {
  const { initials, hash } = monogram(name);
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-night ${className}`}
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-full bg-night p-1 ring-1 ring-line">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-full px-3.5 py-1 text-xs font-bold transition-colors ${
            value === o ? "bg-raised text-ink shadow" : "text-mute hover:text-ink"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-night px-3.5 py-2.5 text-base text-ink sm:text-sm placeholder:text-faint focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-mute">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

/** A pill switch in place of a bare checkbox. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-raised ring-1 ring-line transition-colors peer-checked:bg-mint peer-focus-visible:ring-2 peer-focus-visible:ring-mint after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-ink after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}

/**
 * A name with a pencil; tapping it swaps in a field with Save / Cancel.
 * onSave gets the trimmed value and throws to show an error.
 */
export function InlineEdit({ value, label, maxLength, placeholder, validate, onSave, children }: {
  value: string;
  /** What's being edited, for the pencil's accessible name ("league name"). */
  label: string;
  maxLength: number;
  placeholder?: string;
  /** Returns an error message, or null when the value is fine. */
  validate?: (v: string) => string | null;
  onSave: (v: string) => Promise<unknown>;
  /** The read-only view; defaults to the value. */
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const v = draft.trim();
    if (v === value) return setEditing(false);
    const problem = validate?.(v) ?? null;
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await onSave(v);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="group flex min-w-0 max-w-full items-center gap-2 text-left"
        onClick={() => {
          setDraft(value);
          setError(null);
          setEditing(true);
        }}
        aria-label={`Edit ${label}`}
      >
        <span className="min-w-0 truncate">{children ?? (value || <span className="text-mute">{placeholder}</span>)}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-mint" aria-hidden>
          <path d="M13.6 2.9a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8l-9.4 9.4-3.9 1 1-3.9 9.4-9.4Z" />
        </svg>
      </button>
    );
  }

  return (
    <form onSubmit={save} className="w-full">
      {/* Phones: the field gets its own full-width line, buttons underneath. */}
      <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
        <input
          autoFocus
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={label}
          className={`${inputClass} basis-full py-2 sm:basis-auto`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        />
        <Button type="submit" size="sm" busy={busy}>Save</Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
      {error && <p className="mt-1.5 text-xs font-semibold text-rose">{error}</p>}
    </form>
  );
}
