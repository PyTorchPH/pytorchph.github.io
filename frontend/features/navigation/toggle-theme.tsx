"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@pytorch-ph/design-system/button";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <Button
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setDark((value) => !value)}
      size="icon"
      type="button"
      variant="secondary"
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </Button>
  );
}
