#!/usr/bin/env bun
// Sign all official skills with Ed25519
// Usage:
//   First time:  bun run packages/cyberstrike/script/sign-skills.ts --generate
//   Re-sign:     bun run packages/cyberstrike/script/sign-skills.ts
//
// Reads private key from CYBERSTRIKE_SKILL_PRIVATE_KEY env var or .skill-signing-key file
// The .skill-signing-key file is gitignored — NEVER commit it
import path from "path"

const root = path.resolve(import.meta.dir, "../../..")
const skillDir = path.join(root, ".cyberstrike", "skill")
const keyFile = path.join(root, ".skill-signing-key")
const signingModule = path.join(root, "packages", "cyberstrike", "src", "skill", "signing.ts")

async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  const pub = await crypto.subtle.exportKey("raw", pair.publicKey)
  const priv = await crypto.subtle.exportKey("pkcs8", pair.privateKey)
  return {
    publicKey: Buffer.from(pub).toString("base64"),
    privateKey: Buffer.from(priv).toString("base64"),
  }
}

async function signContent(content: string, privateKeyB64: string) {
  const stripped = content
    .replace(/^sha256:.*$/m, "")
    .replace(/^signature:.*$/m, "")
    .replace(/^signed_by:.*$/m, "")
    .trim()
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(stripped)
  const hash = hasher.digest("hex")

  const raw = Buffer.from(privateKeyB64, "base64")
  const key = await crypto.subtle.importKey("pkcs8", raw, { name: "Ed25519" }, false, ["sign"])
  const data = new TextEncoder().encode(hash)
  const sig = await crypto.subtle.sign("Ed25519", key, data)

  return { sha256: hash, signature: Buffer.from(sig).toString("base64") }
}

async function verifySignature(sha256: string, signature: string, publicKeyB64: string) {
  const raw = Buffer.from(publicKeyB64, "base64")
  const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"])
  const sig = Buffer.from(signature, "base64")
  const data = new TextEncoder().encode(sha256)
  return crypto.subtle.verify("Ed25519", key, sig, data)
}

function updateFrontmatter(content: string, sha256: string, signature: string): string {
  // Find frontmatter boundaries: first --- and second ---
  const first = content.indexOf("---")
  if (first === -1) throw new Error("No opening --- in frontmatter")
  const second = content.indexOf("\n---", first + 3)
  if (second === -1) throw new Error("No closing --- in frontmatter")

  // Extract frontmatter content between the two ---
  let fm = content.slice(first + 3, second + 1)
  const body = content.slice(second + 1) // includes closing --- and everything after

  // Remove existing signing fields from frontmatter
  fm = fm.replace(/^sha256:.*\n/gm, "")
  fm = fm.replace(/^signature:.*\n/gm, "")
  fm = fm.replace(/^signed_by:.*\n/gm, "")

  // Append signing fields to frontmatter
  const insert = `sha256: ${sha256}\nsignature: ${signature}\nsigned_by: cyberstrike-official\n`
  return "---" + fm + insert + body
}

async function main() {
  const generate = process.argv.includes("--generate")

  let privateKeyB64: string
  let publicKeyB64: string

  if (generate) {
    console.log("Generating new Ed25519 keypair...")
    const pair = await generateKeyPair()
    privateKeyB64 = pair.privateKey
    publicKeyB64 = pair.publicKey

    // Save private key
    await Bun.write(keyFile, privateKeyB64)
    console.log(`  Private key saved to: ${keyFile}`)
    console.log(`  Public key: ${publicKeyB64}`)

    // Embed public key in signing.ts
    const src = await Bun.file(signingModule).text()
    const updated = src.replace(
      /const OFFICIAL_PUBLIC_KEY_B64 = "[^"]*"/,
      `const OFFICIAL_PUBLIC_KEY_B64 = "${publicKeyB64}"`,
    )
    await Bun.write(signingModule, updated)
    console.log(`  Public key embedded in signing.ts`)

    // Ensure .gitignore has the key file
    const gitignore = path.join(root, ".gitignore")
    const gi = await Bun.file(gitignore).text()
    if (!gi.includes(".skill-signing-key")) {
      await Bun.write(gitignore, gi.trimEnd() + "\n.skill-signing-key\n")
      console.log(`  Added .skill-signing-key to .gitignore`)
    }
  } else {
    // Load existing private key
    privateKeyB64 = process.env.CYBERSTRIKE_SKILL_PRIVATE_KEY ?? ""
    if (!privateKeyB64) {
      const exists = await Bun.file(keyFile).exists()
      if (!exists) {
        console.error("No private key found. Run with --generate first, or set CYBERSTRIKE_SKILL_PRIVATE_KEY env var.")
        process.exit(1)
      }
      privateKeyB64 = (await Bun.file(keyFile).text()).trim()
    }

    // Derive public key from private key for verification
    const raw = Buffer.from(privateKeyB64, "base64")
    const imported = await crypto.subtle.importKey("pkcs8", raw, { name: "Ed25519" }, true, ["sign"])
    // Re-export as JWK to get the public key component
    const jwk = await crypto.subtle.exportKey("jwk", imported)
    // x is the public key in base64url
    const xB64url = jwk.x!
    const xB64 = xB64url.replace(/-/g, "+").replace(/_/g, "/")
    const pad = xB64.length % 4 === 0 ? "" : "=".repeat(4 - (xB64.length % 4))
    publicKeyB64 = xB64 + pad
  }

  // Scan and sign all skills
  const glob = new Bun.Glob("*/SKILL.md")
  const files: string[] = []
  for await (const file of glob.scan({ cwd: skillDir, absolute: false })) {
    files.push(file)
  }
  files.sort()

  let signed = 0
  let failed = 0

  for (const rel of files) {
    const full = path.join(skillDir, rel)
    const content = await Bun.file(full).text()

    try {
      const { sha256, signature } = await signContent(content, privateKeyB64)
      const valid = await verifySignature(sha256, signature, publicKeyB64)
      if (!valid) {
        console.log(`  VERIFY FAIL: ${rel}`)
        failed++
        continue
      }

      const updated = updateFrontmatter(content, sha256, signature)
      await Bun.write(full, updated)
      signed++
      process.stdout.write(`  SIGNED: ${rel}\n`)
    } catch (err) {
      console.log(`  ERROR: ${rel} — ${err}`)
      failed++
    }
  }

  console.log(`\nDone: ${signed} signed, ${failed} failed`)

  if (signed > 0) {
    // Verify one random skill
    const sample = files[Math.floor(Math.random() * files.length)]
    const sampleContent = await Bun.file(path.join(skillDir, sample)).text()
    const sha256Match = sampleContent.match(/^sha256:\s*(.+)$/m)
    const sigMatch = sampleContent.match(/^signature:\s*(.+)$/m)
    if (sha256Match && sigMatch) {
      const valid = await verifySignature(sha256Match[1], sigMatch[1], publicKeyB64)
      console.log(`\nVerification check (${sample}): ${valid ? "PASS" : "FAIL"}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
