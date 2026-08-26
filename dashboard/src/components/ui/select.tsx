import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  onValueChange?: (value: string) => void;
};

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, onValueChange, onChange, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "flex h-9 w-full appearance-none rounded-[8px] border bg-white px-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:opacity-50",
            className,
          )}
          onChange={(e) => {
            onChange?.(e);
            onValueChange?.(e.target.value);
          }}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(0_0_0/44%)]" />
      </div>
    );
  },
);
Select.displayName = "Select";
const SelectItem = React.forwardRef<
  HTMLOptionElement,
  React.OptionHTMLAttributes<HTMLOptionElement>
>(({ className, children, ...props }, ref) => (
  <option ref={ref as React.Ref<HTMLOptionElement>} className={cn("", className)} {...props}>
    {children}
  </option>
));
SelectItem.displayName = "SelectItem";

// shadcn compatibility shims for compositional usage
export function SelectTrigger({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(className)} {...props}>{children}</div>;
}
export function SelectValue(props: React.HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} />;
}
export function SelectContent({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
export function SelectGroup(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
export function SelectLabel(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
export function SelectSeparator() {
  return null;
}

export { Select, SelectItem };
