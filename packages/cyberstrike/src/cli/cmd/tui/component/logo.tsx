import { RGBA } from "@opentui/core"
import { For } from "solid-js"
import { logo, palettes, randomPalette } from "@/cli/logo"

// Pick a random palette once per app launch
const chosen = randomPalette()
const stops = palettes[chosen].map((hex) => RGBA.fromHex(hex))

function lerpRGBA(a: RGBA, b: RGBA, t: number): RGBA {
  return RGBA.fromInts(
    Math.round((a.r + (b.r - a.r) * t) * 255),
    Math.round((a.g + (b.g - a.g) * t) * 255),
    Math.round((a.b + (b.b - a.b) * t) * 255),
  )
}

function interpolate(colors: RGBA[], t: number): RGBA {
  if (colors.length === 1) return colors[0]
  const segment = t * (colors.length - 1)
  const i = Math.min(Math.floor(segment), colors.length - 2)
  const f = segment - i
  return lerpRGBA(colors[i], colors[i + 1], f)
}

export function Logo() {
  return (
    <box>
      <For each={logo}>
        {(line, index) => {
          const t = logo.length > 1 ? index() / (logo.length - 1) : 0
          const color = interpolate(stops, t)
          return (
            <box flexDirection="row">
              <text fg={color} selectable={false}>
                {line}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}
