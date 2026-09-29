"use client";

// Rotating community quotes with manual dot navigation.
// Module map (caller-first):
//   Testimonials      stacked quotes, one visible at a time, plus the dots
//   useRotatingIndex  advances the visible quote on a timer

import { useEffect, useState } from "react";
import { Quote } from "lucide-react";
import { testimonials } from "./content";

const ROTATE_EVERY_MS = 5000;

// Mental model: every quote is rendered; only the active one is visible, and the timer or a dot changes which.
export function Testimonials() {
  const [index, setIndex] = useRotatingIndex(testimonials.length);

  return (
    <section className="relative border-t border-border bg-canvas py-32" id="voices">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <div className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">voices from the community</div>
        <Quote className="mx-auto mb-6 text-accent/30" size={48} />
        <div className="relative h-56">
          {testimonials.map((item, itemIndex) => (
            <div className={`absolute inset-0 transition-all duration-700 ${index === itemIndex ? "opacity-100" : "translate-y-4 opacity-0"}`} key={item.name}>
              <p className="text-2xl italic leading-relaxed text-ink">"{item.quote}"</p>
              <div className="mt-6 text-ink">{item.name}</div>
              <div className="font-mono text-sm text-muted">{item.role}</div>
            </div>
          ))}
        </div>
        <div className="mt-8 flex justify-center gap-2">
          {testimonials.map((item, itemIndex) => (
            <button
              aria-label={`Show ${item.name} testimonial`}
              className={`h-1.5 rounded-full transition-all ${index === itemIndex ? "w-8 bg-accent" : "w-1.5 bg-elevated"}`}
              key={item.name}
              onClick={() => setIndex(itemIndex)}
              type="button"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function useRotatingIndex(length: number) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setIndex((value) => (value + 1) % length), ROTATE_EVERY_MS);
    return () => window.clearInterval(id);
  }, [length]);
  return [index, setIndex] as const;
}
