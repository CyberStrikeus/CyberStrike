// @refresh reload

import { generateNeutralScale, hexToOklch, oklchToHexFit, shift } from "../color"
import { mapV2Foreground } from "./foreground"
import { mapV2Semantics, mergeV2Tokens } from "./mapping"
import type { DesktopTheme, HexColor, ResolvedV2Theme, ThemeVariant, V2ColorValue } from "../types"
import { V2_PRIMITIVES_DEFAULT } from "./default-primitives"

const V2_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200] as const

interface PaletteInput {
  neutral: HexColor
  ink: HexColor
  primary: HexColor
  accent: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  interactive: HexColor
  diffAdd: HexColor
  diffDelete: HexColor
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

/** v2 ramps: 100 = lightest, 1200 = darkest — wider spread than v1 `generateScale`. */
function generateV2HueScale(seed: HexColor, isDark: boolean): HexColor[] {
  const base = hexToOklch(seed)
  const chromaBoost = isDark ? 1 : 1.05
  const lightSteps = [
    0.99,
    0.965,
    0.93,
    0.885,
    0.835,
    clamp(base.l, 0.48, 0.72),
    clamp(base.l - 0.07, 0.4, 0.64),
    clamp(base.l - 0.14, 0.32, 0.55),
    clamp(base.l - 0.21, 0.24, 0.46),
    clamp(base.l - 0.28, 0.17, 0.38),
    clamp(base.l - 0.34, 0.12, 0.3),
    clamp(base.l - 0.4, 0.08, 0.22),
  ]
  const chromaMultipliers = [0.28, 0.48, 0.68, 0.86, 1.02, 1.28, 1.34, 1.28, 1.18, 1.08, 0.98, 0.88]

  return lightSteps.map((l, i) =>
    oklchToHexFit({
      l,
      c: base.c * chromaMultipliers[i]! * chromaBoost,
      h: base.h,
    }),
  )
}

/** Grey ramp: 100 = lightest, 1200 = darkest. Derived from palette neutral → ink like v1. */
function generateV2NeutralScale(neutral: HexColor, ink: HexColor, isDark: boolean): HexColor[] {
  const scale = generateNeutralScale(neutral, isDark, ink)
  return isDark ? scale.toReversed() : scale
}

function assignHueRamp(prefix: string, scale: HexColor[]): Record<string, V2ColorValue> {
  const tokens: Record<string, V2ColorValue> = {}
  for (let i = 0; i < V2_STEPS.length; i++) {
    tokens[`v2-${prefix}-${V2_STEPS[i]}`] = scale[i]!
  }
  return tokens
}

/**
 * Derive a v2 background/ink pair from a v1 seed neutral. v1 seeds carry a single
 * mid-tone `neutral`; the v2 grey ramp instead needs an extreme background tone
 * plus an opposite ink tone (see palette themes' neutral/ink). We push the seed's
 * lightness to the mode-appropriate extreme while keeping its hue and a little of
 * its chroma, so each theme's grey ramp stays faintly tinted (e.g. cs-1's warm
 * grey stays near-neutral, a bluish neutral stays cool) but spans the full range.
 */
function seedTone(neutral: HexColor, l: number): HexColor {
  const base = hexToOklch(neutral)
  return oklchToHexFit({ l, c: Math.min(base.c, 0.02), h: base.h })
}

/**
 * Amplify a dark background's chroma so each theme's neutral hue actually reads as
 * chrome instead of collapsing to the same near-black. Palette neutrals of dark
 * themes carry real but tiny chroma (e.g. github 0.014, matrix 0.011, dracula
 * 0.019); at background lightness that low chroma is imperceptible, so cobalt2,
 * github, matrix, everforest, rosepine, … all rendered as an identical neutral
 * near-black even though their hues differ. Upstream's shared neutral-scale math
 * (faithfully ported in color.ts / this file) has the same limitation, so this is
 * a deliberate v2 divergence: scale the neutral's chroma up (capped) so the hue
 * registers, preserving its lightness and hue exactly.
 *
 * Genuinely achromatic neutrals stay untouched via `GATE` — cs-1's warm grey
 * (chroma ~0.006) falls below it, so the default theme resolves byte-identically.
 * Only dark mode is adjusted; light chrome does not collapse and is left as-is.
 */
const BG_TINT_GATE = 0.009
const BG_TINT_FACTOR = 3
const BG_TINT_CAP = 0.05
function tintBackground(neutral: HexColor, isDark: boolean): HexColor {
  if (!isDark) return neutral
  const base = hexToOklch(neutral)
  if (base.c < BG_TINT_GATE) return neutral
  return oklchToHexFit({ l: base.l, c: Math.min(base.c * BG_TINT_FACTOR, BG_TINT_CAP), h: base.h })
}

function readPalette(variant: ThemeVariant, isDark: boolean): PaletteInput {
  if ("palette" in variant && variant.palette) {
    const palette = variant.palette
    return {
      neutral: tintBackground(palette.neutral, isDark),
      ink: palette.ink,
      primary: palette.primary,
      accent: palette.accent ?? palette.info,
      success: palette.success,
      warning: palette.warning,
      error: palette.error,
      info: palette.info,
      interactive: palette.interactive ?? palette.primary,
      diffAdd: palette.diffAdd ?? shift(palette.success, { c: 0.55, l: 0.14 }),
      diffDelete: palette.diffDelete ?? palette.error,
    }
  }
  if ("seeds" in variant && variant.seeds) {
    const seeds = variant.seeds
    return {
      neutral: tintBackground(seedTone(seeds.neutral, isDark ? 0.17 : 0.985), isDark),
      ink: seedTone(seeds.neutral, isDark ? 0.96 : 0.16),
      primary: seeds.primary,
      accent: seeds.interactive,
      success: seeds.success,
      warning: seeds.warning,
      error: seeds.error,
      info: seeds.info,
      interactive: seeds.interactive,
      diffAdd: seeds.diffAdd,
      diffDelete: seeds.diffDelete,
    }
  }
  throw new Error("Theme variant requires `palette` or `seeds`")
}

/** Build v2 primitive ramps (100 = lightest). Alpha ramps are static in `v2/styles/colors.css`. */
export function generateV2Primitives(variant: ThemeVariant, isDark: boolean): Record<string, V2ColorValue> {
  const colors = readPalette(variant, isDark)
  const grey = generateV2NeutralScale(colors.neutral, colors.ink, isDark)
  const blue = generateV2HueScale(colors.interactive, isDark)
  const green = generateV2HueScale(colors.success, isDark)
  const yellow = generateV2HueScale(colors.warning, isDark)
  const red = generateV2HueScale(colors.error, isDark)
  const purple = generateV2HueScale(colors.accent, isDark)
  const pink = generateV2HueScale(colors.info, isDark)
  const orange = generateV2HueScale(shift(colors.warning, { h: -22, l: -0.082, c: 0.94 }), isDark)
  const cyan = generateV2HueScale(shift(colors.info, { h: -12, l: 0.128, c: 1.12 }), isDark)

  return {
    ...V2_PRIMITIVES_DEFAULT,
    ...assignHueRamp("grey", grey),
    ...assignHueRamp("blue", blue),
    ...assignHueRamp("green", green),
    ...assignHueRamp("yellow", yellow),
    ...assignHueRamp("red", red),
    ...assignHueRamp("purple", purple),
    ...assignHueRamp("pink", pink),
    ...assignHueRamp("orange", orange),
    ...assignHueRamp("cyan", cyan),
  }
}

export function resolveThemeVariantV2(variant: ThemeVariant, isDark: boolean): ResolvedV2Theme {
  const primitives = generateV2Primitives(variant, isDark)
  const semantics = mapV2Semantics(isDark)
  const foreground = mapV2Foreground(readPalette(variant, isDark).ink, isDark, primitives, variant.overrides)
  return mergeV2Tokens(primitives, semantics, foreground, variant.v2Overrides ?? {})
}

export function resolveThemeV2(theme: DesktopTheme): { light: ResolvedV2Theme; dark: ResolvedV2Theme } {
  return {
    light: resolveThemeVariantV2(theme.light, false),
    dark: resolveThemeVariantV2(theme.dark, true),
  }
}

export function themeV2ToCss(tokens: ResolvedV2Theme): string {
  return Object.entries(tokens)
    .map(([key, value]) => `--${key}: ${value};`)
    .join("\n  ")
}
