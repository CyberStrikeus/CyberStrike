import { az, argVal, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function cleanupAzure(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const dryRun = args.includes("--dry-run")
  const output: string[] = [
    dryRun
      ? "[*] CLEANUP DRY RUN — no changes will be made\n"
      : "[*] Cleaning up CyberStrike artifacts from Azure...\n",
  ]
  let cleaned = 0

  output.push("[*] Checking for CyberStrike automation runbooks (cs-* prefix)...")
  const accts = await az(["automation", "account", "list"], sub, timeout)
  if (accts.exitCode === 0) {
    const accounts = tryJson(accts.stdout) || []
    for (const a of accounts) {
      const rbs = await az(
        ["automation", "runbook", "list", "--automation-account-name", a.name, "--resource-group", a.resourceGroup],
        sub,
        timeout,
      )
      if (rbs.exitCode !== 0) continue
      const runbooks = tryJson(rbs.stdout) || []
      for (const r of runbooks) {
        if (!String(r.name).startsWith("cs-")) continue
        if (dryRun) {
          output.push(`    [DRY] Would delete runbook: ${r.name} in ${a.name}`)
        } else {
          const del = await az(
            [
              "automation",
              "runbook",
              "delete",
              "--automation-account-name",
              a.name,
              "--resource-group",
              a.resourceGroup,
              "--name",
              r.name,
              "--yes",
            ],
            sub,
            timeout,
          )
          output.push(
            del.exitCode === 0
              ? `    [+] Deleted runbook: ${r.name}`
              : `    [-] Failed to delete ${r.name}: ${del.stderr.slice(0, 100)}`,
          )
        }
        cleaned++
      }
    }
  }

  output.push("\n[*] Checking for CyberStrike role assignments...")
  const assignments = await az(["role", "assignment", "list"], sub, timeout)
  if (assignments.exitCode === 0) {
    const roles = tryJson(assignments.stdout) || []
    for (const r of roles) {
      const desc = String(r.description || "")
      if (!desc.includes("cyberstrike") && !desc.includes("cs-")) continue
      if (dryRun) {
        output.push(`    [DRY] Would remove role assignment: ${r.roleDefinitionName} on ${r.principalName}`)
      } else {
        const del = await az(["role", "assignment", "delete", "--ids", r.id], sub, timeout)
        output.push(
          del.exitCode === 0
            ? `    [+] Removed: ${r.roleDefinitionName} on ${r.principalName}`
            : `    [-] Failed: ${del.stderr.slice(0, 100)}`,
        )
      }
      cleaned++
    }
  }

  output.push("\n[*] Checking for CyberStrike app registrations (cs-* prefix)...")
  const apps = await az(["ad", "app", "list", "--display-name", "cs-"], sub, timeout)
  if (apps.exitCode === 0) {
    const appList = tryJson(apps.stdout) || []
    for (const a of appList) {
      if (!String(a.displayName).startsWith("cs-")) continue
      if (dryRun) {
        output.push(`    [DRY] Would delete app registration: ${a.displayName} (${a.appId})`)
      } else {
        const del = await az(["ad", "app", "delete", "--id", a.appId], sub, timeout)
        output.push(
          del.exitCode === 0 ? `    [+] Deleted app: ${a.displayName}` : `    [-] Failed: ${del.stderr.slice(0, 100)}`,
        )
      }
      cleaned++
    }
  }

  output.push("\n[*] Checking for CyberStrike snapshots (cs-snap-* prefix)...")
  const snapshots = await az(["snapshot", "list", "--query", "[?tags.cyberstrike=='true']"], sub, timeout)
  if (snapshots.exitCode === 0) {
    const snapList = tryJson(snapshots.stdout) || []
    for (const s of snapList) {
      if (dryRun) {
        output.push(`    [DRY] Would delete snapshot: ${s.name}`)
      } else {
        const del = await az(
          ["snapshot", "delete", "--name", s.name, "--resource-group", s.resourceGroup, "--yes"],
          sub,
          timeout,
        )
        output.push(
          del.exitCode === 0 ? `    [+] Deleted snapshot: ${s.name}` : `    [-] Failed: ${del.stderr.slice(0, 100)}`,
        )
      }
      cleaned++
    }
  }

  output.push("\n[*] Checking for CyberStrike policy exemptions (cs-exempt-* prefix)...")
  const exemptions = await az(["policy", "exemption", "list"], sub, timeout)
  if (exemptions.exitCode === 0) {
    const exemptList = tryJson(exemptions.stdout) || []
    for (const e of exemptList) {
      if (!String(e.name || "").startsWith("cs-exempt-")) continue
      if (dryRun) {
        output.push(`    [DRY] Would delete exemption: ${e.name}`)
      } else {
        const del = await az(["policy", "exemption", "delete", "--name", e.name], sub, timeout)
        output.push(
          del.exitCode === 0 ? `    [+] Deleted exemption: ${e.name}` : `    [-] Failed: ${del.stderr.slice(0, 100)}`,
        )
      }
      cleaned++
    }
  }

  output.push("\n[*] Checking for CyberStrike Event Grid subscriptions (cs-* prefix)...")
  const eventSubs = await az(["eventgrid", "event-subscription", "list", "--location", "global"], sub, timeout)
  if (eventSubs.exitCode === 0) {
    const subList = tryJson(eventSubs.stdout) || []
    for (const es of subList) {
      if (!String(es.name || "").startsWith("cs-")) continue
      if (dryRun) {
        output.push(`    [DRY] Would delete event subscription: ${es.name}`)
      } else {
        const del = await az(["eventgrid", "event-subscription", "delete", "--name", es.name], sub, timeout)
        output.push(
          del.exitCode === 0
            ? `    [+] Deleted event subscription: ${es.name}`
            : `    [-] Failed: ${del.stderr.slice(0, 100)}`,
        )
      }
      cleaned++
    }
  }

  output.push("\n[*] Checking for CyberStrike Event Hub consumer groups (cs-tap-* prefix)...")
  const ehNamespaces = await az(["eventhubs", "namespace", "list"], sub, timeout)
  if (ehNamespaces.exitCode === 0) {
    const nsList = tryJson(ehNamespaces.stdout) || []
    for (const ns of nsList) {
      const hubs = await az(
        ["eventhubs", "eventhub", "list", "--namespace-name", ns.name, "--resource-group", ns.resourceGroup],
        sub,
        timeout,
      )
      if (hubs.exitCode !== 0) continue
      const hubList = tryJson(hubs.stdout) || []
      for (const h of hubList) {
        const cgs = await az(
          [
            "eventhubs",
            "eventhub",
            "consumer-group",
            "list",
            "--eventhub-name",
            h.name,
            "--namespace-name",
            ns.name,
            "--resource-group",
            ns.resourceGroup,
          ],
          sub,
          timeout,
        )
        if (cgs.exitCode !== 0) continue
        const cgList = tryJson(cgs.stdout) || []
        for (const cg of cgList) {
          if (!String(cg.name || "").startsWith("cs-tap-")) continue
          if (dryRun) {
            output.push(`    [DRY] Would delete consumer group: ${cg.name} on ${h.name}`)
          } else {
            const del = await az(
              [
                "eventhubs",
                "eventhub",
                "consumer-group",
                "delete",
                "--name",
                cg.name,
                "--eventhub-name",
                h.name,
                "--namespace-name",
                ns.name,
                "--resource-group",
                ns.resourceGroup,
              ],
              sub,
              timeout,
            )
            output.push(
              del.exitCode === 0
                ? `    [+] Deleted consumer group: ${cg.name}`
                : `    [-] Failed: ${del.stderr.slice(0, 100)}`,
            )
          }
          cleaned++
        }
      }
    }
  }

  output.push("\n[*] Checking for CyberStrike Lighthouse assignments...")
  const lhAssignments = await az(["managedservices", "assignment", "list"], sub, timeout)
  if (lhAssignments.exitCode === 0) {
    const lhList = tryJson(lhAssignments.stdout) || []
    for (const lh of lhList) {
      const defId = lh.properties?.registrationDefinitionId || ""
      const defs = await az(["managedservices", "definition", "show", "--definition", defId], sub, timeout)
      const def = tryJson(defs.stdout)
      if (def && String(def.properties?.registrationDefinitionName || "").startsWith("cs-")) {
        if (dryRun) {
          output.push(`    [DRY] Would delete Lighthouse assignment: ${lh.name}`)
        } else {
          const del = await az(["managedservices", "assignment", "delete", "--assignment", lh.name], sub, timeout)
          output.push(
            del.exitCode === 0
              ? `    [+] Deleted Lighthouse assignment: ${lh.name}`
              : `    [-] Failed: ${del.stderr.slice(0, 100)}`,
          )
        }
        cleaned++
      }
    }
  }

  output.push(`\n[*] Cleanup complete: ${cleaned} artifact(s) ${dryRun ? "found" : "removed"}`)
  return { output: output.join("\n"), findings: [] }
}
