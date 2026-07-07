import "server-only";

export type GoogleOAuthConfig =
  | {
      ok: true;
      value: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
      };
    }
  | {
      ok: false;
      error: "missing_config";
    };

export function getGoogleOAuthConfig(
  source: Record<string, string | undefined> = process.env,
): GoogleOAuthConfig {
  const clientId = source.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = source.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return { ok: false, error: "missing_config" };
  }

  return {
    ok: true,
    value: {
      clientId,
      clientSecret,
      redirectUri:
        source.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
        `${consoleBaseUrl(source)}/api/integrations/google/callback`,
    },
  };
}

function consoleBaseUrl(source: Record<string, string | undefined>) {
  return (
    source.NEXT_PUBLIC_CONSOLE_URL?.trim().replace(/\/$/u, "") ||
    "http://localhost:3000"
  );
}
