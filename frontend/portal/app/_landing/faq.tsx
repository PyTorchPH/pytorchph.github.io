"use client";

// Accordion of frequently asked questions; one answer open at a time.
// Module map (caller-first):
//   FaqSection  heading plus the accordion items
//   FaqItem     one question with its collapsible answer

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Reveal } from "@pytorch-ph/domain-client/public-site";
import { faq } from "./content";

const NONE_OPEN = -1;
const REVEAL_STEP_MS = 60;

// Mental model: the open index is the only state; clicking the open question closes it.
export function FaqSection() {
  const [open, setOpen] = useState(0);
  const toggle = (index: number) => setOpen(open === index ? NONE_OPEN : index);

  return (
    <section className="relative border-t border-border bg-canvas py-32" id="faq">
      <div className="mx-auto max-w-3xl px-6">
        <Reveal>
          <div className="mb-12 text-center">
            <div className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">FAQ</div>
            <h2 className="text-4xl font-bold tracking-[-0.02em] text-ink">Frequently asked.</h2>
          </div>
        </Reveal>
        <div className="space-y-2">
          {faq.map((item, index) => (
            <Reveal delay={index * REVEAL_STEP_MS} key={item.q}>
              <FaqItem answer={item.a} isOpen={open === index} onToggle={() => toggle(index)} question={item.q} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqItem({ question, answer, isOpen, onToggle }: { question: string; answer: string; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-elevated">
      <button
        className="focus-ring flex w-full items-center justify-between p-5 text-left text-ink transition-all duration-300 hover:bg-elevated"
        onClick={onToggle}
        type="button"
      >
        <span>{question}</span>
        <ChevronDown className={`text-accent transition ${isOpen ? "rotate-180" : ""}`} size={18} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ${isOpen ? "max-h-40" : "max-h-0"}`}>
        <div className="px-5 pb-5 text-sm leading-7 text-muted">{answer}</div>
      </div>
    </div>
  );
}
