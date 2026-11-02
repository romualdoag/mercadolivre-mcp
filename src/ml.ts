/**
 * ml.ts — cliente HTTP autenticado da API do Mercado Livre.
 *
 * Auth: Authorization Code + refresh_token (offline_access). O access_token
 * dura ~6h; o refresh_token é de uso único e rotaciona a cada refresh.
 * O estado (access + refresh atual) persiste em `<pkgroot>/.ml-tokens.json`
 * (fail-soft, modo 600) porque a cópia do `.env` fica obsoleta após a
 * primeira rotação. Credenciais são resolvidas a partir da raiz do pacote
 * (import.meta.url), nunca de process.cwd() — clientes MCP lançam o server
 * com cwd arbitrário.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProxyAgent } from "undici";

export const PKG_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const API_BASE = "https://api.mercadolibre.com";
const TOKEN_URL = `${API_BASE}/oauth/token`;
const UA = "mercadolivre-mcp/0.1.0";

export interface MlConfig {
  siteId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  timeoutMs: number;
  useProxy: boolean;
  tokensPath: string | null;
}

export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MlConfig {
  const missing = ["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REFRESH_TOKEN"].filter(
    (k) => !env[k],
  );
  if (missing.length > 0) {
    throw new Error(
      `credenciais ausentes: ${missing.join(", ")} (veja README: permissões funcionais + OAuth)`,
    );
  }
  return {
    siteId: env.ML_SITE_ID ?? "MLB",
    clientId: env.ML_CLIENT_ID!,
    clientSecret: env.ML_CLIENT_SECRET!,
    refreshToken: env.ML_REFRESH_TOKEN!,
    timeoutMs: Number(env.ML_TIMEOUT_MS ?? 20_000),
    useProxy: env.ML_USE_PROXY === "1",
    tokensPath:
      env.ML_TOKENS_ENABLED === "0"
        ? null
        : (env.ML_TOKENS_PATH ?? path.join(PKG_ROOT, ".ml-tokens.json")),
  };
}

interface TokenState {
  access_token: string;
  refresh_token: string;
  obtained_at: number;
  expires_in: number;
}

export class MlApiError extends Error {
  readonly status: number;
  readonly mlCode?: string;
  constructor(status: number, message: string, mlCode?: string) {
    super(message);
    this.name = "MlApiError";
    this.status = status;
    this.mlCode = mlCode;
  }
}

function friendlyMessage(status: number, body: unknown): string {
  const b =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const code = typeof b.code === "string" ? b.code : undefined;
  const msg = typeof b.message === "string" ? b.message : undefined;
  if (code === "PA_UNAUTHORIZED_RESULT_FROM_POLICIES" || status === 403) {
    return (
      `ML 403: app sem permissão para este recurso (PolicyAgent). ` +
      `No DevCenter, ative as permissões funcionais de leitura do app e ` +
      `reautorize (novo code → novo ML_REFRESH_TOKEN).` +
      (msg ? ` Detalhe: ${msg}` : "")
    );
  }
  if (status === 401)
    return "ML 401: credenciais rejeitadas (client_id/secret ou refresh inválido).";
  if (status === 404) return "ML 404: recurso não encontrado.";
  if (status === 429)
    return "ML 429: rate limit — reduza a frequência e tente de novo.";
  return `ML ${status}${code ? ` (${code})` : ""}${msg ? `: ${msg}` : ""}`;
}

export type FetchFn = typeof fetch;

export class MlClient {
  private state: TokenState | null = null;
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    private readonly cfg: MlConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.state = this.loadState();
  }

  private loadState(): TokenState | null {
    if (!this.cfg.tokensPath) return null;
    try {
      const raw = fs.readFileSync(this.cfg.tokensPath, "utf8");
      const s = JSON.parse(raw) as Partial<TokenState>;
      if (typeof s.access_token === "string" && typeof s.refresh_token === "string")
        return s as TokenState;
      return null;
    } catch {
      return null; // fail-soft: segue com o refresh da env
    }
  }

  private saveState(): void {
    if (!this.cfg.tokensPath || !this.state) return;
    try {
      fs.writeFileSync(
        this.cfg.tokensPath,
        JSON.stringify(this.state),
        { mode: 0o600 },
      );
    } catch {
      /* cache nunca quebra a chamada */
    }
  }

  private liveRefreshToken(): string {
    return this.state?.refresh_token ?? this.cfg.refreshToken;
  }

  private cachedAccess(): string | null {
    const s = this.state;
    if (!s?.access_token) return null;
    const marginMs = 60_000;
    if (s.obtained_at + (s.expires_in * 1000 - marginMs) > Date.now())
      return s.access_token;
    return null;
  }

  async accessToken(): Promise<string> {
    const hit = this.cachedAccess();
    if (hit) return hit;
    // Coalesce refreshes concorrentes num único POST.
    this.refreshInFlight ??= this.refresh();
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
    if (!this.state?.access_token)
      throw new MlApiError(401, "ML 401: credenciais rejeitadas (refresh falhou).");
    return this.state.access_token;
  }

  private async refresh(): Promise<void> {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: this.liveRefreshToken(),
    });
    let res: Response;
    try {
      res = await this.fetchFn(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body: form.toString(),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
        ...(this.dispatcher() ? { dispatcher: this.dispatcher() } : {}),
      });
    } catch (e) {
      throw new MlApiError(
        0,
        `falha de rede no refresh do token: ${e instanceof Error ? e.message : String(e)} (unknown)`,
      );
    }
    if (!res.ok)
      throw new MlApiError(
        res.status,
        `refresh do token falhou: ${friendlyMessage(res.status, await safeJson(res))}`,
      );
    const tok = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    this.state = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      obtained_at: Date.now(),
      expires_in: tok.expires_in,
    };
    this.saveState();
  }

  private dispatcher(): ProxyAgent | undefined {
    const proxy =
      process.env.ML_PROXY_URL ?? process.env.DATAIMPULSE_PROXY_URL;
    if (!this.cfg.useProxy || !proxy) return undefined;
    return new ProxyAgent(proxy);
  }

  /** GET autenticado com timeout; em 401, renova o token uma vez e repete. */
  async get<T>(pathname: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(API_BASE + pathname);
    for (const [k, v] of Object.entries(params))
      if (v !== undefined) url.searchParams.set(k, String(v));
    const run = async (token: string): Promise<Response> => {
      const disp = this.dispatcher();
      return this.fetchFn(url.toString(), {
        headers: {
          Accept: "application/json",
          "Accept-Language": "pt-BR",
          "User-Agent": UA,
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
        ...(disp ? { dispatcher: disp } : {}),
      });
    };
    let token: string;
    try {
      token = await this.accessToken();
    } catch (e) {
      throw e;
    }
    let res: Response;
    try {
      res = await run(token);
    } catch (e) {
      throw new MlApiError(
        0,
        `falha de rede em GET ${pathname}: ${e instanceof Error ? e.message : String(e)} (unknown)`,
      );
    }
    if (res.status === 401) {
      // Expiração típica: renova uma vez antes de falhar.
      await this.refresh();
      try {
        res = await run(this.state!.access_token);
      } catch (e) {
        throw new MlApiError(
          0,
          `falha de rede em GET ${pathname} (retry): ${e instanceof Error ? e.message : String(e)} (unknown)`,
        );
      }
    }
    if (!res.ok)
      throw new MlApiError(
        res.status,
        friendlyMessage(res.status, await safeJson(res)),
      );
    return (await res.json()) as T;
  }

  /** id do usuário dono do token (memoizado). */
  private meId: number | null = null;
  async ownUserId(): Promise<number> {
    if (this.meId) return this.meId;
    const me = await this.get<{ id: number }>("/users/me");
    this.meId = me.id;
    return me.id;
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}
