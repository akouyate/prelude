import { describe, expect, it } from "vitest";

import {
  CONSOLE_LIST_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  pageFromRows,
  previousCursorFromRows,
} from "./cursor-pagination";

describe("console cursor pagination", () => {
  it("keeps the page size bounded and reserves one row to detect a next page", () => {
    expect(CONSOLE_LIST_PAGE_SIZE).toBe(25);
    expect(pageFromRows([{ id: "a" }], CONSOLE_LIST_PAGE_SIZE)).toEqual({
      items: [{ id: "a" }],
      nextCursor: null,
    });
    expect(
      pageFromRows(
        Array.from({ length: CONSOLE_LIST_PAGE_SIZE + 1 }, (_, index) => ({
          id: `role_${index}`,
        })),
        CONSOLE_LIST_PAGE_SIZE,
      ),
    ).toMatchObject({
      items: expect.arrayContaining([{ id: "role_0" }]),
      nextCursor: encodeCursor("role_24"),
    });
  });

  it("accepts only cursors issued by the console and fails closed", () => {
    expect(decodeCursor(encodeCursor("cmrovp4lg002f15nj1jk8cgy0"))).toBe(
      "cmrovp4lg002f15nj1jk8cgy0",
    );
    expect(decodeCursor("not-a-console-cursor")).toBeNull();
    expect(decodeCursor("hc.v1.")).toBeNull();
  });

  it("derives the previous boundary from at most one reverse page", () => {
    const reverseRows = Array.from({ length: 25 }, (_, index) => ({
      id: `role_page_${48 - index}`,
    }));

    expect(previousCursorFromRows(reverseRows)).toBe(
      encodeCursor("role_page_24"),
    );
    expect(previousCursorFromRows(reverseRows.slice(0, 24))).toBeNull();
  });
});
