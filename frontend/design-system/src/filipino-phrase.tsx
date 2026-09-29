import { cn } from "@pytorch-ph/design-system/merge-classes";

// A short Filipino phrase with its meaning. The phrase is marked lang="fil" so screen readers
// pronounce it correctly, and the meaning is always visible for people new to the language.
export function FilipinoPhrase({ phrase, meaning, className }: { phrase: string; meaning: string; className?: string }) {
  return (
    <p className={cn("text-sm", className)}>
      <span className="font-heading font-semibold tracking-wide text-accent" lang="fil">{phrase}</span>
      <span className="text-muted"> · {meaning}</span>
    </p>
  );
}
