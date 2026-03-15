import { RGBA } from "@opentui/core"
import { createMemo, For } from "solid-js"
import { logo } from "@/cli/logo"
import { useTheme } from "@tui/context/theme"

function lerpRGBA(a: RGBA, b: RGBA, t: number): RGBA {
  return RGBA.fromInts(
    Math.round((a.r + (b.r - a.r) * t) * 255),
    Math.round((a.g + (b.g - a.g) * t) * 255),
    Math.round((a.b + (b.b - a.b) * t) * 255),
  )
}

export function Logo() {
  const { theme } = useTheme()

  const stops = createMemo(() => [theme.primary, theme.accent])

  return (
    <box>
      <For each={logo}>
        {(line, index) => {
          const color = createMemo(() => {
            const t = logo.length > 1 ? index() / (logo.length - 1) : 0
            const s = stops()
            return lerpRGBA(s[0], s[1], t)
          })
          return (
            <box flexDirection="row">
              <text fg={color()} selectable={false}>
                {line}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}
