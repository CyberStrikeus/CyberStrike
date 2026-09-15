# @cyberstrike-io/desktop

CyberStrike desktop app — an Electron shell that launches the local CyberStrike server and loads its web
UI in a native window.

## Status: MVP (dev-mode)

This is a **thin wrapper** (architecture "Model B"): the main process spawns `cyberstrike web --no-open`
on a free loopback port, waits until it answers, then opens a `BrowserWindow` on that URL. Because the
window talks to `127.0.0.1`, it skips auth — no password prompt. There is **no bundled renderer**; the UI
is the server's already-served web app (`packages/app/dist` via the backend).

## Run (dev)

```bash
# from the repo root, once (pulls Electron ~ platform binary):
bun install

# then:
cd packages/desktop
bun run dev        # = electron .  → spawns the server, opens the window
```

Requires `bun` on PATH (dev spawns the CLI from source: `packages/cyberstrike/src/index.ts web`).

## Not done yet (roadmap → full port of the upstream desktop app)

1. **Packaging**: `package:mac|win|linux` configs exist (`electron-builder.yml`) but a packaged app must
   bundle the **compiled server binary** + the **built web UI** and spawn the binary instead of `bun`.
2. **TS + electron-vite**: main is plain ESM JS for the MVP; port to TS + electron-vite (as upstream) when
   we add a preload/renderer surface.
3. Later layers from the upstream `packages/desktop`: native menu, auto-update (electron-updater),
   native pty, drafts store, i18n, Sentry, code-signing/notarization, CI packaging.
4. Icons (`resources/icon.{icns,ico,png}`) — currently placeholders.
