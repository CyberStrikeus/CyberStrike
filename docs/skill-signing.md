# Skill Signing & Verification

CyberStrike uses Ed25519 digital signatures to guarantee the integrity and authenticity of official skills. This document covers the full signing architecture, verification flow, and maintainer operations.

## Architecture Overview

```
┌─────────────────────────────────────┐
│  CyberStrike Maintainer (offline)   │
│                                     │
│  Private Key (.skill-signing-key)   │
│  ─────────────┐                     │
│               ▼                     │
│  SKILL.md → SHA-256 → Ed25519 Sign  │
│               │                     │
│               ▼                     │
│  sha256 + signature → frontmatter   │
└─────────────────────────────────────┘
                │
                ▼ (git push / npm publish)
┌─────────────────────────────────────┐
│  User Machine (binary + public key) │
│                                     │
│  Public Key (embedded in binary)    │
│  ─────────────┐                     │
│               ▼                     │
│  SKILL.md → SHA-256 → Ed25519 Verify│
│               │                     │
│               ▼                     │
│  official / community / tampered    │
└─────────────────────────────────────┘
```

## Key Management

### Key Pair

| Component   | Format                             | Location                                               | Committed to Git |
| ----------- | ---------------------------------- | ------------------------------------------------------ | ---------------- |
| Public Key  | Base64-encoded raw 32-byte Ed25519 | `packages/cyberstrike/src/skill/signing.ts` (embedded) | Yes              |
| Private Key | Base64-encoded PKCS8 Ed25519       | `.skill-signing-key` (project root)                    | **NEVER**        |

### Current Public Key

```
qC5noNpNWhgt8fyKZyc9p6kXOHvsHDDO4GCqfDHJ/RA=
```

### Private Key Security

- `.skill-signing-key` is listed in `.gitignore`
- The private key should also be backed up in a secure location (1Password, air-gapped USB, etc.)
- If the private key is compromised, a new keypair must be generated and all skills re-signed
- The `CYBERSTRIKE_SKILL_PRIVATE_KEY` environment variable can be used instead of the file

## Verification Statuses

When a skill is loaded, the verification engine assigns one of four statuses:

| Status       | Icon | Color  | Meaning                                                                      |
| ------------ | ---- | ------ | ---------------------------------------------------------------------------- |
| `official`   | ✓    | Green  | SHA-256 hash matches AND Ed25519 signature valid against embedded public key |
| `community`  | ○    | Yellow | SHA-256 hash matches but no signature, or signed by a non-official key       |
| `unverified` | ?    | Gray   | No `sha256` field in frontmatter — skill has never been signed               |
| `tampered`   | ✗    | Red    | Hash mismatch OR signature invalid — **skill loading is blocked**            |

## Verification Flow

```
skill load wstg-inpv-05
        │
        ▼
┌─ sha256 field exists? ─┐
│                         │
No                       Yes
│                         │
▼                         ▼
"unverified"    ┌─ Recompute SHA-256 ─┐
(load allowed)  │   from content       │
                │   (strips sha256,    │
                │    signature,        │
                │    signed_by lines)  │
                │                      │
                ▼                      │
        ┌─ Hash matches? ─┐           │
        │                  │           │
       No                 Yes          │
        │                  │           │
        ▼                  ▼           │
   "tampered"    ┌─ signed_by ==      │
   (BLOCKED)     │  "cyberstrike-     │
                 │   official"        │
                 │  AND signature     │
                 │  exists?           │
                 │                    │
                No                  Yes
                 │                    │
                 ▼                    ▼
            "community"    ┌─ Ed25519 verify ─┐
            (load allowed) │  signature vs    │
                           │  embedded        │
                           │  public key      │
                           │                  │
                          Valid            Invalid
                           │                  │
                           ▼                  ▼
                      "official"         "tampered"
                      (load allowed)     (BLOCKED)
```

## Signed Skill Frontmatter

A fully signed official skill has these fields in the YAML frontmatter:

```yaml
---
name: wstg-inpv-05
description: "Testing for SQL Injection"
category: input-validation
owasp_id: WSTG-INPV-05
version: "1.0.0"
author: cyberstrike-official
tags: [injection, input-validation, xss, sqli, wstg, inpv]
tech_stack: [mysql, postgresql, mssql, oracle, sqlite, php, java, python, nodejs]
cwe_ids: [CWE-89, CWE-564]
chains_with: [wstg-authz-02, wstg-conf-05, wstg-inpv-06]
prerequisites: [wstg-info-01, wstg-info-06]
severity_boost:
  wstg-authz-02: "SQLi + IDOR = Account Takeover (Critical)"
  wstg-conf-05: "SQLi + Directory Listing = Full DB Dump (Critical)"
sha256: 49581e2023f1163ded572a56fac09b107ba027df7a37738a71aa473f9d95483f
signature: 48ALC4B9k+EDnl4iUlWGvx/y0rJ0UMg3S9nHA1CP34OC0X6bNrq7VVMzVhRZShVMPexceX7IfvFDNgbwFeTUBQ==
signed_by: cyberstrike-official
---
```

