export const clerkPublishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
export const clerkSecretKey = process.env.CLERK_SECRET_KEY;

export const isClerkConfigured = Boolean(clerkPublishableKey && clerkSecretKey);

export type ConsoleAuthProvider = "clerk" | "mock";
export type ConsoleAuthProviderSetting = ConsoleAuthProvider | "auto";

type ConsoleAuthConfiguration = {
  error: string | null;
  provider: ConsoleAuthProvider;
  setting: ConsoleAuthProviderSetting;
};

export const consoleAuthConfiguration = resolveConsoleAuthConfiguration({
  clerkConfigured: isClerkConfigured,
  nodeEnv: process.env.NODE_ENV,
  requestedProvider: process.env.CONSOLE_AUTH_PROVIDER,
});

export const consoleAuthProvider = consoleAuthConfiguration.provider;
export const consoleAuthConfigurationError = consoleAuthConfiguration.error;
export const isConsoleAuthMockEnabled =
  consoleAuthProvider === "mock" && !consoleAuthConfigurationError;
export const isConsoleAuthClerkEnabled =
  consoleAuthProvider === "clerk" &&
  isClerkConfigured &&
  !consoleAuthConfigurationError;

export const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/login";
export const signUpUrl =
  process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up";
export const afterSignInUrl =
  process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ?? "/";
export const afterSignUpUrl =
  process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL ??
  "/onboarding/organization";

export function resolveConsoleAuthConfiguration({
  clerkConfigured,
  nodeEnv,
  requestedProvider,
}: {
  clerkConfigured: boolean;
  nodeEnv?: string;
  requestedProvider?: string;
}): ConsoleAuthConfiguration {
  const setting = parseConsoleAuthProviderSetting(requestedProvider);

  if (!setting) {
    return {
      error: "CONSOLE_AUTH_PROVIDER must be auto, clerk, or mock.",
      provider: "clerk",
      setting: "auto",
    };
  }

  if (setting === "mock") {
    if (nodeEnv === "production") {
      return {
        error: "Mock Clerk auth is disabled in production.",
        provider: "clerk",
        setting,
      };
    }

    return { error: null, provider: "mock", setting };
  }

  if (setting === "clerk") {
    return clerkConfigured
      ? { error: null, provider: "clerk", setting }
      : {
          error: "Clerk is not configured.",
          provider: "clerk",
          setting,
        };
  }

  if (clerkConfigured) {
    return { error: null, provider: "clerk", setting };
  }

  if (nodeEnv === "production") {
    return {
      error: "Clerk is not configured.",
      provider: "clerk",
      setting,
    };
  }

  return { error: null, provider: "mock", setting };
}

function parseConsoleAuthProviderSetting(
  value: string | undefined,
): ConsoleAuthProviderSetting | null {
  if (!value) {
    return "auto";
  }

  if (value === "auto" || value === "clerk" || value === "mock") {
    return value;
  }

  return null;
}
