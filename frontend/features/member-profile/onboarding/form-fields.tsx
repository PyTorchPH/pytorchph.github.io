"use client";

// Small labelled inputs shared by the profile form sections.
// Module map:
//   FormSection       titled block with an optional hint
//   OptionSelect      <select> fed by reference options ({code, label})
//   TextField         labelled text/number input
//   useReferenceSearch  debounced search against a reference list (schools, companies)

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, Label } from "@pytorch-ph/design-system/input";
import type { ProfileOption } from "@pytorch-ph/domain-protocol/identity";

const SEARCH_DEBOUNCE_MS = 250;

export function FormSection({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return <section className="space-y-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
    <div className="flex items-center gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint}
    </div>
    {children}
  </section>;
}

type OptionSelectProps = { id: string; label: string; value: string; options: ProfileOption[]; onChange: (code: string) => void };

export function OptionSelect({ id, label, value, options, onChange }: OptionSelectProps) {
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <select className="focus-ring h-11 w-full border border-ink/40 bg-elevated px-3 text-sm text-ink" id={id} onChange={(event) => onChange(event.target.value)} required value={value}>
      <option disabled value="">Choose…</option>
      {options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
    </select>
  </div>;
}

type TextFieldProps = { id: string; label: string; value: string; onChange: (value: string) => void; type?: "text" | "number"; maxLength?: number; min?: number; max?: number; placeholder?: string };

export function TextField({ id, label, value, onChange, type = "text", ...rest }: TextFieldProps) {
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} onChange={(event) => onChange(event.target.value)} required type={type} value={value} {...rest} />
  </div>;
}

// Mental model: the query text updates on every keystroke; the request only fires once typing pauses.
export function useReferenceSearch<T>(key: string, query: string, search: (query: string) => Promise<T[]>) {
  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const result = useQuery({ queryKey: ["reference", key, debounced], queryFn: () => search(debounced), enabled: debounced.length > 0 });
  return { items: result.data ?? [], loading: result.isFetching || debounced !== query.trim(), failed: result.isError };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
