import { describe, expect, it } from "vitest";

import { validateCandidateCallSchedule } from "./candidate-call-scheduling-policy";

const futureStart = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe("validateCandidateCallSchedule", () => {
  it("normalizes explicit candidate invitations and deduplicates guests", () => {
    const result = validateCandidateCallSchedule({
      addConference: "on",
      candidateEmail: " Candidate@Example.com ",
      durationMinutes: "30",
      guestEmails: "hiring@example.com, candidate@example.com",
      inviteCandidate: "on",
      location: "  Paris office ",
      startsAt: futureStart,
      timeZone: "Europe/Paris",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        addConference: true,
        attendeeEmails: ["candidate@example.com", "hiring@example.com"],
        candidateEmail: "candidate@example.com",
        inviteCandidate: true,
        location: "Paris office",
        timeZone: "Europe/Paris",
      },
    });
  });

  it("does not add a candidate to a private event", () => {
    const result = validateCandidateCallSchedule({
      addConference: "off",
      candidateEmail: "candidate@example.com",
      durationMinutes: "45",
      guestEmails: "",
      inviteCandidate: "off",
      location: "",
      startsAt: futureStart,
      timeZone: "Europe/Paris",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        addConference: false,
        attendeeEmails: [],
        inviteCandidate: false,
      },
    });
  });

  it("does not allow a candidate invitation to be bypassed as an additional guest", () => {
    expect(
      validateCandidateCallSchedule({
        addConference: "off",
        candidateEmail: "candidate@example.com",
        durationMinutes: "30",
        guestEmails: "candidate@example.com",
        inviteCandidate: "off",
        location: "",
        startsAt: futureStart,
        timeZone: "Europe/Paris",
      }),
    ).toEqual({
      error: "Enable the candidate invitation to add the candidate as a guest.",
      ok: false,
    });
  });

  it("rejects invitation without a valid candidate address", () => {
    expect(
      validateCandidateCallSchedule({
        addConference: "on",
        candidateEmail: "not-an-email",
        durationMinutes: "30",
        guestEmails: "",
        inviteCandidate: "on",
        location: "",
        startsAt: futureStart,
        timeZone: "Europe/Paris",
      }),
    ).toEqual({
      error: "Enter a valid candidate email address.",
      ok: false,
    });
  });
});
