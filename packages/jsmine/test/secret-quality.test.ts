// Secret-detection QUALITY audit (issue #22, sub-task 3). A labeled corpus of realistic secret
// shapes (positives — synthetic, format-only values) and real minified-bundle noise (negatives — FP
// traps). Measures RECALL (positives caught) and PRECISION (negatives NOT flagged) for jsmine's
// mine().secrets, and prints a per-category report. Precision on the negative corpus is a HARD gate
// (0 false positives); recall is asserted per high-confidence vendor shape.
//
// Values are synthetic and format-valid but not real credentials (AWS's own documented example key,
// repeated/patterned filler). Never paste a real secret here.
import { describe, expect, test } from "bun:test"
import { mine } from "../src/jsmine"

// A positive: `find` is the secret substring mine() must surface from `code`.
interface Pos { name: string; code: string; find: string }
// A negative: mine() must surface NO secret from `code`.
interface Neg { name: string; code: string }

const b64 = (n: number) => "aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789".repeat(4).slice(0, n)
const hex = (n: number) => "0123456789abcdef".repeat(8).slice(0, n)

// --- positives: one realistic shape per vendor/class ---------------------------------------------
const AWS_ID = "AKIAIOSFODNN7EXAMPLE"
const AWS_TMP = "ASIA" + "IOSFODNN7EXAMPLE"
const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" // 40 chars
const GOOGLE_API = "AIza" + b64(35)
const GOOGLE_OAUTH_ID = "123456789012-" + "a".repeat(32) + ".apps.googleusercontent.com"
const GOOGLE_OAUTH_SECRET = "GOCSPX-" + b64(28)
const STRIPE_LIVE = "sk_live_" + b64(24)
const STRIPE_TEST = "sk_test_" + b64(24)
const STRIPE_RESTRICTED = "rk_live_" + b64(24)
const GH_CLASSIC = "ghp_" + b64(36)
const GH_FINE = "github_pat_" + b64(22) + "_" + b64(59)
const GITLAB = "glpat-" + b64(20)
const SLACK_TOKEN = "xoxb-" + "123456789012-1234567890123-" + b64(24)
const SLACK_HOOK = "https://hooks.slack.com/services/T00000000/B00000000/" + b64(24)
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36"
const RSA_KEY = "-----BEGIN RSA PRIVATE KEY-----"
const OPENSSH_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----"
const GCP_KEY = "-----BEGIN PRIVATE KEY-----"
const NPM = "npm_" + b64(36)
const OPENAI = "sk-" + b64(48)
const SENDGRID = "SG." + b64(22) + "." + b64(43)
const TWILIO_SK = "SK" + hex(32)
const MAILGUN = "key-" + hex(32)
const DIGITALOCEAN = "dop_v1_" + hex(64)
const SHOPIFY = "shpat_" + hex(32)
const MONGO = "mongodb+srv://admin:s3cretP4ss@cluster0.mongodb.net/db"
const POSTGRES = "postgres://dbuser:hunter2xyz@db.internal:5432/app"
const BASIC_AUTH = "https://svcuser:sup3rs3cret@api.internal.example/v1"
const ENTROPY_TOKEN = "kThP9xQ2mV7nR4wZ8bL1cY6dF3gJ5aX" // high-entropy, no vendor prefix
const NAMED_HEX = "d41d8cd98f00b204e9800998" // apiKey:"<md5-ish>" — named-assignment path

const POSITIVES: Pos[] = [
  { name: "aws-access-key-id", code: `var e="${AWS_ID}"`, find: AWS_ID },
  { name: "aws-temp-key (ASIA)", code: `t("${AWS_TMP}")`, find: AWS_TMP },
  { name: "aws-secret-access-key", code: `aws_secret_access_key:"${AWS_SECRET}"`, find: AWS_SECRET },
  { name: "google-api-key", code: `k="${GOOGLE_API}"`, find: GOOGLE_API },
  { name: "google-oauth-client-id", code: `client_id:"${GOOGLE_OAUTH_ID}"`, find: GOOGLE_OAUTH_ID },
  { name: "google-oauth-client-secret", code: `s="${GOOGLE_OAUTH_SECRET}"`, find: GOOGLE_OAUTH_SECRET },
  { name: "stripe-live", code: `Stripe("${STRIPE_LIVE}")`, find: STRIPE_LIVE },
  { name: "stripe-test", code: `k="${STRIPE_TEST}"`, find: STRIPE_TEST },
  { name: "stripe-restricted", code: `k="${STRIPE_RESTRICTED}"`, find: STRIPE_RESTRICTED },
  { name: "github-classic", code: `t="${GH_CLASSIC}"`, find: GH_CLASSIC },
  { name: "github-fine-grained", code: `t="${GH_FINE}"`, find: GH_FINE },
  { name: "gitlab-pat", code: `t="${GITLAB}"`, find: GITLAB },
  { name: "slack-token", code: `t="${SLACK_TOKEN}"`, find: SLACK_TOKEN },
  { name: "slack-webhook", code: `u="${SLACK_HOOK}"`, find: SLACK_HOOK },
  { name: "jwt", code: `a="${JWT}"`, find: JWT },
  { name: "rsa-private-key", code: `k=\`${RSA_KEY}`, find: RSA_KEY },
  { name: "openssh-private-key", code: `k=\`${OPENSSH_KEY}`, find: OPENSSH_KEY },
  { name: "gcp-private-key", code: `k=\`${GCP_KEY}`, find: GCP_KEY },
  { name: "npm-token", code: `t="${NPM}"`, find: NPM },
  { name: "openai-key", code: `k="${OPENAI}"`, find: OPENAI },
  { name: "sendgrid-key", code: `k="${SENDGRID}"`, find: SENDGRID },
  { name: "twilio-api-key", code: `k="${TWILIO_SK}"`, find: TWILIO_SK },
  { name: "mailgun-key", code: `k="${MAILGUN}"`, find: MAILGUN },
  { name: "digitalocean-token", code: `t="${DIGITALOCEAN}"`, find: DIGITALOCEAN },
  { name: "shopify-token", code: `t="${SHOPIFY}"`, find: SHOPIFY },
  { name: "mongodb-uri", code: `u="${MONGO}"`, find: MONGO },
  { name: "postgres-uri", code: `u="${POSTGRES}"`, find: POSTGRES },
  { name: "basic-auth-url", code: `u="${BASIC_AUTH}"`, find: BASIC_AUTH },
  { name: "entropy-token", code: `x("${ENTROPY_TOKEN}")`, find: ENTROPY_TOKEN },
  { name: "named-hex-assignment", code: `apiKey:"${NAMED_HEX}"`, find: NAMED_HEX },
]

