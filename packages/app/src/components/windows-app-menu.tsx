import { DropdownMenu } from "@cyberstrike-io/ui/dropdown-menu"
import { IconButton } from "@cyberstrike-io/ui/icon-button"
import { IconButtonV2 } from "@cyberstrike-io/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@cyberstrike-io/ui/v2/icon"

import { useCommand } from "@/context/command"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"

// NOTE (single-server scope): upstream's WindowsAppMenu is driven by a 302-line
// `@/desktop-menu` model (DESKTOP_MENU/desktopMenuVisible) plus the
// `i18n/desktop-native` key set and `platform.runDesktopMenuAction` — a
// Windows/Linux-desktop-only surface this fork does not ship. This preserves the
// titlebar's hamburger trigger design (v2 + legacy variants) as a minimal
// dropdown; wiring the full native menu model is out of scope for the tab port.
export function WindowsAppMenu(props: {
  command: ReturnType<typeof useCommand>
  platform: ReturnType<typeof usePlatform>
  variant?: "legacy" | "v2"
}) {
  void props.command
  void props.platform
  const language = useLanguage()

  return (
    <DropdownMenu gutter={4} modal={false} placement="bottom-start">
      {props.variant === "v2" ? (
        <div
          data-component="desktop-icon-button"
          class="flex h-7 w-9 shrink-0 items-center justify-center rounded-[6px] px-1"
        >
          <DropdownMenu.Trigger
            as={IconButtonV2}
            variant="ghost-muted"
            size="large"
            icon={<IconV2 name="menu" />}
            aria-label={language.t("sidebar.menu.toggle")}
          />
        </div>
      ) : (
        <DropdownMenu.Trigger
          as={IconButton}
          icon="menu"
          variant="ghost"
          class="titlebar-icon rounded-md shrink-0"
          aria-label={language.t("sidebar.menu.toggle")}
        />
      )}
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="desktop-app-menu" />
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
