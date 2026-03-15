export const logo = [
  "   ______      __              _____ __       _ __",
  "  / ____/_  __/ /_  ___  _____/ ___// /______(_) /_____",
  " / /   / / / / __ \\/ _ \\/ ___/\\__ \\/ __/ ___/ / //_/ _ \\",
  "/ /___/ /_/ / /_/ /  __/ /  ___/ / /_/ /  / / ,< /  __/",
  "\\____/\\__, /_.___/\\___/_/  /____/\\__/_/  /_/_/|_|\\___/",
  "     /____/",
]

// Palettes — used by CLI (non-TUI) colorize function
export const palettes = {
  "matrix":    ["#00ff41", "#008f11"],
  "fire":      ["#ff0844", "#ffb199"],
  "forest":    ["#134e5e", "#71b280"],
  "ocean":     ["#667eea", "#764ba2"],
  "sunset":    ["#ff9966", "#ff5e62", "#ffa34e"],
  "dawn":      ["#00c6ff", "#0072ff"],
  "nebula":    ["#654ea3", "#eaafc8"],
  "gold":      ["#f7971e", "#ffd200"],
  "purple":    ["#667db6", "#0082c8", "#0078ff"],
  "mint":      ["#00d2ff", "#3a7bd5"],
  "coral":     ["#ff9a9e", "#fecfef"],
  "grad-blue": ["#4ea8ff", "#7f88ff"],
  "mono":      ["#f07178", "#f07178"],
} as const

export type PaletteName = keyof typeof palettes

// Parse "#rrggbb" to [r, g, b]
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// Interpolate between color stops at position t (0..1)
function interpolate(stops: [number, number, number][], t: number): [number, number, number] {
  if (stops.length === 1) return stops[0]
  const segment = t * (stops.length - 1)
  const i = Math.min(Math.floor(segment), stops.length - 2)
  const f = segment - i
  const a = stops[i]
  const b = stops[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

/**
 * Apply vertical gradient to the logo lines using the given palette.
 * Each line gets a color interpolated from the palette stops.
 * Returns array of ANSI-colored strings.
 */
export function colorize(paletteName?: PaletteName): string[] {
  const name = paletteName ?? randomPalette()
  const colors = palettes[name]
  const stops = colors.map(hexToRgb)

  return logo.map((line, i) => {
    const t = logo.length > 1 ? i / (logo.length - 1) : 0
    const [r, g, b] = interpolate(stops, t)
    return `\x1b[38;2;${r};${g};${b}m${line}\x1b[0m`
  })
}

export function randomPalette(): PaletteName {
  const names = Object.keys(palettes) as PaletteName[]
  return names[Math.floor(Math.random() * names.length)]
}
