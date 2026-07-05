import * as React from "react";
import { Button as BaseButton } from "@base-ui-components/react/button";

import { cn } from "../lib/cn";

type IconButtonVariant = "dark" | "ghost" | "secondary";
type IconButtonSize = "sm" | "md" | "lg";

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  focusableWhenDisabled?: boolean;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
};

const variantClasses: Record<IconButtonVariant, string> = {
  dark: "border-ink-900 bg-ink-900 text-white hover:bg-ink-800",
  ghost:
    "border-transparent bg-transparent text-ink-500 hover:bg-white/70 hover:text-ink-950",
  secondary:
    "border-ink-100 bg-white text-ink-600 hover:border-ink-900 hover:text-ink-950",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-[30px] w-[30px] rounded-[10px]",
  md: "h-9 w-9 rounded-[12px]",
  lg: "h-11 w-11 rounded-full",
};

export const IconButton = React.forwardRef<HTMLElement, IconButtonProps>(
  (
    {
      children,
      className,
      size = "md",
      type = "button",
      variant = "secondary",
      ...props
    },
    ref,
  ) => {
    return (
      <BaseButton
        nativeButton
        ref={ref}
        type={type}
        className={cn(
          "inline-grid shrink-0 cursor-pointer place-items-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {children}
      </BaseButton>
    );
  },
);

IconButton.displayName = "IconButton";
