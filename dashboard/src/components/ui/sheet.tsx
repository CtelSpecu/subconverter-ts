import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

const SheetContext = React.createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);

export function Sheet({ open: controlledOpen, onOpenChange, children }: SheetProps) {
  const [internal, setInternal] = React.useState(false);
  const open = controlledOpen ?? internal;
  const setOpen = (v: boolean) => {
    if (controlledOpen === undefined) setInternal(v);
    onOpenChange?.(v);
  };
  return <SheetContext.Provider value={{ open, setOpen }}>{children}</SheetContext.Provider>;
}

export function SheetTrigger({ children, asChild: _asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const ctx = React.useContext(SheetContext);
  return (
    <button type="button" onClick={() => ctx?.setOpen(true)} {...props}>
      {children}
    </button>
  );
}

export function SheetContent({ children, className, side = "right" }: React.HTMLAttributes<HTMLDivElement> & { side?: "right" | "left" | "top" | "bottom" }) {
  const ctx = React.useContext(SheetContext);
  if (!ctx?.open) return null;
  const sideClasses =
    side === "right"
      ? "right-0 top-0 h-full w-full max-w-md border-l"
      : side === "left"
        ? "left-0 top-0 h-full w-full max-w-md border-r"
        : side === "top"
          ? "left-0 top-0 w-full border-b"
          : "left-0 bottom-0 w-full border-t";
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/30" onClick={() => ctx.setOpen(false)} aria-hidden />
      <div className={cn("relative ml-auto flex flex-col bg-white shadow-lg", "rounded-l-[8px]", sideClasses, className)}>
        <button
          type="button"
          onClick={() => ctx.setOpen(false)}
          className="absolute right-3 top-3 rounded-[8px] p-1.5 text-[rgb(0_0_0/44%)] hover:bg-[rgb(0_0_0/5%)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 space-y-1 pr-8", className)} {...props} />;
}
export function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold leading-none", className)} {...props} />;
}
export function SheetDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-[rgb(0_0_0/44%)]", className)} {...props} />;
}
export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}
export function SheetClose({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = React.useContext(SheetContext);
  return (
    <button type="button" onClick={() => ctx?.setOpen(false)} {...props}>
      {children}
    </button>
  );
}
