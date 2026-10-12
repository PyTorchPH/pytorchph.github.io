"use client";
import { useId } from "react";
import { labels, options, type ContentRow } from "./model";

// Labels are separate from textarea contents so accessible names never include the saved value.
export function ContentFields({ row, onChange }: { row: ContentRow; onChange: (key: string, value: string) => void }) {
  const prefix = useId();
  return <div className="grid gap-3 md:grid-cols-2">{Object.entries(row).filter(([key]) => key !== "id").map(([key, value]) => {
    const id = `${prefix}-${key}`;
    return <div key={key} className="text-sm font-medium"><label htmlFor={id}>{labels[key] ?? key}</label>{options[key] ? <select id={id} value={value} onChange={event => onChange(key, event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-surface p-2">{options[key].map(option => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select> : <textarea id={id} rows={key==="text" || key==="description" || key==="highlights" ? 4 : 2} value={value} onChange={event => onChange(key, event.target.value)} maxLength={8000} className="mt-1 w-full rounded-lg border border-border bg-surface p-2" />}</div>;
  })}</div>;
}
