"use client";

import { createContext, useContext, useId, type HTMLAttributes } from "react";
import { Controller, FormProvider, useFormContext, type ControllerProps, type FieldPath, type FieldValues } from "react-hook-form";
import { Slot } from "radix-ui";
import { cn } from "@pytorch-ph/design-system/merge-classes";
import { Label } from "./input";

const FieldContext = createContext<{ name: string }>({ name: "" });
const ItemContext = createContext<{ id: string }>({ id: "" });

export const Form = FormProvider;
export function FormField<TValues extends FieldValues, TName extends FieldPath<TValues>>(props: ControllerProps<TValues, TName>) {
  return <FieldContext.Provider value={{ name: props.name }}><Controller {...props} /></FieldContext.Provider>;
}
export function FormItem({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const id = useId();
  return <ItemContext.Provider value={{ id }}><div className={cn("space-y-2", className)} {...props} /></ItemContext.Provider>;
}
function useFormField() {
  const field = useContext(FieldContext);
  const item = useContext(ItemContext);
  const { getFieldState, formState } = useFormContext();
  return { ...getFieldState(field.name, formState), formDescriptionId: `${item.id}-description`, formItemId: `${item.id}-item`, formMessageId: `${item.id}-message` };
}
export function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const field = useFormField();
  return <Label className={cn(field.error && "text-danger", className)} htmlFor={field.formItemId} {...props} />;
}
export function FormControl({ children }: { children: React.ReactElement }) {
  const field = useFormField();
  return <Slot.Root aria-describedby={field.error ? `${field.formDescriptionId} ${field.formMessageId}` : field.formDescriptionId} aria-invalid={Boolean(field.error)} id={field.formItemId}>{children}</Slot.Root>;
}
export function FormDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const field = useFormField();
  return <p className={cn("text-xs text-muted", className)} id={field.formDescriptionId} {...props} />;
}
export function FormMessage({ className, children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const field = useFormField();
  const body = field.error ? String(field.error.message || "Invalid value") : children;
  if (!body) return null;
  return <p className={cn("text-xs font-medium text-danger", className)} id={field.formMessageId} {...props}>{body}</p>;
}
