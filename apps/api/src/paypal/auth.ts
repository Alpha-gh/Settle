import { PayPalError } from './errors.js';

export interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number; // epoch ms
}

export interface AuthOptions {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  /** Buffer in ms before expiration to trigger refresh (default 60_000 ms) */
  refreshBufferMs?: number;
  fetchFn?: typeof fetch;
}

export class PayPalAuthenticator {
  private cachedToken: TokenCacheEntry | null = null;
  private pendingRequest: Promise<string> | null = null;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly refreshBufferMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: AuthOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.refreshBufferMs = options.refreshBufferMs ?? 60_000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  /**
   * Retrieves a valid access token, refreshing early if near expiry.
   * Never logs credentials or token contents.
   */
  public async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - now > this.refreshBufferMs) {
      return this.cachedToken.accessToken;
    }

    // Deduplicate concurrent refresh calls
    if (this.pendingRequest) {
      return this.pendingRequest;
    }

    this.pendingRequest = this.fetchNewToken().finally(() => {
      this.pendingRequest = null;
    });

    return this.pendingRequest;
  }

  private async fetchNewToken(): Promise<string> {
    const url = `${this.baseUrl}/v1/oauth2/token`;
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });

      const debugId = response.headers.get('paypal-debug-id') || undefined;

      if (!response.ok) {
        let errData: any;
        try {
          errData = await response.json();
        } catch {
          errData = { message: await response.text() };
        }

        throw new PayPalError({
          message: `PayPal OAuth authentication failed: ${errData.error_description || errData.message || response.statusText}`,
          status: response.status,
          debugId,
          details: errData.details,
          rawError: errData,
        });
      }

      const data = (await response.json()) as {
        access_token: string;
        expires_in: number;
        token_type: string;
      };

      if (!data.access_token) {
        throw new PayPalError({
          message: 'PayPal OAuth response missing access_token',
          status: response.status,
          debugId,
        });
      }

      const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
      this.cachedToken = {
        accessToken: data.access_token,
        expiresAt,
      };

      return data.access_token;
    } catch (err) {
      if (err instanceof PayPalError) throw err;
      throw new PayPalError({
        message: `Failed to connect to PayPal OAuth: ${err instanceof Error ? err.message : String(err)}`,
        status: 500,
      });
    }
  }

  /**
   * For testing cache/refresh behavior.
   */
  public clearCache(): void {
    this.cachedToken = null;
    this.pendingRequest = null;
  }

  public getCachedTokenEntry(): TokenCacheEntry | null {
    return this.cachedToken;
  }
}
