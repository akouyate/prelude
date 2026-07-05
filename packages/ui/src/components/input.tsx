import * as React from "react";
import { Input as BaseInput } from "@base-ui-components/react/input";

import { cn } from "../lib/cn";

export type InputProps = React.ComponentProps<typeof BaseInput>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseInput
        ref={ref}
        className={cn(
          "h-12 w-full rounded-2xl border border-ink-200 bg-white/86 px-4 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-ink-800 focus:ring-2 focus:ring-[#e5e8d6]",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
