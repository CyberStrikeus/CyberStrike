// CyberStrike: node-target entrypoint for the Electron desktop sidecar.
//
// The desktop package bundles this module (via electron.vite.config.ts's
// `virtual:opencode-server` -> ../cyberstrike/dist/node/node.js) and runs it
// inside Electron's utilityProcess to host the local server. Keep this surface
// tiny: it must not pull in the TUI/CLI so the node bundle stays server-only.
export { Server } from "./server/server"
