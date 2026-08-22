export const CONSOLE_LIST_PAGE_SIZE = 25;

const cursorPrefix = "hc.v1.";

/**
 * Cursors deliberately carry only the stable Prisma id. They are an opaque UI
 * token, not an authorization boundary: every query also scopes by org id.
 */
export function encodeCursor(id: string) {
  return `${cursorPrefix}${Buffer.from(id, "utf8").toString("base64url")}`;
}

export function decodeCursor(value: string | null | undefined) {
  if (!value?.startsWith(cursorPrefix)) {
    return null;
  }

  try {
    const id = Buffer.from(
      value.slice(cursorPrefix.length),
      "base64url",
    ).toString("utf8");
    return /^[a-zA-Z0-9_-]{8,191}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function pageFromRows<T extends { id: string }>(
  rows: T[],
  pageSize = CONSOLE_LIST_PAGE_SIZE,
) {
  const hasNextPage = rows.length > pageSize;
  const items = hasNextPage ? rows.slice(0, pageSize) : rows;

  return {
    items,
    nextCursor: hasNextPage ? encodeCursor(items.at(-1)?.id ?? "") : null,
  };
}

/** Returns the prior boundary from one reverse query of one complete page. */
export function previousCursorFromRows<T extends { id: string }>(
  rows: T[],
  pageSize = CONSOLE_LIST_PAGE_SIZE,
) {
  return rows.length >= pageSize ? encodeCursor(rows[pageSize - 1].id) : null;
}
