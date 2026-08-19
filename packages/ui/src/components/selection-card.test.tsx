"use client";

import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelectionCard } from "./selection-card";

// The package runs Vitest without `globals`, so Testing Library never registers
// its own afterEach — renders would otherwise stack up across tests.
afterEach(cleanup);

describe("SelectionCard", () => {
  it("renders title, description and meta", () => {
    render(
      <SelectionCard
        description="Frankfurt"
        meta={<span>Coming soon</span>}
        title="European Union"
      />,
    );

    expect(screen.getByText("European Union")).toBeInTheDocument();
    expect(screen.getByText("Frankfurt")).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });

  it("omits the meta slot when no meta is given", () => {
    render(<SelectionCard description="Frankfurt" title="European Union" />);

    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
  });

  it("reports the selected state through aria-pressed", () => {
    const { rerender } = render(<SelectionCard selected title="Selected" />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");

    rerender(<SelectionCard title="Selected" />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });

  // Consumers mark a genuinely unavailable option (a data-residency region that
  // does not exist yet) by pairing `disabled` with a "Coming soon" tag in `meta`.
  // The card must then be inert and announced as disabled — a decorative card
  // that still looks clickable is what made the US residency card read as a
  // choice the recruiter could make.
  it("is inert and announced as disabled when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <SelectionCard
        disabled
        meta={<span>Coming soon</span>}
        onClick={onClick}
        title="United States"
      />,
    );

    const card = screen.getByRole("button", { name: /United States/ });
    expect(card).toBeDisabled();

    await user.click(card);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("stops presenting itself as clickable when disabled", () => {
    const { rerender } = render(<SelectionCard title="United States" />);
    expect(screen.getByRole("button").className).toContain("cursor-pointer");

    rerender(<SelectionCard disabled title="United States" />);
    expect(screen.getByRole("button").className).toContain("cursor-not-allowed");
    expect(screen.getByRole("button").className).not.toContain("cursor-pointer");
  });
});
