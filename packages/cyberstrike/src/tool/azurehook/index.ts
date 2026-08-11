import z from "zod"
import { Tool } from "../tool"
import type { Finding, HookResult } from "./shared"

import {
  entraEnum,
  vmEnum,
  aksEnum,
  nsgAudit,
  rbacAudit,
  sqlEnumAzure,
  appServiceEnum,
  subscriptionEnum,
  resourceGraph,
  vnetEnum,
  dnsEnum,
  acrEnum,
  vmssEnum,
  redisEnum,
  dataFactoryEnum,
  frontDoorEnum,
  containerInstanceEnum,
} from "./recon"
import {
  keyvaultDump,
  managedIdentity,
  azureadToken,
  imdsHarvest,
  deviceCodePhish,
  tokenTheft,
  certificateAbuse,
  storageKeyDump,
  automationCredDump,
} from "./credential"
import {
  entraPrivesc,
  customRoleExploit,
  conditionalAccessAudit,
  pimAbuse,
  managedIdentityPrivesc,
  deploymentPrivesc,
} from "./privesc"
import {
  runbookBackdoor,
  logicAppBackdoor,
  functionAppBackdoor,
  spPersist,
  vmExtensionBackdoor,
  webhookPersist,
  devopsPipelineBackdoor,
  lighthousePersist,
} from "./persistence"
import {
  vmRunCommand,
  bastionTunnel,
  arcExec,
  devopsServiceConn,
  crossTenantEnum,
} from "./lateral"
import {
  diagnosticTamper,
  sentinelSuppress,
  defenderDisable,
  activityLogTamper,
  policyExempt,
  wafBypass,
  alertSuppress,
} from "./evasion"
import {
  storageDump,
  cosmosDump,
  diskSnapshot,
  tableQueueDump,
  fileShareDump,
  dataLakeDump,
  serviceBusSniff,
  eventHubTap,
} from "./exfil"
import { cleanupAzure } from "./cleanup"

