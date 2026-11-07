export const CMD_PROBES: { cmd: string; marker: RegExp; os: string }[] = [
  { cmd: "id", marker: /\buid=\d+\(/i, os: "unix" },
  { cmd: "i''d", marker: /\buid=\d+\(/i, os: "unix" },
  { cmd: "i\\d", marker: /\buid=\d+\(/i, os: "unix" },
  { cmd: "ver", marker: /windows \[version/i, os: "windows" },
  { cmd: "v^er", marker: /windows \[version/i, os: "windows" },
]

export const CMD_SEPARATORS: { name: string; wrap: (c: string) => string }[] = [
  { name: ";", wrap: (c) => `;${c}` },
  { name: "|", wrap: (c) => `|${c}` },
  { name: "&&", wrap: (c) => `&& ${c}` },
  { name: "||", wrap: (c) => `|| ${c}` },
  { name: "& (win)", wrap: (c) => `& ${c}` },
  { name: "$( )", wrap: (c) => `$(${c})` },
  { name: "` `", wrap: (c) => `\`${c}\`` },
  { name: "newline", wrap: (c) => `\n${c}` },
  { name: "'; (quote-close)", wrap: (c) => `'; ${c}` },
  { name: '"; (quote-close)', wrap: (c) => `"; ${c}` },
]

export const CMD_NOT_TESTED = [
  "blind/time-based command injection (no command output reflected in the response)",
  "out-of-band command injection (DNS/HTTP callback)",
  "commands beyond the read-only id/ver probes (this tool never sends network/file/write/delay commands)",
  "non-query/non-form injection points (path, header, cookie, JSON, XML, GraphQL, multipart)",
]