### Hash Computation

The SHA-256 hash is computed from the **full file content** with `sha256:`, `signature:`, and `signed_by:` lines stripped out. This means:

1. Any change to the skill content (instructions, payloads, metadata) invalidates the hash
2. The signing fields themselves are excluded so re-signing doesn't change the hash
3. Changing `name`, `tags`, `tech_stack`, or any other frontmatter field also invalidates the hash

### What is Signed

The Ed25519 signature is computed over the **hex-encoded SHA-256 hash string**, not the raw content. This is a two-step process:

```
content (minus signing fields) → SHA-256 hex string → Ed25519 sign
```

## Maintainer Operations

### First-Time Setup (Generate Keypair + Sign)

```bash
bun run packages/cyberstrike/script/sign-skills.ts --generate
```

This will:

1. Generate a new Ed25519 keypair
2. Save the private key to `.skill-signing-key`
3. Embed the public key in `packages/cyberstrike/src/skill/signing.ts`
4. Add `.skill-signing-key` to `.gitignore` (if not already present)
5. Sign all skills in `.cyberstrike/skill/`

### Re-Sign All Skills (After Content Changes)

```bash
bun run packages/cyberstrike/script/sign-skills.ts
```

Reads the private key from `.skill-signing-key` (or `CYBERSTRIKE_SKILL_PRIVATE_KEY` env var) and signs all skills.

### Sign with Environment Variable

```bash
CYBERSTRIKE_SKILL_PRIVATE_KEY="<base64-pkcs8-key>" bun run packages/cyberstrike/script/sign-skills.ts
```

Useful for CI/CD pipelines where the private key is stored as a secret.

### Verify Skills (CLI)

```bash
cyberstrike skill verify              # verify all skills
cyberstrike skill verify wstg-inpv-05 # verify a specific skill
```

### Verify Skills (API)

```
POST /skill/wstg-inpv-05/verify
→ { "name": "wstg-inpv-05", "verified": "official" }
```

## Threat Model

### What This Protects Against

| Threat                                               | Protection                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Tampered official skill (modified content)           | SHA-256 hash mismatch → "tampered" → blocked                                    |
| Forged signature (attacker signs with different key) | Ed25519 verify fails against embedded public key → "tampered" → blocked         |
| Malicious community skill pretending to be official  | No valid signature for `signed_by: cyberstrike-official` → "tampered" → blocked |
| Supply chain attack on skill registry                | Downloaded skills must pass signature verification                              |

### What This Does NOT Protect Against

| Threat                                                | Reason                                                     | Mitigation                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| User modifying their own binary to replace public key | Open source — user has full control over their binary      | This is self-harm, not an attack vector. Cannot harm other users.          |
| Compromised private key                               | Attacker could sign malicious skills as official           | Rotate keypair, re-sign all skills, publish new binary with new public key |
| Malicious community skills (not signed)               | Community skills are loaded as "unverified" — no guarantee | User sees "unverified" badge, can review content before loading            |

### Trust Model

This follows the same trust model as GPG package signing, Apple codesign, and npm package provenance:

- **The binary is the trust anchor** — the public key embedded in the published binary is the root of trust
- **The private key is the authority** — only the CyberStrike maintainer team can sign skills as official
- **Verification is offline** — no network request needed, works in air-gapped pentest environments
- **The user decides** — unverified/community skills can still be loaded, the system informs rather than blocks (only "tampered" is blocked)

## Key Rotation

If the private key is compromised or needs rotation:

```bash
# 1. Generate new keypair (overwrites old public key in signing.ts)
bun run packages/cyberstrike/script/sign-skills.ts --generate

# 2. Re-sign all skills with new key
# (already done by --generate)

# 3. Commit the new public key and re-signed skills
git add packages/cyberstrike/src/skill/signing.ts .cyberstrike/skill/
git commit -m "chore: rotate skill signing keypair"

# 4. Publish new binary with updated public key
# Follow standard release process (beta → test → latest)

# 5. Securely delete old private key and back up new one
```

After rotation, skills signed with the old key will show as "tampered" in new binaries. This is intentional — it forces re-download of properly signed skills.

## File Reference

| File                                              | Purpose                                                      |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `packages/cyberstrike/src/skill/signing.ts`       | Verification engine + embedded public key                    |
| `packages/cyberstrike/src/skill/skill.ts`         | Calls `verify()` on skill load, blocks tampered              |
| `packages/cyberstrike/script/sign-skills.ts`      | Maintainer tool: generate keypair + sign all skills          |
| `.skill-signing-key`                              | Private key (gitignored)                                     |
| `.cyberstrike/skill/*/SKILL.md`                   | Signed skills with sha256/signature/signed_by in frontmatter |
| `packages/cyberstrike/src/cli/cmd/skill.ts`       | CLI `cyberstrike skill verify` command                       |
| `packages/cyberstrike/src/server/routes/skill.ts` | REST `POST /skill/:name/verify` endpoint                     |
