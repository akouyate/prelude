export const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
export const clerkSecretKey = process.env.CLERK_SECRET_KEY;

export const isClerkConfigured = Boolean(clerkPublishableKey && clerkSecretKey);

export const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/login";
export const signUpUrl =
  process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up";
export const afterSignInUrl =
  process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ?? "/";
export const afterSignUpUrl =
  process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL ??
  "/onboarding/organization";
