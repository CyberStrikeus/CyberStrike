// Minimal stub: layout-new renders <DebugBar inline /> only under
// import.meta.env.DEV. Upstream's debug bar is a heavy dev-only inspector; it is
// out of scope for the tab/titlebar port, so this renders nothing.
export function DebugBar(_props: { inline?: boolean }) {
  return null
}
