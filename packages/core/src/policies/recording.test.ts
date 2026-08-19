import { describe, expect, it } from "vitest";

import {
  parseRecordingEnabled,
  recordingEnabledTruthyValues,
} from "./recording";

// The Go realtime service is the process that starts — or refuses — an egress,
// so its parser is the reference implementation this rule mirrors. Verified
// against `func recordingEnabled` in services/realtime/cmd/server/config.go,
// which reads:
//
//   switch strings.ToLower(strings.TrimSpace(getenv("RECORDING_ENABLED"))) {
//   case "1", "true", "yes":
//
// The literals are pinned below rather than described, so a change on either
// side has to come here and face the other definition of "on". This package
// stays free of file/env I/O (it has no Node types on purpose), which is why
// the pin is a literal list and not a read of that source file.
const goAcceptedValues = ["1", "true", "yes"];

describe("parseRecordingEnabled", () => {
  it("accepts exactly the truthy spellings the Go service accepts", () => {
    expect([...recordingEnabledTruthyValues]).toEqual(goAcceptedValues);

    goAcceptedValues.forEach((value) => {
      expect(`${value}: ${parseRecordingEnabled(value)}`).toBe(`${value}: true`);
    });
  });

  it("case-folds and trims, like the Go service's ToLower(TrimSpace(...))", () => {
    ["TRUE", " Yes ", "True", "\t1\n", "YES"].forEach((value) => {
      expect(`${JSON.stringify(value)}: ${parseRecordingEnabled(value)}`).toBe(
        `${JSON.stringify(value)}: true`,
      );
    });
  });

  it("reads anything else as off, including missing and empty values", () => {
    // Fail-closed: an unreadable flag must describe the smaller processing.
    // "on", "enabled" and "y" are the plausible near-misses — the Go switch
    // rejects them, so this must too, or the two would disagree about a
    // deployment that thinks it turned recording on.
    [
      undefined,
      null,
      "",
      "   ",
      "0",
      "false",
      "no",
      "on",
      "enabled",
      "y",
    ].forEach((value) => {
      expect(`${String(value)}: ${parseRecordingEnabled(value)}`).toBe(
        `${String(value)}: false`,
      );
    });
  });
});
