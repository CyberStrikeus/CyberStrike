import z from "zod"
import { Tool } from "./tool"
import path from "path"

const AZUREHOOK_DIR = path.resolve(import.meta.dir, "../../data/azurehook")

const AVAILABLE_PROGRAMS: Record<string, { description: string; args: string }> = {
  entra_enum: {
    description:
      "Enumerate Entra ID (Azure AD) users, groups, app registrations, service principals, and conditional access policies via Microsoft Graph API",
    args: "[--tenant-id TENANT] [--json-output]",
  },
  entra_privesc: {
    description:
      "Exploit Entra ID misconfigurations for privilege escalation: illicit consent grant, Global Admin via PIM, service principal secret injection",
    args: "--method <consent_grant|pim_activate|sp_secret|app_role> [--target-id ID] [--json-output]",
  },
  keyvault_dump: {
    description: "Extract secrets, keys, and certificates from all accessible Azure Key Vaults in the subscription",
    args: "[--vault-name NAME] [--subscription-id SUB] [--json-output]",
  },
  storage_dump: {
    description: "Enumerate and download sensitive data from Azure Blob Storage containers, Tables, and Queues",
    args: "[--account-name NAME] [--container CONTAINER] [--download] [--pattern REGEX] [--json-output]",
  },
  managed_identity: {
    description:
      "Extract managed identity OAuth tokens from Azure VM, App Service, Functions, or Container Instances via IMDS endpoint",
    args: "[--resource RESOURCE_URL] [--json-output]",
  },
  runbook_backdoor: {
    description:
      "Create or modify Azure Automation Account runbook with reverse shell or credential harvesting PowerShell, then publish and schedule",
    args: "--automation-account NAME --resource-group RG [--callback-url URL] [--json-output]",
  },
  azuread_token: {
    description:
      "Manipulate Azure AD tokens: refresh token exchange for new scopes, PRT extraction from device state, FOCI (Family of Client IDs) abuse",
    args: "--action <refresh|prt|foci> [--refresh-token TOKEN] [--client-id ID] [--json-output]",
  },
  cleanup_azure: {
    description:
      "Remove all CyberStrike-created Azure resources, delete added SP secrets, remove runbooks, clean state files. ALWAYS run before leaving",
    args: "[--dry-run] [--json-output]",
  },
}

export const AzurehookTool = Tool.define("azurehook", {
  description: `Execute an Azure/Entra ID post-exploitation program after compromising Azure credentials or managed identity. Available programs: ${Object.keys(AVAILABLE_PROGRAMS).join(", ")}. ALWAYS run cleanup_azure before leaving a target.`,
  parameters: z.object({
    program: z.enum(Object.keys(AVAILABLE_PROGRAMS) as [string, ...string[]]).describe(
      "Azure program to execute. Options: " +
        Object.entries(AVAILABLE_PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    const scriptPath = path.join(AZUREHOOK_DIR, `${params.program}.py`)
    const file = Bun.file(scriptPath)
    if (!(await file.exists())) {
      return {
        title: `azurehook: ${params.program}`,
        output: `Azure program not found: ${params.program}.py\n\nAvailable programs:\n${Object.entries(
          AVAILABLE_PROGRAMS,
        )
          .map(([k, v]) => `  ${k}: ${v.description}\n    Usage: ${v.args}`)
          .join("\n")}`,
        metadata: { program: params.program, exitCode: -1, hasStderr: false },
      }
    }

    const proc = Bun.spawn(["python3", scriptPath, ...params.args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    })

    const timeout = setTimeout(() => {
      proc.kill()
    }, params.timeout_seconds * 1000)

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])

    clearTimeout(timeout)
    const exitCode = await proc.exited

    const output = [stdout]
    if (stderr.trim()) output.push(`\n--- stderr ---\n${stderr}`)
    if (exitCode !== 0) {
      output.push(`\nExit code: ${exitCode}`)
      if (stderr.includes("ModuleNotFoundError") && (stderr.includes("azure") || stderr.includes("msal"))) {
        output.push(
          "\n⚠ Azure SDK required. Install with: pip3 install azure-identity azure-mgmt-resource azure-keyvault-secrets azure-storage-blob msal",
        )
      }
      if (stderr.includes("DefaultAzureCredential") || stderr.includes("EnvironmentCredential")) {
        output.push(
          "\n⚠ Azure credentials not found. Set AZURE_CLIENT_ID/AZURE_CLIENT_SECRET/AZURE_TENANT_ID or use managed identity",
        )
      }
    }

    return {
      title: `azurehook: ${params.program}`,
      output: output.join(""),
      metadata: {
        program: params.program,
        exitCode,
        hasStderr: stderr.trim().length > 0,
      },
    }
  },
})
