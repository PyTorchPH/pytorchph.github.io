"use client";

// Small labelled inputs shared by the profile form sections.
// Module map:
//   FormSection       titled block with an optional hint
//   OptionSelect      <select> fed by reference options ({code, label})
//   TextField         labelled text/number input
//   useReferenceSearch  multi-keyword search (schools, companies): local narrowing, else debounced request

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, Label } from "@pytorch-ph/design-system/input";
import type { ProfileOption } from "@pytorch-ph/domain-protocol/identity";
import { narrowFromSnapshot, type SearchSnapshot } from "../search-refinement";

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

type ReferenceSearch<T> = { search: (query: string) => Promise<T[]>; limit: number; wordsOf: (item: T) => string };

// Mental model: while the member only adds or extends words, a complete earlier answer is narrowed
// locally at once; otherwise the request fires once typing pauses (see search-refinement.ts).
export function useReferenceSearch<T>(key: string, query: string, { search, limit, wordsOf }: ReferenceSearch<T>) {
  const text = query.trim();
  const snapshot = useRef<SearchSnapshot<T> | null>(null);
  const narrowed = narrowFromSnapshot(snapshot.current, text, wordsOf);
  const debounced = useDebouncedValue(text, SEARCH_DEBOUNCE_MS);
  const result = useQuery({
    queryKey: ["reference", key, debounced],
    queryFn: async () => {
      const items = await search(debounced);
      snapshot.current = { query: debounced, items, complete: items.length < limit };
      return items;
    },
    enabled: debounced.length > 0 && narrowed === null,
  });
  if (narrowed) return { items: narrowed, loading: false, failed: false };
  return { items: result.data ?? [], loading: result.isFetching || debounced !== text, failed: result.isError };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
