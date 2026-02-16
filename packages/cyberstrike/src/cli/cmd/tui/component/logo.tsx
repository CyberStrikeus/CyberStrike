import { For } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import { logo } from "@/cli/logo"

export function Logo() {
  const { theme } = useTheme()

  return (
    <box>
      <For each={logo}>
        {(line, index) => {
          // Vertical gradient: top lines use text color, bottom lines fade toward background
          const t = logo.length > 1 ? index() / (logo.length - 1) : 0
          const color = tint(theme.background, theme.text, 1 - t * 0.6)
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
