import * as React from "react";
import { cn } from "@/lib/utils";

interface CollapsibleProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

const CollapsibleContext = React.createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);

export function Collapsible({ open: controlled, defaultOpen, onOpenChange, children, className }: CollapsibleProps) {
  const [internal, setInternal] = React.useState(defaultOpen ?? false);
  const open = controlled ?? internal;
  const setOpen = (v: boolean) => {
    if (controlled === undefined) setInternal(v);
    onOpenChange?.(v);
  };
  return (
    <CollapsibleContext.Provider value={{ open, setOpen }}>
      <div className={cn(className)}>{children}</div>
    </CollapsibleContext.Provider>
  );
}

export function CollapsibleTrigger({ children, asChild: _asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const ctx = React.useContext(CollapsibleContext);
  if (!ctx) return <button {...props}>{children}</button>;
  return (
    <button type="button" onClick={() => ctx.setOpen(!ctx.open)} aria-expanded={ctx.open} {...props}>
      {children}
    </button>
  );
}

export function CollapsibleContent({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const ctx = React.useContext(CollapsibleContext);
  if (!ctx?.open) return null;
  return (
    <div className={cn(className)} {...props}>
      {children}
    </div>
  );
}
