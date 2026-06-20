import * as React from "react";
import { Button as BaseButton } from "@base-ui-components/react/button";

import { cn } from "../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  focusableWhenDisabled?: boolean;
  variant?: ButtonVariant;
};

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink-900 text-white hover:bg-ink-800",
  secondary:
    "border border-ink-200 bg-white/80 text-ink-900 hover:border-ink-900 hover:bg-white",
  ghost: "text-ink-800 hover:bg-[#eef0e3]"
};

export const Button = React.forwardRef<HTMLElement, ButtonProps>(
  ({ className, variant = "primary", type = "button", ...props }, ref) => {
    return (
      <BaseButton
        nativeButton
        ref={ref}
        type={type}
        className={cn(
          "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