const PROGRAMS = {
  // ── Recon & Enumeration (17) ──
  subscription_enum: {
    description: "Enumerate all accessible Azure subscriptions, management groups, and tenant info — determines blast radius",
    args: "",
  },
  resource_graph: {
    description: "Azure Resource Graph cross-subscription discovery: find all public IPs, exposed storage, VMs with public access across all subscriptions",
    args: "[--query QUERY] [--subscription-id SUB]",
  },
  entra_enum: {
    description: "Enumerate Entra ID (Azure AD) users, groups, app registrations, service principals, and role assignments",
    args: "[--subscription-id SUB]",
  },
  vm_enum: {
    description: "Enumerate Azure VMs: extensions, custom data, disk encryption, public IPs, NSG associations, user data scripts",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  vmss_enum: {
    description: "Enumerate VM Scale Sets: instances, extensions, managed identity, custom data, health probes, auto-scale rules",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  aks_enum: {
    description: "Enumerate AKS clusters: config, node pools, RBAC, network profiles, admin credential extraction",
    args: "[--cluster NAME] [--resource-group RG]",
  },
  vnet_enum: {
    description: "VNet topology: subnets, peering connections (implicit trust), VPN gateways, ExpressRoute, Private Endpoints",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  nsg_audit: {
    description: "Audit NSGs for overly permissive rules: open 0.0.0.0/0 ingress, any-any rules, dangerous port exposure (RDP/SSH/SQL)",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  rbac_audit: {
    description: "Audit RBAC role assignments: Owner/Contributor at subscription level, custom roles with dangerous actions, overprivileged SPs",
    args: "[--subscription-id SUB]",
  },
  sql_enum: {
    description: "Enumerate Azure SQL: firewall rules, AD admin, TDE status, auditing config, public endpoint exposure, connection strings",
    args: "[--subscription-id SUB] [--server NAME]",
  },
  app_service_enum: {
    description: "Enumerate App Services: connection strings, app settings with secrets, SCM/Kudu access, managed identity, CORS config",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  dns_enum: {
    description: "Azure DNS zones, records, Private DNS zones. Detect dangling CNAMEs for subdomain takeover",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  acr_enum: {
    description: "Azure Container Registry: repos, images, admin credentials enabled, public access, webhooks",
    args: "[--subscription-id SUB]",
  },
  redis_enum: {
    description: "Azure Cache for Redis: access keys, firewall rules, TLS/non-SSL port status, public network access",
    args: "[--subscription-id SUB]",
  },
  data_factory_enum: {
    description: "Data Factory pipelines and linked services — extract connection strings to production databases and storage",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  front_door_enum: {
    description: "Front Door / Application Gateway / WAF: origins, routing rules, WAF policies, exclusions, backend exposure",
    args: "[--subscription-id SUB]",
  },
  container_instance_enum: {
    description: "Azure Container Instances: running groups, env vars (secrets), mounted volumes, networking, identity",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },

  // ── Credential Harvesting (9) ──
  keyvault_dump: {
    description: "Extract secrets, keys, and certificates from all accessible Azure Key Vaults",
    args: "[--vault-name NAME] [--subscription-id SUB]",
  },
  managed_identity: {
    description: "Extract managed identity OAuth tokens from Azure VM/App Service/Functions via IMDS (169.254.169.254)",
    args: "[--resource RESOURCE_URL]",
  },
  azuread_token: {
    description: "Manipulate Azure AD tokens: refresh token exchange for new scopes, FOCI (Family of Client IDs) abuse",
    args: "--action <refresh|foci> [--refresh-token TOKEN] [--client-id ID]",
  },
  imds_harvest: {
    description: "Extract credentials and metadata from Azure IMDS: subscription info, VM identity tokens, network config",
    args: "[--resource RESOURCE_URL]",
  },
  device_code_phish: {
    description: "Initiate device code auth flow for phishing — generates user_code, polls for token. #1 Azure initial access technique",
    args: "[--client-id ID] [--scope SCOPE] [--tenant TENANT]",
  },
  token_theft: {
    description: "Extract Azure tokens from local files: .azure/ profile, accessTokens.json, msal_token_cache, az CLI cache",
    args: "",
  },
  certificate_abuse: {
    description: "Generate/upload certificate for SP auth — bypasses MFA and conditional access. Enumerate existing cert credentials",
    args: "--app-id ID [--generate] [--subscription-id SUB]",
  },
  storage_key_dump: {
    description: "Extract storage account access keys and generate SAS tokens for all accessible accounts. Keys never expire",
    args: "[--account-name NAME] [--subscription-id SUB]",
  },
  automation_cred_dump: {
    description: "Extract credentials, variables, and certificates from Azure Automation Accounts including RunAs accounts",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },

  // ── Privilege Escalation (6) ──
  entra_privesc: {
    description: "Exploit Entra ID misconfigs: consent grant, SP secret injection, role assignment for privilege escalation",
    args: "--method <consent_grant|sp_secret|role_assign> [--target-id ID]",
  },
  custom_role_exploit: {
    description: "Find custom RBAC roles with dangerous actions: */write, Microsoft.Authorization/*, deployment write",
    args: "[--subscription-id SUB]",
  },
  conditional_access_audit: {
    description: "Enumerate CA policies — find gaps: no MFA for admins, excluded users, trusted locations, legacy auth allowed",
    args: "",
  },
  pim_abuse: {
    description: "Enumerate PIM eligible roles — find roles with no approval required. Attempt activation for instant admin",
    args: "[--role-id ID] [--activate]",
  },
  managed_identity_privesc: {
    description: "Cross-reference managed identities with RBAC — find over-privileged identities (Contributor on subscription)",
    args: "[--subscription-id SUB]",
  },
  deployment_privesc: {
    description: "Abuse deployments/write to deploy ARM template creating new Owner role assignment. Shows exploit template",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },

  // ── Persistence (8) ──
  runbook_backdoor: {
    description: "Create/modify Automation Account runbook with reverse shell payload, publish and schedule for persistence",
    args: "--automation-account NAME --resource-group RG [--callback-url URL]",
  },
  logic_app_backdoor: {
    description: "Create or inject webhook trigger into Logic App for persistent callback with custom payload",
    args: "--resource-group RG --name NAME --callback-url URL [--method create|inject]",
  },
  function_app_backdoor: {
    description: "Deploy/modify Function App with reverse shell — supports HTTP and timer trigger persistence",
    args: "--resource-group RG --name NAME --callback-url URL [--trigger http|timer] [--method create|inject]",
  },
  sp_persist: {
    description: "Create Entra ID app registration with client secret for long-term credential-based persistent access",
    args: "--name NAME [--role ROLE] [--scope SCOPE]",
  },
  vm_extension_backdoor: {
    description: "Deploy Custom Script Extension on VMs for persistent code execution — survives VM restart, runs as SYSTEM/root",
    args: "--vm-name VM --resource-group RG --command CMD [--os windows|linux]",
  },
  webhook_persist: {
    description: "Create Event Grid subscription with webhook endpoint — event-driven callbacks on Azure resource changes",
    args: "--endpoint URL [--event-type TYPE] [--subscription-id SUB]",
  },
  devops_pipeline_backdoor: {
    description: "Inject steps into Azure DevOps pipeline YAML or create new pipeline with malicious build/release steps",
    args: "--org ORG --project PROJECT [--pipeline-id ID] [--callback-url URL]",
  },
  lighthouse_persist: {
    description: "Create Azure Lighthouse delegation to external tenant — rarely audited cross-tenant persistent access",
    args: "--tenant-id TENANT --principal-id PRINCIPAL [--role ROLE] [--subscription-id SUB]",
  },

  // ── Lateral Movement (5) ──
  vm_run_command: {
    description: "Execute commands on Azure VMs via Run Command API — no SSH/RDP needed, works through management plane even without public IP",
    args: "--vm-name VM --resource-group RG --cmd CMD [--os windows|linux]",
  },
  bastion_tunnel: {
    description: "Enumerate Azure Bastion hosts and create SSH/RDP tunnels to VMs in private VNets through management plane",
    args: "[--resource-group RG] [--target-vm VM] [--ssh-key KEY]",
  },
  arc_exec: {
    description: "Execute commands on Azure Arc-connected machines (on-prem/multi-cloud) — compromise Azure = compromise on-prem",
    args: "[--machine-name NAME] [--resource-group RG] [--cmd CMD]",
  },
  devops_service_conn: {
    description: "Enumerate Azure DevOps service connections — extract credentials for cross-environment pivoting to K8s, Docker, other subs",
    args: "--org ORG --project PROJECT",
  },
  cross_tenant_enum: {
    description: "Enumerate cross-tenant access settings, B2B collaborations, guest user access for multi-tenant pivoting",
    args: "",
  },

  // ── Defense Evasion (7) ──
  diagnostic_tamper: {
    description: "Manipulate Azure diagnostic settings and activity logs — identify monitoring blind spots for evasion",
    args: "--action <status|disable> [--subscription-id SUB] [--resource-id RID]",
  },
  sentinel_suppress: {
    description: "Suppress/close Azure Sentinel incidents, disable analytics rules — blinds the SOC",
    args: "--action <list|close|disable_rule> [--subscription-id SUB] [--workspace WS]",
  },
  defender_disable: {
    description: "Disable Defender for Cloud plans (Servers, Storage, SQL, Containers, KeyVault, DNS, ARM) per subscription",
    args: "[--plan PLAN] [--subscription-id SUB]",
  },
  activity_log_tamper: {
    description: "Modify Activity Log diagnostic settings — change retention, delete/redirect log sinks to cover tracks",
    args: "--action <status|delete|redirect> [--subscription-id SUB]",
  },
  policy_exempt: {
    description: "Create Azure Policy exemptions to bypass security guardrails — stealthy, doesn't remove the policy itself",
    args: "--assignment ASSIGNMENT --name NAME [--subscription-id SUB]",
  },
  waf_bypass: {
    description: "Modify/disable Azure WAF policies — change mode from Prevention to Detection, add exclusion rules",
    args: "--action <list|disable|exclude> [--subscription-id SUB]",
  },
  alert_suppress: {
    description: "Suppress Azure Monitor alerts — disable alert rules, remove notification recipients from action groups",
    args: "--action <list|disable|suppress> [--subscription-id SUB]",
  },

  // ── Exfiltration (8) ──
  storage_dump: {
    description: "Enumerate and download sensitive data from Azure Blob Storage containers",
    args: "[--account-name NAME] [--container CONTAINER] [--download] [--pattern REGEX]",
  },
  cosmos_dump: {
    description: "Enumerate and extract data from Cosmos DB — list databases, containers, query documents for sensitive data",
    args: "--account NAME [--database DB] [--container CONTAINER] [--query QUERY] [--max-items N]",
  },
  disk_snapshot: {
    description: "Create managed disk snapshots for offline analysis — export via SAS URL or share cross-subscription",
    args: "--disk-id DISK_ID --resource-group RG [--share-sub SUB]",
  },
  table_queue_dump: {
    description: "Extract data from Azure Table Storage and Queue Storage — enumerate tables, query entities, peek queue messages",
    args: "--account-name NAME [--table TABLE] [--queue QUEUE]",
  },
  file_share_dump: {
    description: "Enumerate and download from Azure File Shares (SMB) — find credentials and config files in mounted shares",
    args: "--account-name NAME [--share SHARE] [--pattern REGEX]",
  },
  data_lake_dump: {
    description: "Enumerate and extract from Azure Data Lake Storage Gen2 — filesystem listing, ACL checks, selective download",
    args: "--account-name NAME [--filesystem FS] [--path PATH]",
  },
  service_bus_sniff: {
    description: "Peek Service Bus queue/topic messages without consuming — intercept inter-service communication",
    args: "[--namespace NS] [--queue QUEUE] [--subscription-id SUB]",
  },
  event_hub_tap: {
    description: "Enumerate Event Hub namespaces, create consumer group to capture real-time event streams",
    args: "[--namespace NS] [--eventhub HUB] [--subscription-id SUB]",
  },

  // ── Cleanup (1) ──
  cleanup_azure: {
    description: "Remove all CyberStrike-created Azure resources: SPs, runbooks, extensions, event grid subs, policy exemptions, snapshots. ALWAYS run before leaving",
    args: "[--dry-run]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS

const dispatch: Record<Program, (args: string[], timeout: number) => Promise<HookResult>> = {
  // Recon
  subscription_enum: subscriptionEnum,
  resource_graph: resourceGraph,
  entra_enum: entraEnum,
  vm_enum: vmEnum,
  vmss_enum: vmssEnum,
  aks_enum: aksEnum,
  vnet_enum: vnetEnum,
  nsg_audit: nsgAudit,
  rbac_audit: rbacAudit,
  sql_enum: sqlEnumAzure,
  app_service_enum: appServiceEnum,
  dns_enum: dnsEnum,
  acr_enum: acrEnum,
  redis_enum: redisEnum,
  data_factory_enum: dataFactoryEnum,
  front_door_enum: frontDoorEnum,
  container_instance_enum: containerInstanceEnum,
  // Credential
  keyvault_dump: keyvaultDump,
  managed_identity: managedIdentity,
  azuread_token: azureadToken,
  imds_harvest: imdsHarvest,
  device_code_phish: deviceCodePhish,
  token_theft: tokenTheft,
  certificate_abuse: certificateAbuse,
  storage_key_dump: storageKeyDump,
  automation_cred_dump: automationCredDump,
  // Privesc
  entra_privesc: entraPrivesc,
  custom_role_exploit: customRoleExploit,
  conditional_access_audit: conditionalAccessAudit,
  pim_abuse: pimAbuse,
  managed_identity_privesc: managedIdentityPrivesc,
  deployment_privesc: deploymentPrivesc,
  // Persistence
  runbook_backdoor: runbookBackdoor,
  logic_app_backdoor: logicAppBackdoor,
  function_app_backdoor: functionAppBackdoor,
  sp_persist: spPersist,
  vm_extension_backdoor: vmExtensionBackdoor,
  webhook_persist: webhookPersist,
  devops_pipeline_backdoor: devopsPipelineBackdoor,
  lighthouse_persist: lighthousePersist,
  // Lateral
  vm_run_command: vmRunCommand,
  bastion_tunnel: bastionTunnel,
  arc_exec: arcExec,
  devops_service_conn: devopsServiceConn,
  cross_tenant_enum: crossTenantEnum,
  // Evasion
  diagnostic_tamper: diagnosticTamper,
  sentinel_suppress: sentinelSuppress,
  defender_disable: defenderDisable,
  activity_log_tamper: activityLogTamper,
  policy_exempt: policyExempt,
  waf_bypass: wafBypass,
  alert_suppress: alertSuppress,
  // Exfil
  storage_dump: storageDump,
  cosmos_dump: cosmosDump,
  disk_snapshot: diskSnapshot,
  table_queue_dump: tableQueueDump,
  file_share_dump: fileShareDump,
  data_lake_dump: dataLakeDump,
  service_bus_sniff: serviceBusSniff,
  event_hub_tap: eventHubTap,
  // Cleanup
  cleanup_azure: cleanupAzure,
}

const CWE_MAP: Record<string, string> = {
  // Recon
  "AZ-SUB-001": "CWE-200",
  "AZ-RG-001": "CWE-200",
  "AZ-VNET-001": "CWE-284",
  "AZ-VNET-PEER-001": "CWE-284",
  "AZ-DNS-001": "CWE-693",
  "AZ-DNS-TAKEOVER": "CWE-672",
  "AZ-ACR-001": "CWE-522",
  "AZ-ACR-002": "CWE-284",
  "AZ-VMSS-001": "CWE-200",
  "AZ-REDIS-001": "CWE-319",
  "AZ-REDIS-002": "CWE-284",
  "AZ-ADF-001": "CWE-312",
  "AZ-FD-001": "CWE-693",
  "AZ-ACI-001": "CWE-312",
  "AZ-ENUM-001": "CWE-200",
  "AZ-ENUM-002": "CWE-200",
  "AZ-NSG-001": "CWE-284",
  "AZ-NSG-002": "CWE-284",
  "AZ-RBAC-001": "CWE-269",
  "AZ-RBAC-002": "CWE-269",
  "AZ-SQL-001": "CWE-284",
  "AZ-SQL-002": "CWE-319",
  "AZ-APPSVC-001": "CWE-312",
  "AZ-APPSVC-002": "CWE-522",
  "AZ-AKS-001": "CWE-522",
  "AZ-AKS-002": "CWE-284",
  "AZ-VM-001": "CWE-200",
  "AZ-VM-002": "CWE-284",
  // Credential
  "AZ-KV-001": "CWE-522",
  "AZ-KV-002": "CWE-522",
  "AZ-MI-001": "CWE-522",
  "AZ-IMDS-001": "CWE-522",
  "AZ-TOKEN-001": "CWE-522",
  "AZ-TOKEN-002": "CWE-312",
  "AZ-CRED-001": "CWE-522",
  "AZ-CRED-002": "CWE-522",
  "AZ-CERT-001": "CWE-522",
  "AZ-SKEY-001": "CWE-522",
  "AZ-SKEY-002": "CWE-320",
  "AZ-AUTO-001": "CWE-522",
  "AZ-AUTO-002": "CWE-312",
  // Privesc
  "AZ-PRIVESC-001": "CWE-269",
  "AZ-PRIVESC-002": "CWE-269",
  "AZ-ROLE-001": "CWE-269",
  "AZ-ROLE-002": "CWE-732",
  "AZ-CA-001": "CWE-287",
  "AZ-CA-002": "CWE-287",
  "AZ-PIM-001": "CWE-269",
  "AZ-PIM-002": "CWE-269",
  "AZ-MI-PRIV-001": "CWE-269",
  "AZ-DEPLOY-001": "CWE-269",
  // Persistence
  "AZ-PERSIST-001": "CWE-547",
  "AZ-PERSIST-002": "CWE-547",
  "AZ-PERSIST-003": "CWE-547",
  "AZ-PERSIST-004": "CWE-547",
  "AZ-EXT-001": "CWE-94",
  "AZ-WEBHOOK-001": "CWE-547",
  "AZ-DEVOPS-001": "CWE-94",
  "AZ-LH-001": "CWE-284",
  // Lateral
  "AZ-RUNCMD-001": "CWE-78",
  "AZ-RUNCMD-002": "CWE-78",
  "AZ-BASTION-001": "CWE-284",
  "AZ-ARC-001": "CWE-78",
  "AZ-SVCCONN-001": "CWE-522",
  "AZ-XTENANT-001": "CWE-284",
  "AZ-LATERAL-001": "CWE-78",
  // Evasion
  "AZ-DIAG-001": "CWE-778",
  "AZ-DIAG-002": "CWE-778",
  "AZ-SENTINEL-001": "CWE-778",
  "AZ-SENTINEL-002": "CWE-693",
  "AZ-DEFENDER-001": "CWE-693",
  "AZ-DEFENDER-002": "CWE-693",
  "AZ-ACTLOG-001": "CWE-778",
  "AZ-ACTLOG-002": "CWE-778",
  "AZ-POLICY-001": "CWE-693",
  "AZ-WAF-001": "CWE-693",
  "AZ-WAF-002": "CWE-693",
  "AZ-ALERT-001": "CWE-778",
  "AZ-ALERT-002": "CWE-778",
  // Exfil
  "AZ-STORAGE-001": "CWE-200",
  "AZ-STORAGE-002": "CWE-200",
  "AZ-COSMOS-001": "CWE-200",
  "AZ-COSMOS-002": "CWE-200",
  "AZ-DISK-001": "CWE-200",
  "AZ-DISK-002": "CWE-200",
  "AZ-TABLE-001": "CWE-200",
  "AZ-QUEUE-001": "CWE-200",
  "AZ-FILESHARE-001": "CWE-200",
  "AZ-DATALAKE-001": "CWE-200",
  "AZ-SBUS-001": "CWE-200",
  "AZ-EHUB-001": "CWE-200",
  // Cleanup
  "AZ-CLEANUP-001": "CWE-1254",
}

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const AzurehookTool = Tool.define("azurehook", {
  description: `Execute an Azure post-exploitation program. 61 programs across 9 categories: recon (17), credential (9), privesc (6), persistence (8), lateral (5), evasion (7), exfil (8), cleanup (1). Uses az CLI and Azure REST API. Available: ${programKeys.join(", ")}. ALWAYS run cleanup_azure before leaving.`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "Azure program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    if (!Bun.which("az") && !["managed_identity", "imds_harvest", "token_theft", "device_code_phish"].includes(params.program)) {
      return {
        title: `azurehook: ${params.program}`,
        output: "az CLI not found. Install: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli",
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const program = params.program as Program
    const handler = dispatch[program]
    let result: HookResult
    try {
      result = await handler(params.args, params.timeout_seconds)
    } catch (e) {
      return {
        title: `azurehook: ${program}`,
        output: `[-] ${program} failed: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program, findings: [] as Finding[] },
      }
    }

    const enriched = result.findings.map((f) => {
      const cwe = CWE_MAP[f.checkId]
      return cwe ? { ...f, cwe } : f
    })

    return {
      title: `azurehook: ${program}`,
      output: result.output,
      metadata: { program, findings: enriched },
    }
  },
})
