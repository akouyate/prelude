import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BrandMark } from "./brand-mark";

afterEach(cleanup);

function decodeSvgSource(source: string) {
  const commaIndex = source.indexOf(",");
  const metadata = source.slice(0, commaIndex);
  const payload = source.slice(commaIndex + 1);

  return metadata.endsWith(";base64")
    ? atob(payload)
    : decodeURIComponent(payload);
}

describe("BrandMark", () => {
  it("uses the official wordmark on light surfaces", () => {
    render(<BrandMark />);

    const source = screen.getByRole("img", { name: "HireCall" }).getAttribute(
      "src",
    );

    expect(source).not.toBeNull();
    expect(decodeSvgSource(source ?? "")).toContain('viewBox="0 0 630 220"');
  });

  it("uses the official app icon in compact dark contexts", () => {
    render(<BrandMark appearance="on-dark" compact />);

    const source = screen.getByRole("img", { name: "HireCall" }).getAttribute(
      "src",
    );

    expect(source).not.toBeNull();
    expect(decodeSvgSource(source ?? "")).toContain("fill='#F5F1ED'");
  });
});
