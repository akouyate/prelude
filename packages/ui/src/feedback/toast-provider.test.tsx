import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "./toast-provider";

/**
 * Regression guard for the referential-instability bug: `toast`'s identity
 * used to be tied to Base UI's `manager`, and `manager` gets a brand-new
 * `toasts` array (hence a new `manager`, hence a new `toast`) on every
 * add/close/update ANYWHERE toasts are used. A consumer that legitimately
 * puts `toast` in an effect's dependency array — the normal shape for
 * "announce this outcome once" — had that effect re-run every time ANY toast
 * fired, including its own, forever: `toast()` changes `toast`'s identity,
 * which re-runs the effect, which calls `toast()` again.
 *
 * This test deliberately omits a ref-guard around the `toast()` call (unlike
 * the real call sites in the console app, which additionally guard
 * themselves) to prove the PROVIDER holds the line on its own — `toast` must
 * stay referentially stable across renders, not just "usually" stable.
 */
function FiresOnMount() {
  const { toast } = useToast();

  React.useEffect(() => {
    toast({ dismissLabel: "Dismiss", message: "Hello", tone: "success" });
    // `toast` is deliberately a dependency — this is exactly the shape that
    // used to loop.
  }, [toast]);

  return null;
}

describe("useToast referential stability", () => {
  it("does not loop when a consumer's effect depends on `toast`", async () => {
    render(
      <ToastProvider>
        <FiresOnMount />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Hello")).toHaveLength(1);
    });

    // `toast()` defers its actual `manager.add` call by a task; give a
    // runaway loop time to compound before asserting it never happened.
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    expect(screen.getAllByText("Hello")).toHaveLength(1);
  });
});
