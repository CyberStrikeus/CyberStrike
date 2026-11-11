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
import { Session } from "../session"
import { releaseGovernors } from "../replay/govern"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
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

  // Free a run's shared replay governors (budget/breaker/limiter/bucket) when its
  // root engagement ends. A sub-agent session closing must NOT drop the run — its
  // siblings are still live — so only a parentless (root) deletion releases. The
  // registry is also self-bounded, so this is prompt cleanup, not the only safeguard. (#91)
  Bus.subscribe(Session.Event.Deleted, async (payload) => {
    if (!payload.properties.info.parentID) releaseGovernors(payload.properties.info.id)
  })

  Project.reconcileSessionDirectories().catch((error) => {
    Log.Default.warn("session directory reconcile failed", { error })
  })
}
