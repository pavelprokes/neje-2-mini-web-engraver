'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';

interface RangeFieldProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  /** Visible and announced value, e.g. "80 %". */
  readonly display: string;
  readonly onChange: (value: number) => void;
  readonly disabled?: boolean;
}

export function RangeField({ label, value, min, max, step = 1, display, onChange, disabled }: RangeFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
      />
      <output htmlFor={id} aria-hidden="true">
        {display}
      </output>
    </div>
  );
}

interface NumberFieldProps {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly onChange?: (value: number) => void;
  readonly readOnly?: boolean;
  readonly describedBy?: string;
}

/**
 * Number input that lets people type freely (e.g. clear the field) and only commits valid,
 * in-range numbers. External value changes are reflected while the field is not being edited.
 */
export function NumberField({ label, value, min, max, step = 0.5, onChange, readOnly, describedBy }: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);

  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    onChange?.(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
  };

  return (
    <div className="field wide">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={shown}
        readOnly={readOnly}
        aria-describedby={describedBy}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          commit(e.currentTarget.value);
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly describedBy?: string;
}

export function SelectField<T extends string>({ label, value, options, onChange, describedBy }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <div className="field wide">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} aria-describedby={describedBy} onChange={(e) => onChange(e.currentTarget.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CheckboxField({ label, checked, onChange }: { readonly label: ReactNode; readonly checked: boolean; readonly onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="check">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId();
  return (
    <section className="panel" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

/** Calls `fn` after `value` stopped changing for `ms`. */
export function useDebouncedEffect<T>(value: T, ms: number, fn: (value: T) => void) {
  useEffect(() => {
    const timer = setTimeout(() => fn(value), ms);
    return () => clearTimeout(timer);
    // fn is intentionally excluded: callers pass inline closures
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms]);
}
