import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "./clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyTextToClipboard", () => {
  it("writes the text and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(
      copyTextToClipboard("https://candidate.hirecall.test/interview/ci_abc"),
    ).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(
      "https://candidate.hirecall.test/interview/ci_abc",
    );
  });

  // The defect this guards against: an unhandled rejection from `writeText`
  // (permission denied, insecure context) must never read as a successful
  // copy — the caller decides the toast from this return value alone.
  it("swallows a rejected writeText and reports failure, without throwing", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(
      copyTextToClipboard("https://candidate.hirecall.test/interview/ci_abc"),
    ).resolves.toBe(false);
  });

  it("reports failure rather than a silent no-op success when the Clipboard API is unavailable (insecure context, unsupported browser)", async () => {
    vi.stubGlobal("navigator", {});

    await expect(
      copyTextToClipboard("https://candidate.hirecall.test/interview/ci_abc"),
    ).resolves.toBe(false);
  });
});
