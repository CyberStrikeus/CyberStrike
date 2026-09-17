import type { HexColor, OklchColor } from "./types"

export function hexToRgb(hex: HexColor): { r: number; g: number; b: number } {
  const h = hex.replace("#", "")
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h

  const num = parseInt(full, 16)
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  }
}

export function rgbToHex(r: number, g: number, b: number): HexColor {
  const toHex = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    const int = Math.round(clamped * 255)
    return int.toString(16).padStart(2, "0")
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return c * 12.92
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function srgbToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92
  return Math.pow((c + 0.055) / 1.055, 2.4)
}

export function rgbToOklch(r: number, g: number, b: number): OklchColor {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)

  const l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s_ = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb

  const l = Math.cbrt(l_)
  const m = Math.cbrt(m_)
  const s = Math.cbrt(s_)

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bOk = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  const C = Math.sqrt(a * a + bOk * bOk)
  let H = Math.atan2(bOk, a) * (180 / Math.PI)
  if (H < 0) H += 360

  return { l: L, c: C, h: H }
}

export function oklchToRgb(oklch: OklchColor): { r: number; g: number; b: number } {
  const { l: L, c: C, h: H } = oklch

  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)

  const l = L + 0.3963377774 * a + 0.2158037573 * b
  const m = L - 0.1055613458 * a - 0.0638541728 * b
  const s = L - 0.0894841775 * a - 1.291485548 * b

  const l3 = l * l * l
  const m3 = m * m * m
  const s3 = s * s * s

  const lr = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3

  return {
    r: linearToSrgb(lr),
    g: linearToSrgb(lg),
    b: linearToSrgb(lb),
  }
}

export function hexToOklch(hex: HexColor): OklchColor {
  const { r, g, b } = hexToRgb(hex)
  return rgbToOklch(r, g, b)
}

function hue(v: number) {
  return ((v % 360) + 360) % 360
}

/**
 * Gamut-map an OKLCH color into sRGB by reducing chroma until it fits, keeping
 * lightness and hue. Ported from upstream/dev. Prevents per-channel clipping
 * (which shifts hue, e.g. blue → cyan) when a generated ramp step is out of the
 * sRGB gamut. For in-gamut colors this is an exact no-op, so v1 rendering — whose
 * seeds/steps stay in gamut — is unchanged.
 */
export function fitOklch(oklch: OklchColor): OklchColor {
  const base = {
    l: Math.max(0, Math.min(1, oklch.l)),
    c: Math.max(0, oklch.c),
    h: hue(oklch.h),
  }

  const rgb = oklchToRgb(base)
  if (rgb.r >= 0 && rgb.r <= 1 && rgb.g >= 0 && rgb.g <= 1 && rgb.b >= 0 && rgb.b <= 1) {
    return base
  }

  let c = base.c
  for (let i = 0; i < 24; i++) {
    c *= 0.9
    const next = { ...base, c }
    const out = oklchToRgb(next)
    if (out.r >= 0 && out.r <= 1 && out.g >= 0 && out.g <= 1 && out.b >= 0 && out.b <= 1) {
      return next
    }
  }

  return { ...base, c: 0 }
}

export function oklchToHex(oklch: OklchColor): HexColor {
  const { r, g, b } = oklchToRgb(oklch)
  return rgbToHex(r, g, b)
}

/** v2-only: gamut-fitted OKLCH → hex (see fitOklch). Keeps v1 oklchToHex raw. */
export function oklchToHexFit(oklch: OklchColor): HexColor {
  return oklchToHex(fitOklch(oklch))
}

