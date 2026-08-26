import * as React from "react";
import { cn } from "@/lib/utils";

type TabsProps = {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
};

type TabsContextType = { value: string; onValueChange: (v: string) => void };
const TabsContext = React.createContext<TabsContextType | null>(null);

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn("", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex gap-6 border-b", className)} {...props} />;
}

export function TabsTrigger({ value, children, disabled }: { value: string; children: React.ReactNode; disabled?: boolean }) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("TabsTrigger outside Tabs");
  const active = ctx.value === value;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && ctx.onValueChange(value)}
      className={cn(
        "h-9 border-b-2 px-1 text-sm -mb-px transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        active ? "border-zinc-900 font-medium text-zinc-900" : "border-transparent text-[rgb(0_0_0/44%)] hover:text-[rgb(0_0_0/64%)]",
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("TabsContent outside Tabs");
  if (ctx.value !== value) return null;
  return <div className={cn("pt-4", className)}>{children}</div>;
}