// --- negatives: real minified-bundle noise that must NOT be flagged ------------------------------
const NEGATIVES: Neg[] = [
  { name: "webpack-chunkhash", code: `s=n.p+"static/js/438.7f8a9c2b.chunk.js"` },
  { name: "content-hash-20hex", code: `e.h="a1b2c3d4e5f6a7b8c9d0"` },
  { name: "git-sha-40hex", code: `e.rev="da39a3ee5e6b4b0d3255bfef95601890afd80709"` },
  { name: "sha256-64hex", code: `e.d="${hex(64)}"` },
  { name: "sri-hash", code: `t.integrity="sha384-oqVuAfXRKap7fdgcVY5uykM6RxhSz1yPjYBc8t9xrIXbLQ2wZ3aP4mK"` },
  { name: "uuid", code: `id="550e8400-e29b-41d4-a716-446655440000"` },
  { name: "data-uri", code: `e.icon="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA"` },
  { name: "mime-type", code: `e.mime="application/json"` },
  { name: "version-string", code: `e.ver="4.17.21"` },
  { name: "prose", code: `e.msg="the quick brown fox jumps over the lazy dog"` },
  { name: "css-classes", code: `e.klass="btn btn-primary d-flex align-items-center"` },
  { name: "hostname", code: `e.cdn="cdn.jsdelivr.net"` },
  { name: "placeholder-your", code: `apiKey:"your_api_key_here"` },
  { name: "placeholder-xxx", code: `secret:"xxxxxxxxxxxx"` },
  { name: "placeholder-template", code: `token:"\${ENV_TOKEN}"` },
  { name: "digit-run", code: `phone="12345678901234567890"` },
  { name: "lowercase-word", code: `s="abcdefghijklmnopqrst"` },
  { name: "public-key-not-secret", code: `k=\`-----BEGIN PUBLIC KEY-----` },
  { name: "readable-identifier-assignment", code: `secretKey:"defaultSecretHandler"` },
  { name: "relative-path-not-secret", code: `fetch("/api/v2/orders/items")` },
]

describe("JS secret detection — quality audit (recall + precision)", () => {
  test("REPORT: recall over vendor/cloud shapes, precision over minified noise", () => {
    const missed: string[] = []
    for (const p of POSITIVES) {
      const hit = mine(p.code).secrets.some((s) => s.includes(p.find) || p.find.includes(s))
      if (!hit) missed.push(p.name)
    }
    const falsePos: { name: string; got: string[] }[] = []
    for (const n of NEGATIVES) {
      const got = mine(n.code).secrets
      if (got.length > 0) falsePos.push({ name: n.name, got })
    }
    const recall = ((POSITIVES.length - missed.length) / POSITIVES.length) * 100
    const precision = falsePos.length === 0 ? 100 : ((NEGATIVES.length - falsePos.length) / NEGATIVES.length) * 100
    // eslint-disable-next-line no-console
    console.log(
      `\n=== JS SECRET QUALITY ===\n` +
        `recall   : ${recall.toFixed(1)}%  (${POSITIVES.length - missed.length}/${POSITIVES.length})\n` +
        `precision: ${precision.toFixed(1)}%  (${NEGATIVES.length - falsePos.length}/${NEGATIVES.length} clean)\n` +
        (missed.length ? `MISSED   : ${missed.join(", ")}\n` : `MISSED   : none\n`) +
        (falsePos.length ? `FALSE-POS: ${falsePos.map((f) => f.name).join(", ")}\n` : `FALSE-POS: none\n`),
    )
    // HARD GATE: zero false positives on the negative corpus.
    expect(falsePos).toEqual([])
    // RECALL GATE: high-confidence vendor shapes must all be caught (tune as patterns are added).
    expect(missed).toEqual([])
  })
})
