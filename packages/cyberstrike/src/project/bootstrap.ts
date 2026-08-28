import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"
import { Network } from "../network/network"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  // Route this runtime's own outbound HTTP through the configured proxy. It lives
  // here, not at a CLI entry point, because the work does not all happen in the
  // process the CLI starts: the TUI runs the server inside a Worker, which is a
  // separate realm with its own globalThis and never executes index.ts. Installing
  // per entry point missed that one and the TUI silently went direct. Every
  // runtime path reaches this function, and the install is idempotent.
  Network.installGlobalTransport()
  await Plugin.init()
  ShareNext.init()
  Format.init()
  await LSP.init()
  FileWatcher.init()
  File.init()
  Vcs.init()
  Snapshot.init()
  Truncate.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
