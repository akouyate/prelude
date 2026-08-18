import { expect, test, type Page } from "@playwright/test";

import { setupPreludeClerkTestingToken } from "./support/clerk-testing";

/*
 * A phone-width sweep for horizontal overflow.
 *
 * This exists because nothing else in the repo could catch it: typecheck, the
 * unit suites and `pnpm lint` all stayed green while /settings, /roles and the
 * role detail page each pushed the document ~250px wider than the viewport and
 * every screen scrolled sideways. The symptom is one number — the document is
 * wider than the window — so that is what this asserts.
 *
 * Deliberately scoped to overflow rather than to appearance: a screenshot test
 * would fail on every copy change, and the thing that made the console
 * unusable on a phone was not how it looked but that half of it sat off-screen.
 */

const PHONE = { height: 844, width: 390 } as const;

test.use({ viewport: PHONE });

test.beforeEach(async ({ page }) => {
  await setupPreludeClerkTestingToken({ page });
});

type OverflowReport = {
  documentWidth: number;
  offenders: Array<{ classes: string; tag: string; text: string }>;
  viewportWidth: number;
};

async function overflowReport(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    // An element inside a deliberate horizontal scroller (the settings section
    // rail, the segmented filters) is *supposed* to extend past the edge —
    // that is what "scroll for more" looks like. Only unscrollable overflow,
    // which the reader cannot reach, counts as a defect.
    const insideScroller = (element: Element) => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
      }
      return false;
    };

    const viewportWidth = document.documentElement.clientWidth;
    const offenders: OverflowReport["offenders"] = [];

    for (const element of document.querySelectorAll("body *")) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.right <= viewportWidth + 1) continue;
      if (insideScroller(element)) continue;

      // Report the outermost offender only: once a container overflows, every
      // child it pushes out is noise.
      const parent = element.parentElement;
      if (
        parent &&
        parent.getBoundingClientRect().right > viewportWidth + 1 &&
        !insideScroller(parent)
      ) {
        continue;
      }

      offenders.push({
        classes:
          typeof element.className === "string"
            ? element.className.slice(0, 120)
            : "",
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? "").trim().slice(0, 60),
      });
    }

    return {
      documentWidth: document.documentElement.scrollWidth,
      offenders,
      viewportWidth,
    };
  });
}

async function expectNoHorizontalOverflow(page: Page, where: string) {
  const report = await overflowReport(page);

  expect(
    report.offenders,
    `${where}: element(s) reach past the right edge of a ${PHONE.width}px screen`,
  ).toEqual([]);
  expect(
    report.documentWidth,
    `${where}: the page scrolls sideways (document ${report.documentWidth}px in a ${report.viewportWidth}px window)`,
  ).toBeLessThanOrEqual(report.viewportWidth);
}

test("workspace pages fit a phone screen", async ({ page }) => {
  for (const path of ["/", "/roles", "/candidates"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalOverflow(page, path);
  }
});

test("every settings section fits a phone screen", async ({ page }) => {
  // The seven sections are one client-rendered pane each, so a single visit
  // proves nothing about the other six.
  const sections = [
    "profile",
    "workspace",
    "team",
    "interview",
    "integrations",
    "notifications",
    "billing",
  ];

  for (const view of sections) {
    await page.goto(`/settings?view=${view}`);
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalOverflow(page, `/settings?view=${view}`);
  }
});

test("the active settings section is visible without scrolling the rail", async ({
  page,
}) => {
  // Landing on billing by URL is the mobile credit pill's own destination
  // (`/settings?view=billing`), and it is the last of seven tabs: without the
  // rail scrolling itself, the reader arrives with no indication of where they
  // are.
  await page.goto("/settings?view=billing");
  await page.waitForLoadState("networkidle");

  // Matched on `button` rather than on the nav's aria-label, which is
  // translated: the workspace's own bottom bar also marks its current page,
  // but with links.
  const activeTab = page.locator('nav button[aria-current="page"]');
  await expect(activeTab).toBeVisible();

  const box = await activeTab.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
});

test("a role detail page fits a phone screen", async ({ page }) => {
  await page.goto("/roles");
  await page.waitForLoadState("networkidle");

  const roleLink = page
    .locator('a[href^="/roles/"]:not([href="/roles/new"])')
    .first();

  // Reported rather than passed silently: with no role in the database this
  // page is simply not covered, and a green run should not imply otherwise.
  test.skip(
    (await roleLink.count()) === 0,
    "no role in this database to open — role detail not covered by this run",
  );

  await roleLink.click();
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalOverflow(page, "role detail");
});
