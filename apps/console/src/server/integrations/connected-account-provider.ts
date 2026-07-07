import type {
  ConnectedAccountCapability,
  ConnectedAccountProviderId,
} from "./connected-account-types";

export type AuthorizationInput = {
  capability: ConnectedAccountCapability;
  loginHint?: string;
  state: string;
};

export type OAuthCallbackInput = {
  code: string;
  capability: ConnectedAccountCapability;
};

export type ConnectedAccountTokenSet = {
  accessToken: string;
  expiresAt: Date | null;
  refreshToken: string | null;
  scopes: string[];
};

export type ConnectedAccountUserInfo = {
  email: string | null;
  externalAccountId: string;
};

export type RefreshAccessTokenInput = {
  refreshToken: string;
  scopes: string[];
};

export type RevokeConnectionInput = {
  token: string;
};

export interface ConnectedAccountProvider {
  getAuthorizationUrl(input: AuthorizationInput): Promise<string>;
  exchangeCode(input: OAuthCallbackInput): Promise<ConnectedAccountTokenSet>;
  getUserInfo(accessToken: string): Promise<ConnectedAccountUserInfo>;
  refreshAccessToken(
    input: RefreshAccessTokenInput,
  ): Promise<ConnectedAccountTokenSet>;
  revokeConnection(input: RevokeConnectionInput): Promise<void>;
  provider: ConnectedAccountProviderId;
}

export class ConnectedAccountProviderError extends Error {
  readonly code: string;
  readonly isReconnectRequired: boolean;

  constructor(
    message: string,
    {
      code = "provider_error",
      isReconnectRequired = false,
    }: {
      code?: string;
      isReconnectRequired?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "ConnectedAccountProviderError";
    this.code = code;
    this.isReconnectRequired = isReconnectRequired;
  }
}
