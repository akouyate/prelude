import { afterEach, describe, expect, it } from "vitest";

import { isRecordingActive } from "./recording-state";

const originalFlag = process.env.RECORDING_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.RECORDING_ENABLED;
    return;
  }

  process.env.RECORDING_ENABLED = originalFlag;
});

describe("isRecordingActive", () => {
  it("is off when the flag is absent", () => {
    // Fail-closed: the trust panel must never promise a recording on a
    // deployment that has not turned one on.
    delete process.env.RECORDING_ENABLED;

    expect(isRecordingActive()).toBe(false);
  });

  it("is on only when the deployment turned recording on", () => {
    process.env.RECORDING_ENABLED = "1";
    expect(isRecordingActive()).toBe(true);

    process.env.RECORDING_ENABLED = "0";
    expect(isRecordingActive()).toBe(false);
  });

  it("reads the same rule as the candidate app and the Go service", () => {
    // The shared rule (@prelude/core, policies/recording.ts) is what makes the
    // three readers agree; this pins that this reader really uses it.
    process.env.RECORDING_ENABLED = " TRUE ";
    expect(isRecordingActive()).toBe(true);

    process.env.RECORDING_ENABLED = "enabled";
    expect(isRecordingActive()).toBe(false);
  });
});
