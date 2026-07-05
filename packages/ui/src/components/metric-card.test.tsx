import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MetricCard } from "./metric-card";

describe("MetricCard", () => {
  it("can render as a clickable summary metric", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <MetricCard
        label="Needs review"
        meta="Ready for human review"
        onClick={onClick}
        value="3"
      />,
    );

    await user.click(screen.getByRole("button", { name: /needs review/i }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
