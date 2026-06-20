import * as React from "react";

import { cn } from "../lib/cn";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-32 w-full rounded-2xl border border-ink-200 bg-white/86 px-4 py-3 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-ink-800 focus:ring-2 focus:ring-[#e5e8d6]",
          className
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";
