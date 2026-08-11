import { gcloud, resolveProject, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function cleanupGcp(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const dryRun = hasFlag(args, "--dry-run")
  const mode = dryRun ? "DRY RUN" : "LIVE"
  const findings: Finding[] = []
  const output = [`[*] CyberStrike GCP cleanup — ${mode}`, `[*] Project: ${project}\n`]
  let cleaned = 0

  const snapR = await gcloud(
    ["compute", "snapshots", "list", "--filter=description~CyberStrike OR name~cs-", "--project", project, "--format=json"],
    timeout,
  )
  if (snapR.exitCode === 0) {
    const snaps = tryJson(snapR.stdout) || []
    output.push(`[+] Snapshots to clean: ${snaps.length}`)
    for (const s of snaps) {
      if (dryRun) {
        output.push(`    Would delete: ${s.name}`)
      } else {
        await gcloud(["compute", "snapshots", "delete", s.name, "--project", project, "--quiet"], timeout)
        output.push(`    Deleted: ${s.name}`)
        cleaned++
      }
    }
  }

  const funcR = await gcloud(["functions", "list", "--filter=name~cs-", "--project", project, "--format=json"], timeout)
  if (funcR.exitCode === 0) {
    const funcs = tryJson(funcR.stdout) || []
    output.push(`[+] Functions to clean: ${funcs.length}`)
    for (const f of funcs) {
      const name = f.name?.split("/").pop() || f.name
      if (dryRun) {
        output.push(`    Would delete: ${name}`)
      } else {
        await gcloud(["functions", "delete", name, "--project", project, "--quiet"], timeout)
        output.push(`    Deleted: ${name}`)
        cleaned++
      }
    }
  }

  const runR = await gcloud(
    ["run", "services", "list", "--filter=metadata.name~cs-", "--project", project, "--format=json"],
    timeout,
  )
  if (runR.exitCode === 0) {
    const services = tryJson(runR.stdout) || []
    output.push(`[+] Cloud Run services to clean: ${services.length}`)
    for (const s of services) {
      const name = s.metadata?.name || s.name
      const region = s.metadata?.labels?.["cloud.googleapis.com/location"] || "us-central1"
      if (dryRun) {
        output.push(`    Would delete: ${name}`)
      } else {
        await gcloud(["run", "services", "delete", name, "--region", region, "--project", project, "--quiet"], timeout)
        output.push(`    Deleted: ${name}`)
        cleaned++
      }
    }
  }

  const subR = await gcloud(
    ["pubsub", "subscriptions", "list", "--filter=name~cs-sniff-", "--project", project, "--format=json"],
    timeout,
  )
  if (subR.exitCode === 0) {
    const subs = tryJson(subR.stdout) || []
    output.push(`[+] Pub/Sub subscriptions to clean: ${subs.length}`)
    for (const s of subs) {
      const name = s.name?.split("/").pop() || s.name
      if (dryRun) {
        output.push(`    Would delete: ${name}`)
      } else {
        await gcloud(["pubsub", "subscriptions", "delete", name, "--project", project, "--quiet"], timeout)
        output.push(`    Deleted: ${name}`)
        cleaned++
      }
    }
  }

  const schedR = await gcloud(
    ["scheduler", "jobs", "list", "--filter=name~cs-", "--project", project, "--format=json"],
    timeout,
  )
  if (schedR.exitCode === 0) {
    const jobs = tryJson(schedR.stdout) || []
    output.push(`[+] Scheduler jobs to clean: ${jobs.length}`)
    for (const j of jobs) {
      const name = j.name?.split("/").pop() || j.name
      const loc = j.name?.split("/")[3] || "us-central1"
      if (dryRun) {
        output.push(`    Would delete: ${name}`)
      } else {
        await gcloud(["scheduler", "jobs", "delete", name, "--location", loc, "--project", project, "--quiet"], timeout)
        output.push(`    Deleted: ${name}`)
        cleaned++
      }
    }
  }

  const buildR = await gcloud(
    ["builds", "triggers", "list", "--filter=name~cs-", "--project", project, "--format=json"],
    timeout,
  )
  if (buildR.exitCode === 0) {
    const triggers = tryJson(buildR.stdout) || []
    output.push(`[+] Build triggers to clean: ${triggers.length}`)
    for (const t of triggers) {
      const name = t.name || t.id
      if (dryRun) {
        output.push(`    Would delete: ${name}`)
      } else {
        await gcloud(["builds", "triggers", "delete", name, "--project", project, "--quiet"], timeout)
        output.push(`    Deleted: ${name}`)
        cleaned++
      }
    }
  }

  const fwR = await gcloud(
    ["compute", "firewall-rules", "list", "--filter=name~cs-", "--project", project, "--format=json"],
    timeout,
  )
  if (fwR.exitCode === 0) {
    const rules = tryJson(fwR.stdout) || []
    output.push(`[+] Firewall rules to clean: ${rules.length}`)
    for (const r of rules) {
      if (dryRun) {
        output.push(`    Would delete: ${r.name}`)
      } else {
        await gcloud(["compute", "firewall-rules", "delete", r.name, "--project", project, "--quiet"], timeout)
        output.push(`    Deleted: ${r.name}`)
        cleaned++
      }
    }
  }

  const saKeyR = await gcloud(
    ["iam", "service-accounts", "list", "--project", project, "--format=json"],
    timeout,
  )
  if (saKeyR.exitCode === 0) {
    const sas = tryJson(saKeyR.stdout) || []
    for (const sa of sas) {
      const keys = await gcloud(
        ["iam", "service-accounts", "keys", "list", "--iam-account", sa.email, "--format=json", "--managed-by=user"],
        timeout,
      )
      if (keys.exitCode !== 0) continue
      const keyList = tryJson(keys.stdout) || []
      const csKeys = keyList.filter((k: Record<string, string>) => {
        const age = Date.now() - new Date(k.validAfterTime || 0).getTime()
        return age < 86400000 * 7
      })
      if (csKeys.length > 0) {
        output.push(`[*] Recent SA keys for ${sa.email}: ${csKeys.length} (within 7 days)`)
      }
    }
  }

  if (!dryRun) {
    output.push(`\n[+] Cleanup complete — ${cleaned} resource(s) removed`)
    findings.push({
      checkId: "GCP-CLEANUP-001",
      provider: "gcp",
      severity: "info",
      status: "CLEANED",
      resource: project,
      title: `GCP cleanup completed: ${cleaned} resources`,
      details: `Removed snapshots, functions, Cloud Run services, Pub/Sub subs, scheduler jobs, build triggers, firewall rules`,
      remediation: "Verify no CyberStrike artifacts remain",
    })
  }

  return { output: output.join("\n"), findings }
}
