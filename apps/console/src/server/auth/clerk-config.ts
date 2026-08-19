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
  appEnv: process.env.APP_ENV,
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
  appEnv,
  clerkConfigured,
  nodeEnv,
  requestedProvider,
}: {
  appEnv?: string;
  clerkConfigured: boolean;
  nodeEnv?: string;
  requestedProvider?: string;
}): ConsoleAuthConfiguration {
  // Either switch closes the door on a mock identity. The console historically
  // read production off NODE_ENV alone, while the rest of the stack (the Go
  // realtime service, the candidate app, the Python interviewer worker) switches
  // on APP_ENV: a deployment that sets APP_ENV=production and leaves NODE_ENV
  // unset must still be refused. Purely additive — nothing refused before is
  // allowed now.
  const isProduction = nodeEnv === "production" || appEnv === "production";
  const setting = parseConsoleAuthProviderSetting(requestedProvider);

  if (!setting) {
    return {
      error: "CONSOLE_AUTH_PROVIDER must be auto, clerk, or mock.",
      provider: "clerk",
      setting: "auto",
    };
  }

  if (setting === "mock") {
    if (isProduction) {
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

  if (isProduction) {
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
