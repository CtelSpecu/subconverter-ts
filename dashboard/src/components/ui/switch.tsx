import * as React from "react";
import { cn } from "@/lib/utils";

export type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
};

export function Switch({ checked, onCheckedChange, disabled, id, "aria-label": ariaLabel }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      id={id}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed",
        checked ? "bg-zinc-900 border-zinc-900" : "bg-white border-[rgb(0_0_0/18%)]",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-4 bg-white" : "translate-x-0.5 bg-zinc-900",
        )}
        style={{ background: checked ? "#fff" : "#fff", border: checked ? "none" : "1px solid rgb(0 0 0 / 10%)" }}
      />
    </button>
  );
}
