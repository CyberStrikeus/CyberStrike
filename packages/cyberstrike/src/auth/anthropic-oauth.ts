import { randomBytes, createHash } from "node:crypto"
import { Auth } from "./index"
import { Log } from "@/util/log"

const log = Log.create({ service: "anthropic-oauth" })

// Claude Pro/Max OAuth (public client). The browser callback is NOT a local
// server — Anthropic only accepts its hosted callback, so the user copies the
// returned `code#state` back into the client. Verified working values:
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback"
// Returns the account/org for the logged-in OAuth token (parity with the
// genuine client's `GET /api/oauth/profile`). Used to fill metadata.user_id.
const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile"
// `user:sessions:claude_code` marks the token as a Claude Code session, which
// is what routes usage to the subscription's included quota (vs extra-usage).
const SCOPES = ["org:create_api_key", "user:profile", "user:inference", "user:sessions:claude_code"].join(" ")

// Some Anthropic edge nodes reject the default fetch UA; mirror the reference
// client's headers.
const OAUTH_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  "User-Agent": "axios/1.13.6",
}

const PROVIDER_ID = "anthropic"
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export interface AnthropicTokens {
  access: string
  refresh: string
  expires: number
}

/**
 * Build the authorize URL. The PKCE verifier doubles as the state parameter
 * (matches the reference Claude Code flow). Returns the verifier so the caller
 * can complete the exchange.
 */
export function createAuthorization(): { url: string; verifier: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash("sha256").update(verifier).digest())
  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
  })
  return { url: `${AUTHORIZE_URL}?${params.toString()}`, verifier }
}

/**
 * Exchange the pasted authorization code for tokens. The hosted callback shows
 * the code as `code#state`; we accept either form.
 */
// Dedup repeated exchanges of the same pasted code. OAuth codes are single-use,
// so a double-submit (the UI can fire the callback twice) makes the second call
// 400 with "already used" and surface a misleading "invalid code". Returning the
// first in-flight/settled result keeps the success.
let lastExchange: { key: string; promise: Promise<AnthropicTokens | null> } | undefined

export function exchangeCode(input: string, verifier: string): Promise<AnthropicTokens | null> {
  const key = input.trim()
  if (lastExchange?.key === key) return lastExchange.promise
  const promise = performExchange(key, verifier)
  lastExchange = { key, promise }
  return promise
}

async function performExchange(input: string, verifier: string): Promise<AnthropicTokens | null> {
  const [code, state] = input.split("#")
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: OAUTH_HEADERS,
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        state,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      log.error("oauth code exchange failed", { status: res.status, url: TOKEN_URL, body: errBody.slice(0, 500) })
      return null
    }
    const data: any = await res.json()
    if (!data?.access_token) {
      log.error("oauth code exchange: no access_token in response", { keys: Object.keys(data ?? {}) })
      return null
    }
    return {
      access: data.access_token,
      refresh: data.refresh_token,
      expires: Date.now() + (typeof data.expires_in === "number" ? data.expires_in : 3600) * 1000,
    }
  } catch (error) {
    log.error("oauth code exchange error", { error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

async function refreshTokens(refreshToken: string): Promise<AnthropicTokens | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: OAUTH_HEADERS,
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    })
    if (!res.ok) {
      log.error("oauth token refresh failed", { status: res.status })
      return null
    }
    const data: any = await res.json()
    if (!data?.access_token) return null
    return {
      access: data.access_token,
      refresh: data.refresh_token ?? refreshToken,
      expires: Date.now() + (typeof data.expires_in === "number" ? data.expires_in : 3600) * 1000,
    }
  } catch (error) {
    log.error("oauth token refresh error", { error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

// In-flight refresh dedup: concurrent requests near expiry share one refresh.
let pendingRefresh: Promise<string | null> | null = null

/** Whether a stored Anthropic OAuth (subscription) credential exists. */
export async function hasAnthropicOAuth(): Promise<boolean> {
  const auth = await Auth.get(PROVIDER_ID)
  return auth?.type === "oauth"
}

/**
 * Get a valid Anthropic subscription access token from cyberstrike's own auth
 * store, refreshing (and persisting) when near expiry. This is cyberstrike's
 * OWN OAuth credential (minted via the AnthropicAuthPlugin login flow) — it
 * draws from the Claude Pro/Max subscription's included quota, verified to
 * return `overage-status: rejected` (i.e. NOT billed as extra usage).
 */
export async function getValidAnthropicToken(): Promise<string | null> {
  const auth = await Auth.get(PROVIDER_ID)
  if (!auth || auth.type !== "oauth") return null
  if (auth.expires > Date.now() + EXPIRY_BUFFER_MS) return auth.access

  if (!pendingRefresh) {
    log.info("anthropic subscription token expired, refreshing")
    pendingRefresh = (async () => {
      const tokens = await refreshTokens(auth.refresh)
      if (!tokens) return null
      await Auth.set(PROVIDER_ID, {
        type: "oauth",
        access: tokens.access,
        refresh: tokens.refresh,
        expires: tokens.expires,
        ...(auth.accountId ? { accountId: auth.accountId } : {}),
      })
      return tokens.access
    })().finally(() => {
      pendingRefresh = null
    })
  }
  return await pendingRefresh
}

// Cached account UUID for metadata.user_id. Fetched once from the OAuth profile
// and persisted to the auth store (`accountId`) so we don't refetch every run.
let _accountUuid: string | undefined

/**
 * The Anthropic account UUID for the logged-in subscription token. Returns the
 * persisted value if known, otherwise fetches `GET /api/oauth/profile` once and
 * caches it. Returns undefined if unavailable (metadata.user_id then omits it —
 * which does not affect included-quota attribution).
 */
export async function getAnthropicAccountUuid(): Promise<string | undefined> {
  if (_accountUuid) return _accountUuid
  const auth = await Auth.get(PROVIDER_ID)
  if (auth?.type === "oauth" && auth.accountId) {
    _accountUuid = auth.accountId
    return _accountUuid
  }
  const token = await getValidAnthropicToken()
  if (!token) return undefined
  try {
    const res = await fetch(PROFILE_URL, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    })
    if (!res.ok) {
      log.warn("oauth profile fetch failed", { status: res.status })
      return undefined
    }
    const data: any = await res.json()
    const uuid: unknown = data?.account?.uuid
    if (typeof uuid === "string" && uuid) {
      _accountUuid = uuid
      const cur = await Auth.get(PROVIDER_ID)
      if (cur?.type === "oauth") await Auth.set(PROVIDER_ID, { ...cur, accountId: uuid })
      return uuid
    }
    log.warn("oauth profile response missing account.uuid", { keys: Object.keys(data ?? {}) })
  } catch (error) {
    log.warn("oauth profile fetch error", { error: error instanceof Error ? error.message : String(error) })
  }
  return undefined
}
