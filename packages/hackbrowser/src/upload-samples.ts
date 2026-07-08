// Minimal-but-VALID sample files for the file-selector feature. Each carries real
// magic bytes (verified with `file`) so server-side upload validation passes and
// the upload flow — and its endpoint — is actually exercised.
//
// Embedded as base64/text constants (not read from disk) so they survive a Bun
// `--compile` single binary, where BunFS has no on-disk files — the same bundling
// rationale as navigator.ts's plannerPromptText.

// Playwright's setInputFiles/setFiles requires a real Node Buffer (a plain
// Uint8Array is both rejected by the protocol at runtime AND not assignable to
// its `Buffer` param at compile time). Bun provides Buffer globally at runtime;
// the package's own tsconfig ships no node types (`types: []`), so we reach
// BufferConstructor through a typed globalThis cast — typed to return the real
// `Buffer`, which the workspace typecheck (with node types) resolves and the
// standalone build tolerates via the cast — rather than pulling @types/node.
const nodeBuffer = (globalThis as unknown as { Buffer: { from(input: string, encoding: string): Buffer } }).Buffer
const b64 = (s: string): Buffer => nodeBuffer.from(s, "base64")
const txt = (s: string): Buffer => nodeBuffer.from(s, "utf8")

export interface UploadSample {
  name: string
  ext: string
  mimeType: string
  buffer: Buffer
}

// Order matters: pickSample returns the first sample matching any accept token,
// so the most common upload targets (image, then document, then data) come first.
const SAMPLES: readonly UploadSample[] = [
  {
    name: "sample.png",
    ext: "png",
    mimeType: "image/png",
    buffer: b64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGJgAQAAAAUAAaX2RUAAAAAASUVORK5CYII="),
  },
  {
    name: "sample.jpg",
    ext: "jpg",
    mimeType: "image/jpeg",
    buffer: b64(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==",
    ),
  },
  {
    name: "sample.pdf",
    ext: "pdf",
    mimeType: "application/pdf",
    buffer: b64(
      "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDIwMF0+PmVuZG9iagp0cmFpbGVyPDwvUm9vdCAxIDAgUj4+CiUlRU9GCg==",
    ),
  },
  { name: "sample.csv", ext: "csv", mimeType: "text/csv", buffer: txt("name,email\nTest User,test@example.com\n") },
  { name: "sample.txt", ext: "txt", mimeType: "text/plain", buffer: txt("sample text file\n") },
  { name: "sample.json", ext: "json", mimeType: "application/json", buffer: txt('{"sample":true,"value":123}\n') },
]

/** png — the most common upload target — is the fallback when `accept` is absent or unmatched. */
const DEFAULT_SAMPLE = SAMPLES[0]!

/** Does a sample satisfy one `accept` token (a MIME type, a `type/*` wildcard, or a `.ext`)? */
function tokenMatches(sample: UploadSample, token: string): boolean {
  const t = token.trim().toLowerCase()
  if (!t) return false
  if (t.startsWith(".")) return t.slice(1) === sample.ext
  if (t.endsWith("/*")) return sample.mimeType.startsWith(t.slice(0, -1)) // "image/*" → "image/"
  return t === sample.mimeType
}

/**
 * Pick a bundled sample whose type satisfies the file input's `accept` attribute.
 * Structural (parses `accept`, matches against sample metadata) — no per-site rules.
 * Falls back to png when `accept` is empty (no restriction) or unmatched.
 */
export function pickSample(accept: string | null | undefined): UploadSample {
  if (!accept || !accept.trim()) return DEFAULT_SAMPLE
  const tokens = accept.split(",")
  for (const sample of SAMPLES) {
    if (tokens.some((tok) => tokenMatches(sample, tok))) return sample
  }
  return DEFAULT_SAMPLE
}
