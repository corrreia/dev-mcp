import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import type { Env, SourceConfig } from "@/types";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

type Db = DrizzleD1Database<typeof schema>;

interface OAuthStore {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
}

export class SourceOAuthClientProvider implements OAuthClientProvider {
  private authorizationUrl: URL | null = null;

  constructor(
    private readonly db: Db,
    private readonly env: Env,
    private readonly source: SourceConfig
  ) {}

  get redirectUrl(): string {
    return `${this.env.APP_URL}/api/sources/${this.source.slug}/oauth/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `dev-mcp ${this.source.slug}`,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    };
  }

  async state(): Promise<string> {
    const state = crypto.randomUUID();
    await this.patch({ state });
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.read()).clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.patch({ clientInformation });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.read()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.patch({ tokens });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.patch({ codeVerifier });
  }

  async codeVerifier(): Promise<string> {
    const codeVerifier = (await this.read()).codeVerifier;
    if (!codeVerifier) throw new Error("No OAuth code verifier saved for source");
    return codeVerifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    const store = await this.read();
    if (scope === "all" || scope === "client") delete store.clientInformation;
    if (scope === "all" || scope === "tokens") delete store.tokens;
    if (scope === "all" || scope === "verifier") {
      delete store.codeVerifier;
      delete store.state;
    }
    await this.write(store);
  }

  get pendingAuthorizationUrl(): URL | null {
    return this.authorizationUrl;
  }

  async validateState(state: string | null): Promise<boolean> {
    const expected = (await this.read()).state;
    return Boolean(state && expected && state === expected);
  }

  private async read(): Promise<OAuthStore> {
    const source = await this.db
      .select({ encryptedSecret: schema.sources.encryptedSecret })
      .from(schema.sources)
      .where(eq(schema.sources.id, this.source.id))
      .get();
    const decrypted = await decryptSecret(source?.encryptedSecret ?? this.source.encryptedSecret, this.env.ENCRYPTION_KEY);
    if (!decrypted) return {};
    return JSON.parse(decrypted) as OAuthStore;
  }

  private async patch(patch: Partial<OAuthStore>): Promise<void> {
    await this.write({ ...(await this.read()), ...patch });
  }

  private async write(store: OAuthStore): Promise<void> {
    const encryptedSecret = await encryptSecret(JSON.stringify(store), this.env.ENCRYPTION_KEY);
    await this.db.update(schema.sources).set({ encryptedSecret }).where(eq(schema.sources.id, this.source.id)).run();
  }
}
