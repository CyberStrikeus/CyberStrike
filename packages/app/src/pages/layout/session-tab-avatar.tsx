import type { LocalProject } from "@/context/layout"
import { getProjectAvatarVariant } from "@/context/layout"
import type { ServerConnection } from "@/context/server"
import { displayName, getProjectAvatarSource } from "@/pages/layout/helpers"
import { ProjectAvatar } from "@cyberstrike-io/ui/v2/project-avatar-v2"

// NOTE (single-server deviation): upstream's SessionTabAvatar overlays a live
// session-progress / unread indicator sourced from the upstream session-ui
// package (session-progress-indicator-v2) plus a multi-server
// project-avatar-state session-status store. This fork deliberately does not
// adopt that session-ui / multi-server session-status layer, so this renders the
// project avatar only. The tab's project-avatar design is preserved; live
// per-session progress/unread state is not shown.
export function SessionTabAvatar(props: {
  project?: LocalProject
  directory: string
  sessionId: string
  server: ServerConnection.Key
  revealProjectOnHover?: boolean
}) {
  return (
    <ProjectAvatar
      fallback={displayName(props.project ?? { worktree: props.directory })}
      src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
      variant={getProjectAvatarVariant(props.project?.icon?.color)}
      unread={false}
    />
  )
}

// Presentational avatar used by the v2 home session rows. Same single-server
// deviation as SessionTabAvatar above: renders the project avatar only. Upstream
// overlays live per-session progress/unread state that this fork does not adopt,
// so `unread`/`loading` here are honored only insofar as the project avatar can
// show an unread dot; the busy spinner overlay is not shown.
export function SessionTabAvatarView(props: {
  project?: LocalProject
  directory: string
  revealProjectOnHover?: boolean
  unread?: boolean
  loading?: boolean
}) {
  return (
    <ProjectAvatar
      fallback={displayName(props.project ?? { worktree: props.directory })}
      src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
      variant={getProjectAvatarVariant(props.project?.icon?.color)}
      unread={!!props.unread}
    />
  )
}
