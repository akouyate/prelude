import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "./toast-provider";

// Nothing in this file's vitest config registers RTL's auto-cleanup (that
// needs `test.globals: true`, which this package doesn't set), so without
// this, `render()`'s mounted tree — including `ToastProvider`'s portal
// content, which lives outside the per-test container div — survives past
// the end of a test and leaks into the next one's DOM. Discovered while
// writing the settle-identity tests below: a prior test's still-mounted
// toast was silently satisfying a later test's `queryAllByText` assertion.
afterEach(cleanup);

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

/**
 * Wave 2 review finding: `toast` is now referentially stable (above), which
 * fixes the infinite loop, but it does not fix every way a consumer's
 * "announce this outcome once" effect can re-fire. A real call site
 * (`candidate-invitations-panel.tsx`) announces a `useActionState` settle —
 * `if (result.ok) toast({ message: t(key), ... })` — with `t` from
 * react-i18next in the dependency array because the message is translated.
 * `t`'s identity is NOT stable across a language switch, so with a naive
 * `[result, t, toast]` dependency array and no other guard, switching locale
 * while `result.ok` is still `true` (nothing else changed) re-runs the
 * effect and announces the SAME settle a second time.
 *
 * `packages/ui` has the working jsdom/RTL harness (`vitest.config.ts`'s
 * `environment: "jsdom"`, exercised above); `apps/console` has none. Rather
 * than adding jsdom there for one test, this reproduces the console call
 * site's exact shape here, against the real `ToastProvider`/`useToast`
 * exports, and pins the fix: dedupe on the SETTLE'S IDENTITY (a ref holding
 * the last settle object actually announced, compared by reference), which
 * is independent of whether any other dependency — `t`, or `toast` itself —
 * is stable.
 */
function AnnouncesSettleNaively({
  label,
  settle,
}: {
  label: string;
  settle: { ok: boolean };
}) {
  const { toast } = useToast();

  React.useEffect(() => {
    if (!settle.ok) {
      return;
    }
    toast({ dismissLabel: "Dismiss", message: label, tone: "success" });
    // Deliberately naive, matching the pre-fix call site: `settle.ok` stays
    // `true` forever once it flips, so anything else in this array changing
    // identity re-announces the same settle.
  }, [settle, label, toast]);

  return null;
}

function AnnouncesSettleOncePerIdentity({
  label,
  settle,
}: {
  label: string;
  settle: { ok: boolean };
}) {
  const { toast } = useToast();
  const announcedRef = React.useRef<typeof settle | null>(null);

  React.useEffect(() => {
    if (!settle.ok || announcedRef.current === settle) {
      return;
    }
    announcedRef.current = settle;
    toast({ dismissLabel: "Dismiss", message: label, tone: "success" });
  }, [settle, label, toast]);

  return null;
}

describe("dedupe on settle identity, not on every dependency's stability", () => {
  it("RED: the naive `[settle, label, toast]` guard re-announces the same settle when `label` (standing in for `t`) changes identity", async () => {
    const settle = { ok: true };
    const { rerender } = render(
      <ToastProvider>
        <AnnouncesSettleNaively label="Invited" settle={settle} />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Invited")).toHaveLength(1);
    });

    // Simulate a locale switch: `label` changes while `settle` — the actual
    // outcome being announced — does not.
    rerender(
      <ToastProvider>
        <AnnouncesSettleNaively label="Invité" settle={settle} />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Invité")).toHaveLength(1);
    });
    // The bug: the SAME settle is now announced twice, once per wording.
    expect(screen.getAllByText("Invited")).toHaveLength(1);
  });

  it("GREEN: a ref keyed on the settle's identity announces exactly once per settle, including across a `label`/`t` identity change", async () => {
    const settle = { ok: true };
    const { rerender } = render(
      <ToastProvider>
        <AnnouncesSettleOncePerIdentity label="Invited" settle={settle} />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Invited")).toHaveLength(1);
    });

    // Same settle, `label` changes identity/value (locale switch): must NOT
    // re-announce.
    rerender(
      <ToastProvider>
        <AnnouncesSettleOncePerIdentity label="Invité" settle={settle} />
      </ToastProvider>,
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(screen.queryAllByText("Invité")).toHaveLength(0);
    expect(screen.getAllByText("Invited")).toHaveLength(1);

    // A genuinely new settle (e.g. a second successful submit) still
    // announces.
    const secondSettle = { ok: true };
    rerender(
      <ToastProvider>
        <AnnouncesSettleOncePerIdentity label="Invited" settle={secondSettle} />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(screen.getAllByText("Invited")).toHaveLength(2);
    });
  });

  // The guard writes its ref BEFORE calling `toast()`, which is what makes it
  // survive React's development double-invocation of effects. Next enables
  // StrictMode by default for the app router, so this is the mode the console
  // actually runs in — asserting it here turns that ordering from a reasoned
  // claim into a proven one. (The RED case above is deliberately NOT wrapped:
  // under StrictMode the naive pattern announces twice on mount alone, which
  // would document a different, larger bug than the one it exists to show.)
  it("announces once per settle even when StrictMode double-invokes the effect", async () => {
    const settle = { ok: true };
    render(
      <React.StrictMode>
        <ToastProvider>
          <AnnouncesSettleOncePerIdentity label="Invited" settle={settle} />
        </ToastProvider>
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Invited")).toHaveLength(1);
    });

    // `toast()` defers its `manager.add`, so a double-invoked effect would
    // land its second announcement a task later — wait past that before
    // asserting the count never grew.
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(screen.getAllByText("Invited")).toHaveLength(1);
  });
});
