"use client";

import * as React from "react";
import { Toast as BaseToast } from "@base-ui-components/react/toast";
import { Xmark } from "iconoir-react";

import { cn } from "../lib/cn";
import { Toast } from "./toast";

/**
 * A thin, styled orchestration layer around Base UI's headless `Toast`
 * primitive (already a dependency here — see `dialog.tsx`/`drawer.tsx` for
 * the same pattern) and this package's own `Toast` card. Base UI supplies the
 * mechanics that are easy to get subtly wrong by hand: the auto-dismiss timer
 * itself (paused on hover/focus/touch-swipe/window-blur for free), the
 * portal, and an ARIA live region that announces toasts to screen readers
 * independently of what is visually rendered. This file supplies almost none
 * of that logic itself — only the visual tones, the small `useToast()`
 * call-site ergonomics, and (in `ToastProvider`) one `window` blur/focus
 * listener pair that mirrors, for the countdown ring's CSS, a pause condition
 * Base UI's own `data-expanded` attribute doesn't cover — see
 * `CountdownClose`'s doc comment.
 */

export type ToastTone = "danger" | "info" | "success" | "warning";

// The countdown ring: an 18-20px circle, ~2px stroke, that depletes over the
// toast's own duration. Geometry is computed once, then handed to the SVG as
// `stroke-dasharray`/a `--toast-ring-circumference` custom property — see
// `apps/console/app/globals.css` for the `@keyframes` that actually animates
// `stroke-dashoffset` from there (packages/ui ships no CSS of its own; every
// consumer's Tailwind build supplies the utility classes already, so the one
// small animation this adds lives in the same place).
const RING_SIZE = 20;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Tone is carried by the ring's stroke colour, not the card background (the
// card stays the same dark surface for every tone — see `toast.tsx`). Each
// value is verified >4.5:1 against the `ink-900`-based surface (the AA floor
// for the description text is 4.5:1; these are graphical/UI elements, whose
// floor is 3:1, but the actual numbers clear both):
//   meadow-400 vs surface  6.36:1
//   coral-400  vs surface  5.28:1
//   gold-300   vs surface  9.73:1
//   ink-300    vs surface  8.58:1
// (computed against the worst case — the surface composited at its actual
// opacity over the app's cream background, not the solid ink-900 swatch).
const ringToneClasses: Record<ToastTone, string> = {
  danger: "stroke-coral-400",
  info: "stroke-ink-300",
  success: "stroke-meadow-400",
  warning: "stroke-gold-300",
};

export type ToastOptions = {
  tone?: ToastTone;
  message: React.ReactNode;
  /**
   * Milliseconds before the toast auto-dismisses. Omit for the ~6s default;
   * pass `null` for an outcome the reader must actually see, which then stays
   * until they dismiss it by hand.
   */
  duration?: number | null;
  /** Accessible label for the dismiss control. This package carries no i18n
   * of its own, so the caller supplies the translated string. */
  dismissLabel: string;
};

type ToastData = { dismissLabel: string };

