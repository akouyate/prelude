# Toast entry motion: measure, then fix

Branch: `fix/toast-entry-motion` (from `main` @ `1e9d722`)
Files touched: `packages/ui/src/feedback/toast-provider.tsx`, `apps/console/app/globals.css`

## Setup

Isolated git worktree (another agent was actively editing unrelated files in the
shared checkout), console dev server on port 3010 with `CONSOLE_AUTH_PROVIDER=mock`,
Chrome DevTools MCP (`chrome-devtools__*`) for real performance traces, plus a
custom `requestAnimationFrame`-sampling harness (`evaluate_script`) for
frame-level and `getComputedStyle` visual-timeline evidence, since the trace
tool's "insights" only cover a fixed catalogue (INP breakdown, LCP, etc.) and
don't dump arbitrary main-thread call trees.

Trigger used: clicking "Copy candidate link" on `/roles` — fires a real toast
via `useCopyLinkFeedback` -> `useToast().toast()`. (`?purchase=granted` does
**not** work in this environment: `CreditPurchasePanel` — and its
`purchaseToastFor` toast — only mounts when `creditBilling` is non-null, which
requires Stripe to be configured; it's `null` here, so that whole panel never
renders.)

## Measurement — before

**INP breakdown** (real trusted click, via DevTools trace):
total 35ms = 1ms input delay + 0.9ms processing + **33ms presentation delay**.
Almost the entire interaction cost is "time to paint the next frame", not
event handling.

