"use client";

import { NavArrowLeft, NavArrowRight } from "iconoir-react";
import { parseAsString, useQueryState } from "nuqs";
import { Button } from "@prelude/ui";

const cursorParser = parseAsString.withOptions({
  history: "push",
  scroll: false,
  shallow: false,
});

/**
 * Shared URL-backed navigation for bounded console lists. A cursor is an
 * implementation detail; users only see familiar previous/next actions.
 */
export function CursorPagination({
  nextCursor,
  previousCursor,
}: {
  nextCursor: string | null;
  previousCursor: string | null;
}) {
  const [cursor, setCursor] = useQueryState("cursor", cursorParser);

  if (!cursor && !nextCursor) {
    return null;
  }

  return (
    <nav
      aria-label="List pagination"
      className="flex items-center justify-end gap-2 border-t border-ink-100 px-5 py-3"
    >
      {cursor ? (
        <Button
          onClick={() => void setCursor(previousCursor)}
          type="button"
          variant="secondary"
        >
          <NavArrowLeft aria-hidden={true} className="h-4 w-4" />
          Previous
        </Button>
      ) : null}
      {nextCursor ? (
        <Button
          onClick={() => void setCursor(nextCursor)}
          type="button"
          variant="secondary"
        >
          Next page
          <NavArrowRight aria-hidden={true} className="h-4 w-4" />
        </Button>
      ) : null}
    </nav>
  );
}
