import { afterEach, describe, expect, it } from "vitest";

import {
  isRecordingActive,
  parseRecordingEnabled,
} from "./recording-state";

const originalFlag = process.env.RECORDING_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.RECORDING_ENABLED;
    return;
  }

  process.env.RECORDING_ENABLED = originalFlag;
});

describe("parseRecordingEnabled", () => {
  it("accepts exactly the truthy spellings the Go service accepts", () => {
    // Mirrors `recordingEnabled` in services/realtime/cmd/server/config.go: the
    // two reads must agree on what "on" means, or the notice would describe a
    // recording the service is not making (or hide one it is).
    ["1", "true", "yes", "TRUE", " Yes ", "True"].forEach((value) => {
      expect(`${value}: ${parseRecordingEnabled(value)}`).toBe(`${value}: true`);
    });
  });

  it("reads anything else as off, including missing and empty values", () => {
    [undefined, null, "", "   ", "0", "false", "no", "on", "enabled"].forEach(
      (value) => {
        expect(`${String(value)}: ${parseRecordingEnabled(value)}`).toBe(
          `${String(value)}: false`,
        );
      },
    );
  });
});

describe("isRecordingActive", () => {
  it("is off when the flag is absent", () => {
    delete process.env.RECORDING_ENABLED;

    expect(isRecordingActive()).toBe(false);
  });

  it("is on only when the deployment turned recording on", () => {
    process.env.RECORDING_ENABLED = "1";
    expect(isRecordingActive()).toBe(true);

    process.env.RECORDING_ENABLED = "0";
    expect(isRecordingActive()).toBe(false);
  });
});
