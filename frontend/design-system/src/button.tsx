import type { ButtonHTMLAttributes } from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export const buttonVariants = cva(
  "focus-ring inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-onAccent hover:bg-accent/90 active:bg-accent/80",
        primary: "bg-accent text-onAccent hover:bg-accent/90 active:bg-accent/80",
        secondary: "border border-ink/70 bg-elevated text-ink hover:border-accent hover:text-accent",
        outline: "border border-ink/70 bg-transparent text-ink hover:border-accent hover:text-accent",
        ghost: "text-muted hover:bg-elevated hover:text-ink",
        destructive: "bg-danger text-white hover:bg-danger/90",
        danger: "bg-danger text-white hover:bg-danger/90",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        default: "h-10 px-4 text-sm",
        lg: "h-11 px-5 text-base",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ asChild = false, className, variant, size, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