export function generateScale(seed: HexColor, isDark: boolean): HexColor[] {
  const base = hexToOklch(seed)
  const scale: HexColor[] = []

  const lightSteps = isDark
    ? [0.15, 0.18, 0.22, 0.26, 0.32, 0.38, 0.46, 0.56, base.l, base.l - 0.05, 0.75, 0.93]
    : [0.99, 0.97, 0.94, 0.9, 0.85, 0.79, 0.72, 0.64, base.l, base.l + 0.05, 0.45, 0.25]

  const chromaMultipliers = isDark
    ? [0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1, 1, 0.9, 0.6]
    : [0.1, 0.15, 0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1, 1, 0.95, 0.85]

  for (let i = 0; i < 12; i++) {
    scale.push(
      oklchToHex({
        l: lightSteps[i],
        c: base.c * chromaMultipliers[i],
        h: base.h,
      }),
    )
  }

  return scale
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

/**
 * v2-only overload: when `ink` is supplied, derives the neutral ramp by mixing
 * toward `ink` (used by theme/v2/resolve.ts for palette-based v2 themes). Ported
 * from upstream/dev's generateNeutralScale. The 2-arg call (no `ink`) is used by
 * v1 theme resolution and keeps our own CyberStrike-tuned curve below unchanged.
 */
export function generateNeutralScale(seed: HexColor, isDark: boolean, ink?: HexColor): HexColor[] {
  if (ink) {
    const base = hexToOklch(seed)
    const lift = (tone: number) =>
      oklchToHex({
        l: base.l + (1 - base.l) * tone,
        c: base.c * Math.max(0, 1 - tone),
        h: base.h,
      })
    const sink = (tone: number) =>
      oklchToHex({
        l: base.l * (1 - tone),
        c: base.c * Math.max(0, 1 - tone * (isDark ? 0.12 : 0.3)),
        h: base.h,
      })
    const bg = isDark
      ? sink(clamp(0.19 + Math.max(0, base.l - 0.12) * 0.33 + base.c * 1.95, 0.17, 0.27))
      : base.l < 0.82
        ? lift(0.86)
        : lift(clamp(0.1 + base.c * 3.2 + Math.max(0, 0.95 - base.l) * 0.35, 0.1, 0.28))
    const steps = isDark
      ? [0, 0.018, 0.039, 0.064, 0.097, 0.143, 0.212, 0.31, 0.46, 0.649, 0.845, 0.984]
      : [0, 0.022, 0.042, 0.068, 0.102, 0.146, 0.208, 0.296, 0.432, 0.61, 0.81, 0.965]
    return steps.map((step) => mixColors(bg, ink, step))
  }

  const base = hexToOklch(seed)
  const scale: HexColor[] = []
  const neutralChroma = Math.min(base.c, 0.02)

  const lightSteps = isDark
    ? [0.13, 0.16, 0.2, 0.24, 0.28, 0.33, 0.4, 0.52, 0.58, 0.66, 0.82, 0.96]
    : [0.995, 0.98, 0.96, 0.94, 0.91, 0.88, 0.84, 0.78, 0.62, 0.56, 0.46, 0.2]

  for (let i = 0; i < 12; i++) {
    scale.push(
      oklchToHex({
        l: lightSteps[i],
        c: neutralChroma,
        h: base.h,
      }),
    )
  }

  return scale
}

export function generateAlphaScale(scale: HexColor[], isDark: boolean): HexColor[] {
  const alphas = isDark
    ? [0.02, 0.04, 0.08, 0.12, 0.16, 0.2, 0.26, 0.36, 0.44, 0.52, 0.76, 0.96]
    : [0.01, 0.03, 0.06, 0.09, 0.12, 0.15, 0.2, 0.28, 0.48, 0.56, 0.64, 0.88]

  return scale.map((hex, i) => {
    const { r, g, b } = hexToRgb(hex)
    const a = alphas[i]

    const bg = isDark ? 0 : 1
    const blendedR = r * a + bg * (1 - a)
    const blendedG = g * a + bg * (1 - a)
    const blendedB = b * a + bg * (1 - a)

    return rgbToHex(blendedR, blendedG, blendedB)
  })
}

export function mixColors(color1: HexColor, color2: HexColor, amount: number): HexColor {
  const c1 = hexToOklch(color1)
  const c2 = hexToOklch(color2)

  return oklchToHex({
    l: c1.l + (c2.l - c1.l) * amount,
    c: c1.c + (c2.c - c1.c) * amount,
    h: c1.h + (c2.h - c1.h) * amount,
  })
}

export function lighten(color: HexColor, amount: number): HexColor {
  const oklch = hexToOklch(color)
  return oklchToHex({
    ...oklch,
    l: Math.min(1, oklch.l + amount),
  })
}

export function darken(color: HexColor, amount: number): HexColor {
  const oklch = hexToOklch(color)
  return oklchToHex({
    ...oklch,
    l: Math.max(0, oklch.l - amount),
  })
}

export function withAlpha(color: HexColor, alpha: number): string {
  const { r, g, b } = hexToRgb(color)
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}

// v2-only helpers below (theme/v2/*) — ported from upstream/dev, additive.

export function shift(color: HexColor, value: { l?: number; c?: number; h?: number }): HexColor {
  const base = hexToOklch(color)
  return oklchToHex({
    l: base.l + (value.l ?? 0),
    c: base.c * (value.c ?? 1),
    h: base.h + (value.h ?? 0),
  })
}

export function contrastRatio(foreground: HexColor, background: HexColor) {
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = (hex: HexColor) => {
    const { r, g, b } = hexToRgb(hex)
    return 0.2126 * linear(r) + 0.587 * linear(g) + 0.0722 * linear(b)
  }
  const fg = luminance(foreground)
  const bg = luminance(background)
  const lighter = Math.max(fg, bg)
  const darker = Math.min(fg, bg)
  return (lighter + 0.05) / (darker + 0.05)
}

export function blend(color: HexColor, background: HexColor, alpha: number): HexColor {
  const fg = hexToRgb(color)
  const bg = hexToRgb(background)
  return rgbToHex(
    fg.r * alpha + bg.r * (1 - alpha),
    fg.g * alpha + bg.g * (1 - alpha),
    fg.b * alpha + bg.b * (1 - alpha),
  )
}
