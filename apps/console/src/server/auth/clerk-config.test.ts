import { describe, expect, it } from "vitest";

import { resolveConsoleAuthConfiguration } from "./clerk-config";

describe("console auth configuration", () => {
  it("uses Clerk when keys are configured in auto mode", () => {
    expect(
      resolveConsoleAuthConfiguration({
        clerkConfigured: true,
        nodeEnv: "development",
      }),
    ).toMatchObject({
      error: null,
      provider: "clerk",
      setting: "auto",
    });
  });

  it("uses the mock provider locally when auto mode has no Clerk keys", () => {
    expect(
      resolveConsoleAuthConfiguration({
        clerkConfigured: false,
        nodeEnv: "development",
      }),
    ).toMatchObject({
      error: null,
      provider: "mock",
      setting: "auto",
    });
  });

  it("allows an explicit local mock provider for smoke tests", () => {
    expect(
      resolveConsoleAuthConfiguration({
        clerkConfigured: true,
        nodeEnv: "test",
        requestedProvider: "mock",
      }),
    ).toMatchObject({
      error: null,
      provider: "mock",
      setting: "mock",
    });
  });

  it("rejects the mock provider in production", () => {
    expect(
      resolveConsoleAuthConfiguration({
        clerkConfigured: true,
        nodeEnv: "production",
        requestedProvider: "mock",
      }),
    ).toMatchObject({
      error: "Mock Clerk auth is disabled in production.",
      provider: "clerk",
      setting: "mock",
    });
  });

  it("rejects the mock provider when APP_ENV alone says production", () => {
    // The rest of the stack (Go realtime service, candidate app, Python worker)
    // switches on APP_ENV. A deploy that sets it and leaves NODE_ENV unset must
    // not get a mock recruiter identity.
    expect(
      resolveConsoleAuthConfiguration({
        appEnv: "production",
        clerkConfigured: true,
        requestedProvider: "mock",
      }),
    ).toMatchObject({
      error: "Mock Clerk auth is disabled in production.",
      provider: "clerk",
      setting: "mock",
    });
  });

  it("rejects the auto-mode mock fallback when APP_ENV alone says production", () => {
    expect(
      resolveConsoleAuthConfiguration({
        appEnv: "production",
        clerkConfigured: false,
      }),
    ).toMatchObject({
      error: "Clerk is not configured.",
      provider: "clerk",
      setting: "auto",
    });
  });

  it("still allows the mock provider when neither switch says production", () => {
    expect(
      resolveConsoleAuthConfiguration({
        appEnv: "development",
        clerkConfigured: true,
        nodeEnv: "test",
        requestedProvider: "mock",
      }),
    ).toMatchObject({
      error: null,
      provider: "mock",
      setting: "mock",
    });
  });

  it("requires Clerk keys when the provider is forced to Clerk", () => {
    expect(
      resolveConsoleAuthConfiguration({
        clerkConfigured: false,
        nodeEnv: "development",
        requestedProvider: "clerk",
      }),
    ).toMatchObject({
      error: "Clerk is not configured.",
      provider: "clerk",
      setting: "clerk",
    });
  });

  it("rejects unknown provider settings", () => {
    expect(
      resolveConsoleAuthConfiguration({
        clerkConfigured: true,
        nodeEnv: "development",
        requestedProvider: "plerck",
      }),
    ).toMatchObject({
      error: "CONSOLE_AUTH_PROVIDER must be auto, clerk, or mock.",
      provider: "clerk",
      setting: "auto",
    });
  });
});
