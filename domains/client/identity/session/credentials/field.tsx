// Form pieces shared by sign-in and registration.
// Module map:
//   Field        an input with a leading icon
//   FieldError   a field's validation message
//   ErrorBanner  the form-level error box

import type { ComponentType, InputHTMLAttributes } from "react";
import { AlertCircle } from "lucide-react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  icon: ComponentType<{ size?: number; className?: string }>;
};

export function Field({ icon: Icon, className: _className, ...props }: FieldProps) {
  return (
    <div className="relative">
      <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} />
      <input
        className="focus-ring w-full rounded-lg border border-border bg-elevated py-3 pl-10 pr-4 text-ink placeholder:text-muted transition-all duration-300 focus:border-accent/50 focus:bg-elevated"
        {...props}
      />
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-accent">{message}</p> : null;
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs text-accent">
      <AlertCircle className="mt-0.5 flex-none" size={14} />
      {message}
    </div>
  );
}
