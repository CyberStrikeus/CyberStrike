interface ImportMetaEnv {
  readonly CYBERSTRIKE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// CyberStrike: the virtual server module resolves at build time to
// ../cyberstrike/dist/node/node.js (see electron.vite.config.ts). We declare a
// self-contained type here rather than importing from a dist/types emit the
// cyberstrike package does not produce. `username`/`password` are accepted for
// call-site compatibility; the runtime server reads its credentials from the
// CYBERSTRIKE_SERVER_USERNAME / CYBERSTRIKE_SERVER_PASSWORD env vars instead.
declare module "virtual:opencode-server" {
  export namespace Server {
    export interface Listener {
      stop(closeActiveConnections?: boolean): void | Promise<void>
    }
    export function listen(opts: {
      port: number
      hostname: string
      username?: string
      password?: string
      cors?: string[]
      webUI?: boolean
      mdns?: boolean
      mdnsDomain?: string
    }): Listener | Promise<Listener>
  }
}
