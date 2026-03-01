import { For } from "solid-js"
import { logo } from "@/cli/logo"
import { useTheme } from "@tui/context/theme"

export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <For each={logo}>
        {(line) => (
          <box flexDirection="row">
            <text fg={theme.primary} selectable={false}>
              {line}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
