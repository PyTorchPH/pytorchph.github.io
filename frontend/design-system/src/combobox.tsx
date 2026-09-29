"use client";

// A searchable single-choice input (WAI-ARIA combobox with a listbox popup).
// Module map (caller-first):
//   Combobox              text input + popup list; the caller owns searching and the chosen value
//   ├─ useActiveOption    which option the arrow keys point at
//   ├─ handleKey          ArrowUp/ArrowDown move, Enter picks, Escape closes
//   └─ OptionList         the popup listbox
//   optionId / isOpenable naming helpers

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export type ComboboxOption = { value: string; label: string; detail?: string };

type ComboboxProps = {
  id: string;
  label: string;
  query: string;
  onQueryChange: (query: string) => void;
  options: ComboboxOption[];
  onSelect: (option: ComboboxOption) => void;
  placeholder?: string;
  loading?: boolean;
  emptyText?: string;
  footer?: ReactNode;
  required?: boolean;
};

// Mental model: typing updates the caller's query; the caller refreshes options; the popup shows
// them and the keyboard walks the list without moving focus off the input.
export function Combobox({ id, label, query, onQueryChange, options, onSelect, placeholder, loading = false, emptyText = "No matches", footer, required }: ComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useActiveOption(options.length);
  const pick = (option: ComboboxOption) => { onSelect(option); setOpen(false); };
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((active + 1) % Math.max(options.length, 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive((active - 1 + options.length) % Math.max(options.length, 1)); }
    else if (event.key === "Enter" && open && options[active]) { event.preventDefault(); pick(options[active]); }
    else if (event.key === "Escape") { setOpen(false); }
  };
  return <div className="relative">
    <input
      aria-activedescendant={open && options[active] ? optionId(listId, active) : undefined}
      aria-autocomplete="list"
      aria-controls={listId}
      aria-expanded={open}
      aria-label={label}
      autoComplete="off"
      className="focus-ring h-11 w-full border border-ink/40 bg-elevated px-3 text-sm text-ink placeholder:text-muted"
      id={id}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      onChange={(event) => { onQueryChange(event.target.value); setOpen(isOpenable(event.target.value)); setActive(0); }}
      onFocus={() => setOpen(isOpenable(query))}
      onKeyDown={handleKey}
      placeholder={placeholder}
      required={required}
      role="combobox"
      value={query}
    />
    {open && <OptionList active={active} emptyText={emptyText} footer={footer} listId={listId} loading={loading} onHover={setActive} onPick={pick} options={options} />}
  </div>;
}

function useActiveOption(count: number): [number, (index: number) => void] {
  const [active, setActive] = useState(0);
  return [Math.min(active, Math.max(count - 1, 0)), setActive];
}

type OptionListProps = { listId: string; options: ComboboxOption[]; active: number; loading: boolean; emptyText: string; footer?: ReactNode; onHover: (index: number) => void; onPick: (option: ComboboxOption) => void };

function OptionList({ listId, options, active, loading, emptyText, footer, onHover, onPick }: OptionListProps) {
  return <div className="absolute z-30 mt-1 w-full border border-border bg-surface shadow-xl">
    <ul className="max-h-64 overflow-y-auto py-1" id={listId} role="listbox">
      {options.map((option, index) => <li
        aria-selected={index === active}
        className={cn("cursor-pointer px-3 py-2 text-sm", index === active ? "bg-accentSoft text-accent" : "text-ink")}
        id={optionId(listId, index)}
        key={option.value}
        onMouseDown={(event) => { event.preventDefault(); onPick(option); }}
        onMouseEnter={() => onHover(index)}
        role="option"
      >
        <span className="block">{option.label}</span>
        {option.detail && <span className="block text-xs text-muted">{option.detail}</span>}
      </li>)}
      {!options.length && <li className="px-3 py-2 text-sm text-muted" role="presentation">{loading ? "Searching…" : emptyText}</li>}
    </ul>
    {footer && <div className="border-t border-border p-2" onMouseDown={(event) => event.preventDefault()}>{footer}</div>}
  </div>;
}

const optionId = (listId: string, index: number) => `${listId}-option-${index}`;

const isOpenable = (query: string) => query.trim().length > 0;
