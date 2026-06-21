import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui-components/react/switch";

import { cn } from "../lib/cn";

export type SwitchProps = React.ComponentProps<typeof BaseSwitch.Root>;

export const Switch = React.forwardRef<HTMLElement, SwitchProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseSwitch.Root
        ref={ref}
        className={cn(
          "relative inline-flex h-[26px] w-[46px] cursor-pointer rounded-full bg-ink-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 data-[checked]:bg-olive-700 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
          className,
        )}
        {...props}
      >
        <BaseSwitch.Thumb className="absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white transition-transform data-[checked]:translate-x-5" />
      </BaseSwitch.Root>
    );
  },
);

Switch.displayName = "Switch";
