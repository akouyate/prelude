# Prelude Design System

Prelude UI is built from three layers:

1. `@prelude/design-system` owns tokens: color scales, semantic surfaces,
   radius, spacing, shadows, fonts, and breakpoints.
2. `@prelude/ui` owns reusable React primitives. Interactive primitives should
   wrap Base UI first, then apply Prelude visual styling.
3. App features compose `@prelude/ui` primitives and avoid duplicating control,
   panel, field, tab, and notice classes locally.

## Current Component Rules

- Use `Button` for all button actions. Use rounded-full primary buttons unless a
  local product pattern explicitly calls for an icon-only shape.
- Use `IconButton` for icon-only actions. Every icon-only action needs an
  accessible label and should use Iconoir icons unless it is a real brand mark.
- Use `UnderlineTabs` for contextual views and `SegmentedTabs` for filters.
- Use `Surface` for panels and cards that frame a unique section.
- Use `MetricCard` for dashboard/list summary filters and KPI-style cards.
- Use `SectionHeading` for panel titles and descriptions.
- Use `Field` or `TextField` for labeled inputs. `Input` is Base UI compatible.
- Use `SelectField` for labeled app selects and `SelectControl` for compact
  inline selects. Native selects are reserved for simple server-form fallback
  cases.
- Use `Switch` for boolean settings.
- Use `RadioCardGroup` for single-choice card groups and `SelectionCard` for
  multi-select card toggles. Both share the same selected, inactive, disabled,
  and focus states.
- Use `Pill` for compact statuses and counts.
- Use `Notice` for inline success, warning, info, and error feedback.

## Visual Defaults

- App background: `#F9F8F3`.
- Primary action: `ink-900`.
- Accent: olive, used sparingly for selected states and positive affordances.
- Panels: no shadows by default, rounded `22px`, low-contrast ink borders.
- Focus: visible olive ring, never neon.

These rules keep the console consistent while preserving Base UI accessibility
and interaction behavior.
