import { describe, expect, test } from "vitest";

import { selectRecording } from "./recording-playback";

describe("selectRecording", () => {
  test("returns null when there are no recordings", () => {
    expect(selectRecording([])).toBeNull();
  });

  test("prefers the first available recording (latest, input is desc)", () => {
    const selected = selectRecording([
      { durationMs: 90_000, objectKey: "recordings/s/2.ogg", status: "available" },
      { durationMs: 60_000, objectKey: "recordings/s/1.ogg", status: "available" },
    ]);

    expect(selected).toEqual({
      durationMs: 90_000,
      objectKey: "recordings/s/2.ogg",
      status: "available",
    });
  });

  test("surfaces processing when an egress is still in flight and none available", () => {
    const selected = selectRecording([
      { durationMs: null, objectKey: "recordings/s/2.ogg", status: "recording" },
      { durationMs: null, objectKey: "recordings/s/1.ogg", status: "failed" },
    ]);

    expect(selected).toEqual({ durationMs: null, objectKey: null, status: "processing" });
  });

  test("reports failed when every attempt failed", () => {
    const selected = selectRecording([
      { durationMs: null, objectKey: "recordings/s/1.ogg", status: "failed" },
    ]);

    expect(selected).toEqual({ durationMs: null, objectKey: null, status: "failed" });
  });

  test("an available recording wins over an in-flight one", () => {
    const selected = selectRecording([
      { durationMs: null, objectKey: "recordings/s/2.ogg", status: "recording" },
      { durationMs: 120_000, objectKey: "recordings/s/1.ogg", status: "available" },
    ]);

    expect(selected?.status).toBe("available");
    expect(selected?.objectKey).toBe("recordings/s/1.ogg");
  });
});
