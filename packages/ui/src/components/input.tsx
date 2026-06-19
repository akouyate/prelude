import * as React from "react";

import { cn } from "../lib/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-md border border-ink-200 bg-white/90 px-3 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-ink-700 focus:ring-2 focus:ring-ink-200/70",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