const DEFAULT_DURATION_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  // Base UI's dismissal timer has a fourth pause condition beyond
  // hover/focus/touch-swipe: window blur. It pauses the REAL timer
  // (`toast/viewport/ToastViewport.js`'s `handleWindowBlur` calls
  // `pauseTimers()`), but does it via a native `blur` listener that never
  // touches `hovering`/`focused` — so `data-expanded` never appears for this
  // condition, and a ring driven only by `data-expanded` would keep sweeping
  // to empty while the real timer sits frozen. This effect closes that gap
  // the same way Base UI closes it for the timer itself: one listener pair,
  // added once here (not per toast, not per ring), toggling a single
  // document-level attribute that `apps/console/app/globals.css`'s countdown
  // rule also watches. `document.hidden`/`visibilitychange` would NOT catch
  // this — a window can lose OS focus (Alt-Tab) without the tab ever being
  // hidden, so this listens to `window`'s own `blur`/`focus`, not the
  // Document's visibility state.
  React.useEffect(() => {
    const root = document.documentElement;
    const onWindowBlur = () => root.setAttribute("data-toast-window-blurred", "");
    const onWindowFocus = () => root.removeAttribute("data-toast-window-blurred");
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      root.removeAttribute("data-toast-window-blurred");
    };
  }, []);

  return (
    <BaseToast.Provider timeout={DEFAULT_DURATION_MS}>
      {children}
      <BaseToast.Portal>
        {/*
          Bottom-center, floating, blurred card: the same idiom this codebase
          already uses for other transient/fixed overlays anchored to the
          viewport edge (see the candidate decision bar), and the shape the
          `Toast` primitive's own styling (rounded-2xl, dark translucent
          surface, backdrop-blur) reads as designed for — a floating card, not
          a persistent corner control.
        */}
        <BaseToast.Viewport className="fixed inset-x-0 bottom-6 z-[70] flex flex-col-reverse items-center gap-2 px-4 outline-none">
          <ToastStack />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastStack() {
  const { toasts } = BaseToast.useToastManager();

  return toasts.map((entry) => {
    const tone = (entry.type as ToastTone | undefined) ?? "info";
    const dismissLabel = (entry.data as ToastData | undefined)?.dismissLabel ?? "Dismiss";
    // `entry.timeout` is always a number here (see `useToast` below: `0` for
    // "persistent", never `undefined`) — `0`/negative means Base UI never
    // scheduled a dismissal at all (`toast/provider/ToastProvider.js`'s
    // `add()`: `duration > 0` gates `scheduleTimer`), so there is nothing for
    // a ring to honestly count down.
    const durationMs = entry.timeout && entry.timeout > 0 ? entry.timeout : null;

    return (
      <BaseToast.Root
        // This is the element `data-expanded` lands on (see `CountdownClose`'s
        // doc comment) — `apps/console/app/globals.css`'s
        // `[data-expanded] .toast-countdown-ring` rule reads it from here.
        className="w-[min(380px,88vw)] transition-all duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 motion-reduce:transition-none"
        key={entry.id}
        toast={entry}
      >
        <Toast
          className="pointer-events-auto flex w-full items-start justify-between gap-3"
          // `Toast.Viewport` already renders role="region" aria-live="polite"
          // aria-relevant="additions text" (base-ui: toast/viewport/ToastViewport.js) —
          // it is the sole announcer for this stack. `Toast`'s own role="status"
          // is spread-overridable (toast.tsx applies {...props} after the
          // hardcoded role), so it is overridden here to avoid nesting a second
          // live region inside the first, which is the WAI-ARIA anti-pattern
          // that made VoiceOver double-announce.
          role="presentation"
        >
          <BaseToast.Description className="min-w-0 flex-1 pt-0.5">
            {entry.description}
          </BaseToast.Description>
          <CountdownClose dismissLabel={dismissLabel} durationMs={durationMs} tone={tone} />
        </Toast>
      </BaseToast.Root>
    );
  });
}

/**
 * The circular countdown IS the close control: a real `<button>`
 * (`BaseToast.Close`, which already carries `close(toast.id)` on click and
 * `aria-hidden={!expanded}` for screen readers — base-ui:
 * toast/close/ToastClose.js) wrapping an SVG ring plus a centred `×` that is
 * always visible — hovering only tints the button. The `×` used to fade in on
 * hover, which meant the toast never looked closable until the cursor was
 * already on the control; the ring carries the remaining time, the `×` carries
 * the affordance, and both have to read at rest.
 *
 * Two correctness rules govern the ring itself (both enforced in CSS, in
 * `apps/console/app/globals.css`, not here — this component only supplies the
 * per-instance geometry/duration as data):
 *
 * 1. It must pause exactly when the dismissal timer pauses, for all four of
 *    Base UI's pause conditions. Three of them — hover, focus, and a
 *    touch-swipe start — flow through the shared `expanded = hovering ||
 *    focused` state (toast/provider/ToastProvider.js) that `Toast.Root`
 *    renders as `data-expanded`; the CSS rule in
 *    `apps/console/app/globals.css` reads that directly. The fourth — window
 *    blur — pauses the real timer via a native `blur` listener
 *    (toast/viewport/ToastViewport.js's `handleWindowBlur` calling
 *    `pauseTimers()`) that never touches `hovering`/`focused`, so
 *    `data-expanded` alone cannot see it. `ToastProvider` above closes that
 *    gap itself: one `window` `blur`/`focus` listener pair, added once (not
 *    per toast), toggling `data-toast-window-blurred` on the document root,
 *    which the same CSS rule also watches. `document.hidden`/
 *    `visibilitychange` would not have worked here — losing window focus
 *    (Alt-Tab) does not hide the tab.
 * 2. A persistent toast (`durationMs === null`) renders the same ring
 *    geometry, fully "complete" (`stroke-dashoffset: 0`, a solid tone-colour
 *    circle) and marked `data-animated="false"` — never the depleting
 *    animation, which would claim an expiry that does not exist.
 */
function CountdownClose({
  dismissLabel,
  durationMs,
  tone,
}: {
  dismissLabel: string;
  durationMs: number | null;
  tone: ToastTone;
}) {
  return (
    <BaseToast.Close
      aria-label={dismissLabel}
      className="group relative grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-ink-50 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ink-50 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
    >
      <svg
        aria-hidden="true"
        className="-rotate-90"
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        width={RING_SIZE}
      >
        <circle
          className="stroke-white/15"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          fill="none"
          r={RING_RADIUS}
          strokeWidth={RING_STROKE}
        />
        <circle
          className={cn("toast-countdown-ring", ringToneClasses[tone])}
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          data-animated={durationMs !== null}
          data-testid="toast-countdown-ring"
          fill="none"
          r={RING_RADIUS}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeLinecap="round"
          strokeWidth={RING_STROKE}
          style={
            {
              "--toast-duration": durationMs !== null ? `${durationMs}ms` : undefined,
              "--toast-ring-circumference": `${RING_CIRCUMFERENCE}px`,
            } as React.CSSProperties
          }
        />
      </svg>
      {/*
       * Always visible, never hover-revealed. A dismiss affordance that only
       * appears once the cursor is already on it cannot be discovered: the
       * reader has no way to learn the toast is closable, and has to guess
       * where to aim. The ring carries the remaining time; this carries the
       * "you can close me", and both have to be readable at rest.
       */}
      <Xmark aria-hidden="true" className="absolute h-3.5 w-3.5" />
    </BaseToast.Close>
  );
}

export function useToast() {
  const manager = BaseToast.useToastManager();

  // `manager` is a NEW object every render whose identity is tied to Base
  // UI's `toasts` array (`useToastManager` is memoised on
  // `[toasts, add, close, update, promise]`), and `toasts` gets a new array
  // reference on every add/close/update ANYWHERE toasts are used in the app.
  // Consumers legitimately put `toast` in a `useEffect` dependency array —
  // "announce this outcome once" is exactly an effect's job — so `toast`'s
  // own identity must not ride along with that churn: an unstable `toast`
  // reference re-runs every effect that depends on it every time ANY toast
  // fires anywhere, including its own, which fires another toast, which
  // changes the reference again — an infinite loop (reproduced: 27 toasts in
  // 100ms from a single mount before this fix). `managerRef` always holds the
  // latest manager, updated during render (safe — it happens before any
  // effect or callback can read it); `toast`/`dismiss` are empty-deps
  // `useCallback`s that read it at call time, so their own identity never
  // changes.
  const managerRef = React.useRef(manager);
  managerRef.current = manager;

  const toast = React.useCallback(
    ({ tone = "info", message, duration, dismissLabel }: ToastOptions): void => {
      // Explicitly `void`, not inferred: `add()` below returns the created
      // toast's id, but the `queueMicrotask` deferral means that id doesn't
      // exist yet when this function returns — there is nothing synchronous
      // left to hand back. No call site relies on a return value today (and
      // `dismiss()` is unused), so this just makes the compiler enforce what
      // the code already does. A future programmatic-dismiss or
      // promise-toast API that needs the id would have to generate it
      // caller-side and pass it in as part of `ToastOptions`, not read it
      // off this call's return.
      //
      // Every real call site fires this from a useEffect (an outcome arriving,
      // a copy succeeding, an invite being created) — never a render body. That
      // still isn't safe to call synchronously: React keeps CommitContext on
      // the stack for the whole passive-effect flush, and the new toast's
      // Toast.Root measures itself in a layout effect that calls
      // ReactDOM.flushSync (base-ui: toast/root/ToastRoot.js's
      // `recalculateHeight`) as soon as it mounts. Calling `add` in the same
      // tick re-enters that still-active context — "flushSync was called from
      // inside a lifecycle method" — and once two toasts overlap, the height
      // recalculation on each mount can retrigger the next before React
      // settles, which contributed to the "Maximum update depth exceeded"
      // crash observed here (the referential-instability fix above removes
      // the other, larger contributor). Queuing the add as a microtask lets
      // the effect flush's call stack unwind first, so base-ui's own
      // flushSync lands as a fresh top-level update instead of a nested one.
      //
      // What this does NOT reach: under React StrictMode (on by default for
      // the app router since Next 13.5.1 — apps/console does not override
      // it), React double-invokes every layout effect in dev, so
      // `recalculateHeight` itself still fires twice per toast and each
      // invocation's flushSync still warns — a bounded, non-growing pair per
      // toast, confirmed by firing multiple toasts in a row and watching the
      // count stay exactly 2-per-toast, never compounding. That pair lives
      // entirely inside base-ui's own layout effect, not in any code this
      // file calls synchronously, doesn't happen in production (StrictMode's
      // double-invoke is dev-only), and doesn't happen in this file's own
      // test below (no StrictMode wrapper there) — so there is nothing left
      // on this side of the call to defer further.
      queueMicrotask(() => {
        managerRef.current.add<ToastData>({
          data: { dismissLabel },
          description: message,
          timeout: duration === null ? 0 : (duration ?? DEFAULT_DURATION_MS),
          type: tone,
        });
      });
    },
    [],
  );

  const dismiss = React.useCallback((id: string) => {
    managerRef.current.close(id);
  }, []);

  return { dismiss, toast };
}

/**
 * "Announce this outcome once" as a tested primitive, not a hand-written ref
 * guard repeated at every call site. Two real call sites
 * (`candidate-invitations-panel.tsx`, `settings-billing-section.tsx`) each
 * wrote their own copy of this — same shape, same comment about `toast`'s
 * consumer-visible stability not being enough on its own, independently
 * arrived at. See the "dedupe on settle identity" tests below for why a plain
 * `[toast]`-only guard (or the referential stability `useToast` already
 * provides) isn't sufficient: a consumer's effect can legitimately re-run for
 * a reason that has nothing to do with a new outcome to announce — a
 * translation function's identity changing on a locale switch, most
 * commonly — and `toastOnce` must not re-announce the same one.
 *
 * `toastOnce(key, options)` fires `toast(options)` only when `key` differs,
 * by reference (`===`), from the last key it announced — never on a call
 * with the same key twice in a row, however many times the effect calling it
 * re-runs in between. One primitive serves two different call-site shapes
 * this way, because "the same outcome" means different things at each:
 *   - A settle from `useActionState` (candidate invitations): pass the
 *     settle object itself. A new submit produces a genuinely new object
 *     (confirmed in `candidate-invitation-actions.ts`), so `key` changing is
 *     exactly "a new invite was created" — and nothing else can produce a
 *     new key.
 *   - A value read once on mount and held in state (the purchase toast):
 *     pass that same state value. Its identity is already stable for the
 *     life of the mount (it was computed once, via `useState`'s lazy
 *     initializer), so passing it as the key reproduces "fires once per
 *     mount" without a separate boolean flag — the first call announces and
 *     remembers it; every later call carries the identical reference and is
 *     therefore a no-op.
 * A call site whose "same outcome" test genuinely isn't captured by any
 * single value's identity would not be honestly served by this — none of the
 * real call sites are in that position.
 */
export function useToastOnce() {
  const { toast } = useToast();
  const announcedKeyRef = React.useRef<unknown>(undefined);

  const toastOnce = React.useCallback(
    (key: unknown, options: ToastOptions): void => {
      if (key === announcedKeyRef.current) {
        return;
      }
      announcedKeyRef.current = key;
      toast(options);
    },
    [toast],
  );

  return { toastOnce };
}
