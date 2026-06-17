import * as React from "react";

import { cn } from "../lib/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-md border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none transition focus:border-meadow-500 focus:ring-2 focus:ring-meadow-200",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
