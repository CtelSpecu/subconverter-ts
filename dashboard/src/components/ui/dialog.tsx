import * as React from "react";
import { cn } from "@/lib/utils";

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode };

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-[rgb(0_0_0/40%)]" onClick={() => onOpenChange(false)} aria-hidden />
      <div className="relative z-10 w-full max-w-[480px] max-h-[90vh] overflow-auto rounded-[8px] border bg-white p-6 shadow-lg animate-[in_150ms_ease-out]">{children}</div>
    </div>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 pb-4", className)} {...props} />;
}
export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold", className)} {...props} />;
}
export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-[rgb(0_0_0/44%)]", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex justify-end gap-2 pt-4", className)} {...props} />;
}
export function DialogContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("", className)} {...props} />;
}
