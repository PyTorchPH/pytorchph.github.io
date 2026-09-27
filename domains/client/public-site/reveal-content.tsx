"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const timer = window.setTimeout(() => setShown(true), delay);
          observer.disconnect();
          return () => window.clearTimeout(timer);
        }
        return undefined;
      },
      { threshold: 0.15 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      className={cn("transition-all duration-700", shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0", className)}
      ref={ref}
    >
      {children}
    </div>
  );
}
