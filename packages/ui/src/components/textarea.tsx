import * as React from "react";

import { cn } from "../lib/cn";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-28 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-ink-800 focus:ring-2 focus:ring-ink-200",
          className
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";
