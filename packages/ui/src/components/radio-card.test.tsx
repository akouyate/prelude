"use client";

import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RadioCardGroup } from "./radio-card";

describe("RadioCardGroup", () => {
  it("renders options and reports value changes", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    function Example() {
      const [value, setValue] = React.useState("mid");

      return (
        <RadioCardGroup
          ariaLabel="Seniority"
          onValueChange={(nextValue) => {
            setValue(nextValue);
            onValueChange(nextValue);
          }}
          options={[
            { label: "Junior", value: "junior" },
            { label: "Mid-level", value: "mid" },
            { label: "Senior", value: "senior" },
          ]}
          value={value}
        />
      );
    }

    render(<Example />);

    await user.click(screen.getByText("Senior"));

    expect(onValueChange).toHaveBeenCalledWith("senior");
  });
});
