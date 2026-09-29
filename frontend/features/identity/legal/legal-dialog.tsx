"use client";

// Inline "Terms and Conditions" / "Privacy Notice" hyperlinks that open the document in a modal,
// the way most sign-up forms do.
// Module map (caller-first):
//   LegalLink          the hyperlink; owns whether its dialog is open
//   └─ LegalDialog     the document in an AppDialog, with Close and an optional "I agree"
//       └─ LegalBody   updated date and numbered sections

import { useState, type MouseEvent } from "react";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import { LEGAL_DOCUMENTS, type LegalDocument, type LegalDocumentKey } from "./documents";

type LegalLinkProps = { document: LegalDocumentKey; onAgree?: () => void };

export function LegalLink({ document, onAgree }: LegalLinkProps) {
  const [open, setOpen] = useState(false);
  const legal = LEGAL_DOCUMENTS[document];
  return <>
    <button className="focus-ring rounded-sm text-accent underline underline-offset-2 hover:text-ink" onClick={(event) => openWithoutToggling(event, setOpen)} type="button">{legal.title}</button>
    {open && <LegalDialog legal={legal} onAgree={onAgree && (() => { onAgree(); setOpen(false); })} onClose={() => setOpen(false)} />}
  </>;
}

// The link sits inside the checkbox label; opening the document must not tick the box.
function openWithoutToggling(event: MouseEvent, setOpen: (open: boolean) => void) {
  event.preventDefault();
  setOpen(true);
}

function LegalDialog({ legal, onAgree, onClose }: { legal: LegalDocument; onAgree?: () => void; onClose: () => void }) {
  return <AppDialog description={legal.summary} onClose={onClose} title={legal.title}>
    <LegalBody legal={legal} />
    <footer className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex justify-end gap-2 border-t border-border bg-surface/95 px-5 py-3 backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6">
      <button className="focus-ring rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:border-accent" onClick={onClose} type="button">Close</button>
      {onAgree && <button className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white" onClick={onAgree} type="button">I agree</button>}
    </footer>
  </AppDialog>;
}

function LegalBody({ legal }: { legal: LegalDocument }) {
  return <article className="space-y-5 text-sm leading-6">
    <p className="text-xs text-muted">Last updated {legal.updated}</p>
    {legal.sections.map((section) => <section key={section.heading}>
      <h3 className="font-semibold text-ink">{section.heading}</h3>
      {section.paragraphs.map((paragraph) => <p className="mt-1 text-muted" key={paragraph}>{paragraph}</p>)}
    </section>)}
  </article>;
}
