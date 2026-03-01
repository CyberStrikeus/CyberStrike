export const logo = [
  "  ___  _  _  ___  ___  ___  ___  ___  ___  ___  _  _  ___",
  " / __|| || || _ )| __|| _ \\/ __||_ _|| _ \\|_ _|| |/ /| __|",
  "| (__ |_  _|| _ \\| _| |   /\\__ \\ | | |   / | | |   < | _|",
  " \\___| |_| |___/|___||_|_\\|___/ |_| |_|_\\|___||_|\\_\\|___|",
]

// Default color for CLI output (non-TUI contexts like --help)
const DEFAULT_COLOR = "#00d2ff"

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Colorize logo for ANSI terminal output (used by CLI --help) */
export function colorize(): string[] {
  const [r, g, b] = hexToRgb(DEFAULT_COLOR)
  return logo.map((line) => `\x1b[38;2;${r};${g};${b}m${line}\x1b[0m`)
}
