import { useId, useState } from "react";

/**
 * 1-5 stars as a real radio group, so arrow keys, Tab and screen readers work out of the box.
 * Picking the current rating again clears it.
 */
export function StarRating({ value, onChange, disabled, label }: {
  value: number | null;
  onChange: (stars: number | null) => void;
  disabled?: boolean;
  /** What's being rated, for the group's accessible name. */
  label: string;
}) {
  const name = useId();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  return (
    <fieldset className="flex items-center" disabled={disabled} onMouseLeave={() => setHover(null)}>
      <legend className="sr-only">{label}</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label
          key={n}
          className="cursor-pointer p-0.5 has-[:focus-visible]:rounded has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-mint"
          onMouseEnter={() => setHover(n)}
        >
          <input
            type="radio"
            name={name}
            value={n}
            className="sr-only"
            checked={value === n}
            onChange={() => onChange(n)}
            onClick={() => value === n && onChange(null)}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
          />
          <svg viewBox="0 0 20 20" className={`h-6 w-6 transition-colors ${n <= shown ? "text-gold" : "text-line"}`} fill="currentColor" aria-hidden>
            <path d="M10 1.8l2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.7l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7L10 1.8z" />
          </svg>
        </label>
      ))}
    </fieldset>
  );
}
