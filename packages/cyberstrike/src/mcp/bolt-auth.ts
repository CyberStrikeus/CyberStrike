import crypto from "crypto"
import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"

const log = Log.create({ service: "mcp.bolt-auth" })

/**
 * Bolt Ed25519 authentication client.
 *
 * Handles keypair generation, pairing with Bolt servers, request signing,
 * and credential storage. Matches the server-side protocol in bolt/src/http.ts.
 *
 * Signing format: "{timestamp}\n{nonce}\n{method}\n{path}\n{bodyHash}"
 */
export namespace BoltAuth {
  const BOLT_KEYS_DIR = path.join(Global.Path.data, "bolt-keys")
  const DEFAULT_TIMEOUT = 15_000

  export const Credentials = z.object({
    clientId: z.string(),
    publicKeyPem: z.string(),
    privateKeyPem: z.string(),
    serverPublicKeyPem: z.string(),
    serverFingerprint: z.string(),
    serverUrl: z.string(),
    pairedAt: z.string(),
  })
  export type Credentials = z.infer<typeof Credentials>

  /**
   * Generate a new Ed25519 keypair.
   */
  function generateKeypair(): { publicKeyPem: string; privateKeyPem: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
    return {
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    }
  }

  /**
   * Compute SHA-256 fingerprint of a public key (first 16 hex chars).
   * Must match server-side fingerprint() function.
   */
  function fingerprint(publicKeyPem: string): string {
    return crypto.createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16)
  }

  /**
   * Pair with a Bolt server using admin token authentication.
   *
   * Flow:
   * 1. POST /pair with admin token → get pairing code
   * 2. Generate Ed25519 keypair
   * 3. POST /pair/exchange with code + public key → get server public key + client ID
   * 4. Save credentials
   */
  export async function pair(
    boltName: string,
    url: string,
    adminToken: string,
  ): Promise<{ clientId: string; serverFingerprint: string }> {
    const baseUrl = url.replace(/\/+$/, "")

    log.info("starting bolt pairing", { boltName, url: baseUrl })

    // Step 1: Request pairing code
    const pairRes = await fetch(`${baseUrl}/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    })

    if (!pairRes.ok) {
      const text = await pairRes.text().catch(() => "")
      throw new Error(`Pairing failed (${pairRes.status}): ${text}`)
    }

    const pairData = (await pairRes.json()) as { code: string; expiresIn: number; serverFingerprint: string }
    log.info("received pairing code", { boltName, expiresIn: pairData.expiresIn })

    // Step 2: Generate client keypair
    const keypair = generateKeypair()
    const clientId = fingerprint(keypair.publicKeyPem)

    // Step 3: Exchange keys
    const exchangeRes = await fetch(`${baseUrl}/pair/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: pairData.code,
        clientPublicKey: keypair.publicKeyPem,
        clientName: `cyberstrike-${boltName}`,
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    })

    if (!exchangeRes.ok) {
      const text = await exchangeRes.text().catch(() => "")
      throw new Error(`Key exchange failed (${exchangeRes.status}): ${text}`)
    }

    const exchangeData = (await exchangeRes.json()) as {
      clientId: string
      serverPublicKey: string
      serverFingerprint: string
    }

    // Step 4: Save credentials
    const creds: Credentials = {
      clientId: exchangeData.clientId,
      publicKeyPem: keypair.publicKeyPem,
      privateKeyPem: keypair.privateKeyPem,
      serverPublicKeyPem: exchangeData.serverPublicKey,
      serverFingerprint: exchangeData.serverFingerprint,
      serverUrl: baseUrl,
      pairedAt: new Date().toISOString(),
    }

    await saveCredentials(boltName, creds)
    log.info("bolt pairing complete", { boltName, clientId: creds.clientId })

    return { clientId: creds.clientId, serverFingerprint: creds.serverFingerprint }
  }

  /**
   * Sign an HTTP request with Ed25519.
   *
   * Adds headers: X-Client-Id, X-Timestamp, X-Nonce, X-Signature
   * Signature format: "{timestamp}\n{nonce}\n{method}\n{path}\n{bodyHash}"
   */
  export function signRequest(
    creds: Credentials,
    method: string,
    urlPath: string,
    body: string,
  ): Record<string, string> {
    const timestamp = new Date().toISOString()
    const nonce = crypto.randomBytes(16).toString("hex")
    const bodyHash = crypto.createHash("sha256").update(body).digest("hex")
    const message = `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${urlPath}\n${bodyHash}`

    const privateKey = crypto.createPrivateKey(creds.privateKeyPem)
    const signature = crypto.sign(null, Buffer.from(message), privateKey)

    return {
      "X-Client-Id": creds.clientId,
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": signature.toString("base64"),
    }
  }

  /**
   * Perform a fetch request with Ed25519 signature authentication.
   */
  export async function signedFetch(
    creds: Credentials,
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    const parsed = new URL(url)
    const method = (init?.method ?? "GET").toUpperCase()
    const body = typeof init?.body === "string" ? init.body : ""
    const urlPath = parsed.pathname + parsed.search

    const authHeaders = signRequest(creds, method, urlPath, body)

    return fetch(url, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers ?? {}).entries()),
        ...authHeaders,
      },
    })
  }

  // --- Credential Storage ---

  async function credPath(boltName: string): Promise<string> {
    await fs.mkdir(BOLT_KEYS_DIR, { recursive: true })
    return path.join(BOLT_KEYS_DIR, `${boltName}.json`)
  }

  export async function getCredentials(boltName: string): Promise<Credentials | undefined> {
    const p = await credPath(boltName)
    const file = Bun.file(p)
    const exists = await file.exists()
    if (!exists) return undefined
    const data = await file.json().catch(() => undefined)
    const parsed = Credentials.safeParse(data)
    return parsed.success ? parsed.data : undefined
  }

  export async function saveCredentials(boltName: string, creds: Credentials): Promise<void> {
    const p = await credPath(boltName)
    await Bun.write(p, JSON.stringify(creds, null, 2), { mode: 0o600 })
  }

  export async function deleteCredentials(boltName: string): Promise<void> {
    const p = await credPath(boltName)
    await fs.rm(p, { force: true })
  }

  export async function listCredentials(): Promise<string[]> {
    await fs.mkdir(BOLT_KEYS_DIR, { recursive: true })
    const files = await fs.readdir(BOLT_KEYS_DIR)
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""))
  }

  /**
   * Check if a Bolt server is reachable and get its health info.
   */
  export async function healthCheck(url: string): Promise<{
    status: string
    version?: string
    tools?: number
    auth?: string
  }> {
    const baseUrl = url.replace(/\/+$/, "")
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    })
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
    return res.json()
  }
}
