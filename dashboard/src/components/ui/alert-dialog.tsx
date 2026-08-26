import * as React from "react";
import { cn } from "@/lib/utils";

interface AlertDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

const AlertDialogContext = React.createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);

export function AlertDialog({ open: controlledOpen, onOpenChange, children }: AlertDialogProps) {
  const [internal, setInternal] = React.useState(false);
  const open = controlledOpen ?? internal;
  const setOpen = (v: boolean) => {
    if (controlledOpen === undefined) setInternal(v);
    onOpenChange?.(v);
  };
  return <AlertDialogContext.Provider value={{ open, setOpen }}>{children}</AlertDialogContext.Provider>;
}

export function AlertDialogTrigger({ children, asChild: _asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const ctx = React.useContext(AlertDialogContext);
  return (
    <button type="button" onClick={() => ctx?.setOpen(true)} {...props}>
      {children}
    </button>
  );
}

export function AlertDialogContent({ children, className }: React.HTMLAttributes<HTMLDivElement>) {
  const ctx = React.useContext(AlertDialogContext);
  if (!ctx?.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => ctx.setOpen(false)} aria-hidden />
      <div className={cn("relative w-full max-w-md rounded-[8px] border bg-white p-6 shadow-lg", className)} role="alertdialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 space-y-1.5", className)} {...props} />;
}
export function AlertDialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold", className)} {...props} />;
}
export function AlertDialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs leading-relaxed text-[rgb(0_0_0/64%)]", className)} {...props} />;
}
export function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}
export function AlertDialogCancel({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = React.useContext(AlertDialogContext);
  return (
    <button
      type="button"
      onClick={() => ctx?.setOpen(false)}
      className={cn("h-9 rounded-[8px] border bg-white px-4 text-sm font-medium hover:bg-[rgb(0_0_0/5%)]", className)}
      {...props}
    >
      {children}
    </button>
  );
}
export function AlertDialogAction({ children, className, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = React.useContext(AlertDialogContext);
  return (
    <button
      type="button"
      onClick={(e) => {
        onClick?.(e);
        ctx?.setOpen(false);
      }}
      className={cn("h-9 rounded-[8px] bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800", className)}
      {...props}
    >
      {children}
    </button>
  );
}