**Frame-level (rAF timestamp deltas, click-anchored, 4 runs):** exactly one
dropped frame per toast open, magnitude 41-52ms (display refresh ~120Hz, so a
normal frame is ~8.3ms — this one frame eats 5-6 frames' worth of budget).
It lands 45-65ms after the click, correlating almost exactly with a
`MutationObserver`-measured `toastFirstSeenTs - clickTs` of 50-65ms (i.e. the
frame that should show the toast appearing is the one that's dropped).

**Visual timeline (`getComputedStyle` sampled every rAF, click-anchored):**
the toast element exists in the DOM within ~5ms of the click, already with
`data-starting-style` gone, `opacity: 0`, and (once measured with the right
property — see "wrong turn" below) `translate: 0px 8px`. Those values sit
**completely frozen** from ~5ms to ~55ms post-click — the toast is invisible
and not moving, full main-thread block — then the transition visibly starts
and runs smoothly and cleanly for ~200ms to completion. So the "stutter" is a
single ~50ms **freeze right at the start**, not scattered jank through the
animation.

**Console (both before and after):** `flushSync was called from inside a
lifecycle method` fires 2x per toast open, every time — this is
`@base-ui-components/react/toast`'s `ToastRoot.js` `recalculateHeight`, a
forced synchronous layout inside a mount-time layout effect (confirmed by
source inspection, matches the task brief). Its timing lines up exactly with
the dropped frame above.

## Isolating the cause (before touching any code)

Rather than assume which of the four hypothesized causes was responsible,
each was tested independently by injecting a temporary override stylesheet
via `evaluate_script` and re-running the frame-delta harness (3-4 runs each),
with nothing in the real source changed yet:

| Change tested | Effect on the ~42-52ms dropped frame |
|---|---|
| Disable the countdown ring's `stroke-dashoffset` animation entirely (`animation: none !important`) | **No change** — still 41.6/42.3/42.6ms across 3 runs |
| Disable `backdrop-filter` (the card's `backdrop-blur-md`) | **No change** — 33.8/41.5/43ms across 3 runs (within noise) |
| Add `will-change: opacity, transform` to the toast root | **No improvement**, occasionally a second, smaller janky frame appeared (43.2+18.5ms) |
| Restrict `transition-all` -> `transition-[opacity,transform]` alone | **No change** — still 41.7-42.1ms across 3 runs |

Conclusion: the dropped frame is **not** the countdown ring, **not**
`backdrop-blur`, and **not** something `will-change` fixes — it is base-ui's
own mount-time `flushSync`, which is not code this repo calls and can't be
patched from here. This directly informed what got changed and what didn't:
the ring is **not** delayed (see `globals.css`'s new comment — tested and
found to buy nothing, so delaying it would only cost the ring's honesty
against the real dismissal timer for no smoothness gain), and `will-change`
is **not** added (tested, no benefit, occasional extra jank).

## A wrong turn, caught by measurement

The first pass restricted the transition to `transition-[opacity,transform]`.
Visually re-sampling afterward showed `transform` permanently `"none"` and
the toast's vertical position (`getBoundingClientRect().top`) **never
moving** — the slide had silently stopped animating. Cause: Tailwind 4
compiles `translate-y-2` to the standalone CSS `translate` property, not
`transform` (confirmed against the generated stylesheet:
`.data-\[starting-style\]\:translate-y-2[data-starting-style] { translate: var(--tw-translate-x) var(--tw-translate-y); }`).
Listing `transform` in `transition-property` excluded `translate` entirely,
so the property changed instantly instead of animating — a fade with no
slide. This is exactly the "ship a different jank" failure mode the task
warned about; caught here only because the fix was re-measured visually
(`getComputedStyle().translate` / bounding-rect sampling) instead of assumed
correct because it compiled and looked plausible. Fixed to
`transition-[opacity,translate]`.

## The fix

`packages/ui/src/feedback/toast-provider.tsx`, `BaseToast.Root` className:

- `transition-all` -> `transition-[opacity,translate]`: only the two
  compositor-friendly properties the entry/exit motion actually uses are
  listed now (correct regardless of whether it moved the measured number here
  — it removes a real footgun for whatever the next toast variant animates).
- `duration-200` -> `duration-300`, `translate-y-2` -> `translate-y-3` (8px ->
  12px, same ratio as the duration change, so average px/ms speed is
  unchanged — not just "slower"): since the ~45ms freeze itself can't be
  removed, this shrinks it from ~22% of the animation to ~15%.
- `ease-out` -> `ease-in-out`: worked out by hand from each curve's control
  points. `ease-out` = `cubic-bezier(0,0,0.2,1)` — first control point at
  (0,0) means the curve's initial slope is dominated by the *second* point,
  which comes out steep (~5x): a fast pop exactly where the freeze ends.
  `ease-in-out` = `cubic-bezier(0.4,0,0.2,1)` — first control point (0.4,0)
  keeps the y-value at 0 to first order, so the initial slope is genuinely
  ~0 (a true standing start) while the same landing point (0.2,1) still
  decelerates it into an equally soft finish. This is a deliberate departure
  from the usual "entrances decelerate" convention, justified by this
  entrance's specific circumstance (a preceding freeze most entrances don't
  have).

`apps/console/app/globals.css`: no functional change to the ring's rules —
added a comment on `.toast-countdown-ring[data-animated="true"]` recording
that a delay was tested (ring disabled outright) and rejected because it
didn't move the dropped frame at all, so delaying it would only cost the
ring's honesty against the real timer for nothing in return.

## A second wrong turn, caught by review: narrowing `transform` broke swipe-cancel snapback

Same failure shape as the `translate` bug above, one property further along —
and this one shipped in the first commit before it was caught.
`transition-[opacity,translate]` (no `transform`) is correct for the entry/exit
motion this file drives, but base-ui's own swipe-to-dismiss gesture — enabled
here because this stack renders no `Toast.Positioner`, so `isAnchored` is
false and `swipeDirection` defaults to `['down', 'right']`
(`toast/root/ToastRoot.js:88,92-96`) — reuses this same element's `transform`
and this same element's `transition-property` for its own purposes. While
dragging, `getDragStyles()` applies an inline `transform: translateX(…)
translateY(…) scale(…)` plus `transition: none`, freezing the element at the
pointer's position with no animation (`ToastRoot.js:443-460`). Release a drag
below the 40px `SWIPE_THRESHOLD` and `handlePointerUp` resets the drag offset
back to the rest position and clears `isSwiping`
(`ToastRoot.js:407-413`); `getDragStyles()` then takes its early-return
branch and stops emitting the inline `transform`/`transition` overrides
entirely — so whatever the CSS class's `transition-property` says to animate
is what animates the snap back to rest. On `main`, `transition-all` covered
this for free. `transition-[opacity,translate]` didn't include `transform`,
so a cancelled swipe (mouse drag included — Base UI's pointer handling isn't
touch-gated) snapped back instantly instead of animating. My own frame-delta
harness never exercised this: it only ever drove the click-triggered entry
path, never a drag gesture, so it had no way to see a regression on a path it
never touched.

**Reproduced directly**, dispatching synthetic `PointerEvent`s at the
mounted toast (`pointerdown` → two `pointermove`s, ~14–18px down, comfortably
under the 40px threshold → `pointerup`), then sampling
`getComputedStyle(toastEl).transform` every `requestAnimationFrame` after
release:

- **With `transition-[opacity,translate]` (the regression, reproduced via a
  temporary override stylesheet, not by reverting the real fix):**
  `transform` reads `"none"` at the very first sampled frame after release
  (5.4ms later) — the 14px drag offset disappears with no animation at all,
  confirming the instant-snap regression the review flagged.
- **With `transition-[opacity,translate,transform]` (the actual fix):** the
  same drag-and-release sequence produces a clean decay —
  `matrix(1,0,0,1,0,14)` right after release, easing smoothly down through
  `…,13.98)`, `…,13.76)`, `…,12.25)`, `…,7.58)`, `…,2.32)` … to `"none"` at
  ~305–313ms, matching the 300ms transition-duration. The gesture animates
  again.

Fix: add `transform` back to the property list —
`transition-[opacity,translate,transform]`. It costs nothing on the entry
path (confirmed below): the toast's own entry animation never touches
`transform`, only `opacity`/`translate`, so listing it adds no work there —
it only matters for, and is only ever driven by, the swipe gesture that
base-ui itself reuses this element's transition for.

## Measurement — after

**INP** (real trusted click): 32ms (was 35ms) — expected to be roughly
unchanged, since INP measures time-to-next-paint and the freeze itself is
untouched (base-ui's, not ours).

**Frame-level (5 runs):** still exactly one dropped frame per open, 35-50ms —
unchanged in magnitude, as predicted (this cost isn't ours to remove). No
*new* jank introduced by the longer duration: every run but one showed
exactly one janky frame; the animation's remaining ~50 frames (300ms at
~120Hz) are clean in all runs.

**Visual timeline, onset gentleness (the part that was actually fixable) —
`getComputedStyle().opacity` in the first frames after the freeze ends:**

| | first post-freeze frame | second frame |
|---|---|---|
| Before (`ease-out`, 200ms) | 0.17 | 0.26 |
| After (`ease-in-out`, 300ms) | 0.002 | 0.008 |

This is the concrete, measured effect of the fix: the moment the toast
un-freezes went from an immediately-17%-visible pop to an imperceptible
near-zero start that gradually builds — confirmed against the rendered
computed style, not assumed from the curve's name (the first curve tried,
`cubic-bezier(0.22,1,0.36,1)`, was worked out by hand to have an *equally
steep* initial slope to `ease-out` — despite reading as a "soft" easing name —
and was replaced with `ease-in-out` before shipping, for exactly that
reason).

**Re-verified after adding `transform` back** (post-review fix): re-ran both
the frame-delta harness (4 runs: single dropped frame each, 40.3–49.7ms — same
magnitude as above) and the opacity-onset sampling (0.003 then 0.007 in the
first two post-freeze frames — same as the 0.002/0.008 above, within
run-to-run noise). Restoring `transform` to the property list changed nothing
about the entry motion, exactly as expected: the entry path never sets a
`transform` value, so adding it to the list gives the browser one more
property to watch, not one more property to move.

## What this does and does not establish

Established: the single dropped frame at mount is base-ui's own forced
layout, not fixable from this repo; it isn't made worse by any of these
changes; the visible entrance motion itself (once it starts) was already
jank-free before and after; the post-freeze onset is measurably softer now.
Not established: no human-perception study was run, so "reads as smooth" is
inferred from the onset-slope numbers and the unchanged single-frame-drop
count, not observed directly by a person. The frame-timing harness also
surfaced one large (~227ms), non-reproducible-pattern gap in a single early
baseline run, well outside the entry window (>300ms post-click) and not
correlated with any code path touched here — noted but not chased further,
as it falls outside the 0-300ms entry motion this task scopes.

## Gates

- `pnpm typecheck` — clean (19/19 tasks).
- `pnpm --filter @prelude/ui test` — 17/17 passed.
- `pnpm --filter @prelude/console test` — 568 passed, 9 skipped (577 total).
- `pnpm lint` — confirmed null gate per `CLAUDE.md` (errors with "you are
  linting '.', but all files matching '.' are ignored" — the shared config
  has no rules, only `ignores`).

Must-not-regress items (all untouched by this change): exactly one ARIA live
region (`Toast.Viewport`'s), the ring never animates for `duration: null`
toasts, the pause rule still matches both `[data-expanded]` and
`:root[data-toast-window-blurred]`, `prefers-reduced-motion` still removes
all motion (`motion-reduce:transition-none` kept), `toast`/`dismiss` stay
referentially stable (their `useCallback`s are untouched).
