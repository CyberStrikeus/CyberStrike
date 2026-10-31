import { registerCustomTheme } from "@pierre/diffs"
import { CyberStrikeTheme } from "./marked-theme"

let registered = false

export function registerCyberStrikeTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("CyberStrike", () => Promise.resolve(CyberStrikeTheme))
}
