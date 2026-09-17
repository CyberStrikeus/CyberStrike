export type HexColor = `#${string}`

export interface OklchColor {
  l: number // Lightness 0-1
  c: number // Chroma 0-0.4+
  h: number // Hue 0-360
}

export interface ThemeSeedColors {
  neutral: HexColor
  primary: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  interactive: HexColor
  diffAdd: HexColor
  diffDelete: HexColor
}

export interface ThemePaletteColors {
  neutral: HexColor
  ink: HexColor
  primary: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  accent?: HexColor
  interactive?: HexColor
  diffAdd?: HexColor
  diffDelete?: HexColor
}

export interface ThemeVariant {
  // A variant supplies EITHER `seeds` (v1 fork themes) or `palette` (upstream v2
  // themes); both resolvers accept either and derive the missing shape from the
  // one present (see theme/resolve.ts `seedsOf` and theme/v2/resolve.ts
  // `readPalette`). At least one must be present.
  seeds?: ThemeSeedColors
  // v2 palette input for the v2 primitive-ramp generator (see theme/v2/resolve.ts).
  palette?: ThemePaletteColors
  overrides?: Record<string, ColorValue>
  v2Overrides?: Record<string, V2ColorValue>
}

export interface DesktopTheme {
  $schema?: string
  name: string
  id: string
  light: ThemeVariant
  dark: ThemeVariant
}

export type TokenCategory =
  | "background"
  | "surface"
  | "text"
  | "border"
  | "icon"
  | "input"
  | "button"
  | "syntax"
  | "markdown"
  | "diff"
  | "avatar"

export type ThemeToken = string

export type CssVarRef = `var(--${string})`

export type ColorValue = HexColor | CssVarRef

export type V2ColorValue = HexColor | CssVarRef | string

export type ResolvedTheme = Record<ThemeToken, ColorValue>

export type ResolvedV2Theme = Record<string, V2ColorValue>
