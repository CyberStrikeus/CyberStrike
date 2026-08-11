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
  apimEnum,
  databricksEnum,
  appInsightsEnum,
  monitorEnum,
  recoveryVaultEnum,
  intuneEnum,
  graphUserEnum,
  appRegistrationEnum,
  logicAppConnectorEnum,
  automationRunbookEnum,
  synapseEnum,
  purviewEnum,
  subdomainTakeover,
  stalePermissionAudit,
  publicExposureScan,
  cognitiveServicesEnum,
  iotHubEnum,
  signalrEnum,
  eventGridEnum,
  batchEnum,
  mapsSearchEnum,
  sentinelEnum,
  vpnGatewayEnum,
  expressRouteEnum,
  privateLinkAudit,
  databricksSecretDump,
  serviceFabricEnum,
  batchAccountEnum,
  managedEnvEnum,
  staticWebAppEnum,
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
  graphTokenHarvest,
  refreshTokenReplay,
  runbookCredExtract,
  kubeconfigDump,
  webappEnvDump,
} from "./credential"
import {
  entraPrivesc,
  customRoleExploit,
  conditionalAccessAudit,
  pimAbuse,
  managedIdentityPrivesc,
  deploymentPrivesc,
  globalAdminElevate,
  appAdminPrivesc,
  resourceHierarchyAbuse,
  groupMembershipAbuse,
  partnerAdminAbuse,
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
  acrImageBackdoor,
  scheduledTaskPersist,
  oauthAppPersist,
} from "./persistence"
import {
  vmRunCommand,
  bastionTunnel,
  arcExec,
  devopsServiceConn,
  crossTenantEnum,
  customScriptExt,
  userdataCommand,
  intuneDeploy,
  msbuildExec,
  sharedImageInject,
} from "./lateral"
import {
  diagnosticTamper,
  sentinelSuppress,
  defenderDisable,
  activityLogTamper,
  policyExempt,
  wafBypass,
  alertSuppress,
  logAnalyticsTamper,
  nsgFlowLogDisable,
  resourceMove,
  tagManipulation,
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
  graphMailDump,
  sharepointDump,
  teamsDump,
  vmDiskDownload,
} from "./exfil"
import { cleanupAzure } from "./cleanup"
import {
  defenderPlanAudit,
  defenderContactAudit,
  storageSecurityAudit,
  sqlAuditConfig,
  postgresAudit,
  mysqlAudit,
  cosmosSecurityAudit,
  diagnosticAudit,
  activityAlertAudit,
  networkWatcherAudit,
  vmSecurityAudit,
  appserviceSecurityAudit,
  keyvaultSecurityAudit,
  identityMfaAudit,
  guestAccessAudit,
  passwordPolicyAudit,
  resourceLockAudit,
  policyComplianceAudit,
} from "./compliance"
import {
  federationBackdoor,
  ptaAbuse,
  aadconnectDump,
  seamlessSsoAbuse,
  samlForge,
  mfaManipulation,
  userCreation,
  passwordSpray,
  tenantReconInsider,
  consentPhish,
} from "./identity"
import {
  resourceHijack,
  dataDestroy,
  ransomwareSim,
  accountLockout,
  serviceDisruption,
} from "./impact"
import {
  exchangeAbuse,
  sharepointEnum,
  teamsEnum,
  onedriveAccess,
} from "./m365"

const PROGRAMS = {
  // ── Recon & Enumeration (45) ──
  subscription_enum: {
    description:
      "Enumerate all accessible Azure subscriptions, management groups, and tenant info — determines blast radius",
    args: "",
  },
  resource_graph: {
    description:
      "Azure Resource Graph cross-subscription discovery: find all public IPs, exposed storage, VMs with public access across all subscriptions",
    args: "[--query QUERY] [--subscription-id SUB]",
  },
  entra_enum: {
    description:
      "Enumerate Entra ID (Azure AD) users, groups, app registrations, service principals, and role assignments",
    args: "[--subscription-id SUB]",
  },
  vm_enum: {
    description:
      "Enumerate Azure VMs: extensions, custom data, disk encryption, public IPs, NSG associations, user data scripts",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  vmss_enum: {
    description:
      "Enumerate VM Scale Sets: instances, extensions, managed identity, custom data, health probes, auto-scale rules",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  aks_enum: {
    description: "Enumerate AKS clusters: config, node pools, RBAC, network profiles, admin credential extraction",
    args: "[--cluster NAME] [--resource-group RG]",
  },
  vnet_enum: {
    description:
      "VNet topology: subnets, peering connections (implicit trust), VPN gateways, ExpressRoute, Private Endpoints",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  nsg_audit: {
    description:
      "Audit NSGs for overly permissive rules: open 0.0.0.0/0 ingress, any-any rules, dangerous port exposure (RDP/SSH/SQL)",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  rbac_audit: {
    description:
      "Audit RBAC role assignments: Owner/Contributor at subscription level, custom roles with dangerous actions, overprivileged SPs",
    args: "[--subscription-id SUB]",
  },
  sql_enum: {
    description:
      "Enumerate Azure SQL: firewall rules, AD admin, TDE status, auditing config, public endpoint exposure, connection strings",
    args: "[--subscription-id SUB] [--server NAME]",
  },
  app_service_enum: {
    description:
      "Enumerate App Services: connection strings, app settings with secrets, SCM/Kudu access, managed identity, CORS config",
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
    description:
      "Data Factory pipelines and linked services — extract connection strings to production databases and storage",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  front_door_enum: {
    description:
      "Front Door / Application Gateway / WAF: origins, routing rules, WAF policies, exclusions, backend exposure",
    args: "[--subscription-id SUB]",
  },
  container_instance_enum: {
    description: "Azure Container Instances: running groups, env vars (secrets), mounted volumes, networking, identity",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  apim_enum: {
    description: "API Management: APIs, subscription keys, named values/secrets, backend configs, developer portal",
    args: "[--subscription-id SUB]",
  },
  databricks_enum: {
    description: "Azure Databricks: workspaces, clusters, notebooks, secrets, DBFS, jobs, service principals",
    args: "[--subscription-id SUB]",
  },
  app_insights_enum: {
    description: "Application Insights: instrumentation keys, API keys, telemetry data, availability tests, smart detection rules",
    args: "[--subscription-id SUB]",
  },
  monitor_enum: {
    description: "Azure Monitor: log profiles, diagnostic settings, action groups, alert rules — reveals monitoring coverage and gaps",
    args: "[--subscription-id SUB]",
  },
  recovery_vault_enum: {
    description: "Recovery Services Vaults: backup policies, protected items, replication, soft-delete status",
    args: "[--subscription-id SUB]",
  },
  intune_enum: {
    description: "Intune/Endpoint Manager: managed devices, compliance policies, configuration profiles, device scripts",
    args: "",
  },
  graph_user_enum: {
    description: "Microsoft Graph deep user enumeration: all attributes, manager chain, group memberships, auth methods, registered devices",
    args: "[--target USER_UPN]",
  },
  app_registration_enum: {
    description: "Entra app registration deep dive: API permissions, owner analysis, credential expiry, reply URLs, dangerous configs",
    args: "",
  },
  logic_app_connector_enum: {
    description: "Logic App connectors: OAuth connections, managed API connections, shared access keys, linked services",
    args: "[--subscription-id SUB]",
  },
  automation_runbook_enum: {
    description: "Automation Account deep dive: runbook source, schedules, variables, credentials, webhooks, hybrid workers",
    args: "[--subscription-id SUB]",
  },
  synapse_enum: {
    description: "Azure Synapse Analytics: workspaces, SQL pools, Spark pools, linked services, pipeline secrets",
    args: "[--subscription-id SUB]",
  },
  purview_enum: {
    description: "Microsoft Purview: governance accounts, data sources, classifications, sensitivity labels, scan rules",
    args: "[--subscription-id SUB]",
  },
  subdomain_takeover: {
    description: "Detect Azure subdomain takeover: dangling DNS records pointing to deprovisioned Azure services (CNAME hijack)",
    args: "[--subscription-id SUB]",
  },
  stale_permission_audit: {
    description: "Find stale RBAC assignments: deleted/disabled users with active roles, SP with no recent sign-ins",
    args: "[--subscription-id SUB]",
  },
  public_exposure_scan: {
    description: "Scan for publicly exposed Azure resources: open storage, exposed APIs, public endpoints, misconfigured NSGs",
    args: "[--subscription-id SUB]",
  },
  cognitive_services_enum: {
    description: "Azure Cognitive Services / AI Services: keys, endpoints, models, deployments, content safety bypasses",
    args: "[--subscription-id SUB]",
  },
  iot_hub_enum: {
    description: "Azure IoT Hub: devices, shared access policies, device twins, message routes, custom endpoints",
    args: "[--subscription-id SUB]",
  },
  signalr_enum: {
    description: "Azure SignalR / Web PubSub: connection strings, access keys, upstream settings, hub configurations",
    args: "[--subscription-id SUB]",
  },
  event_grid_enum: {
    description: "Event Grid: topics, subscriptions, domains, system topics — event-driven attack surface mapping",
    args: "[--subscription-id SUB]",
  },
  batch_enum: {
    description: "Azure Batch: account keys, pool allocation, public access, auto storage",
    args: "[--subscription-id SUB]",
  },
  maps_search_enum: {
    description: "Azure Maps: accounts, keys, creators, CORS settings, usage for geolocation tracking",
    args: "[--subscription-id SUB]",
  },
  sentinel_enum: {
    description: "Azure Sentinel: workspaces, data connectors, analytics rules, incidents, watchlists, threat intelligence",
    args: "[--subscription-id SUB]",
  },
  vpn_gateway_enum: {
    description: "VPN Gateway: connections, shared keys, BGP settings, local network gateways — on-prem tunnel access",
    args: "[--subscription-id SUB]",
  },
  express_route_enum: {
    description: "ExpressRoute: circuits, peering configs, route tables, cross-connections — direct datacenter links",
    args: "[--subscription-id SUB]",
  },
  private_link_audit: {
    description: "Private Link / Private Endpoint audit: connections, DNS zones, approval state, PaaS service exposure",
    args: "[--subscription-id SUB]",
  },
  databricks_secret_dump: {
    description: "Databricks: list workspaces, scopes, secrets — extract secret values where accessible",
    args: "[--subscription-id SUB]",
  },
  service_fabric_enum: {
    description: "Service Fabric clusters: nodes, applications, services, health state, security configuration",
    args: "[--subscription-id SUB]",
  },
  batch_account_enum: {
    description: "Azure Batch accounts: pools, jobs, tasks, auto-scale, shared key auth, public access",
    args: "[--subscription-id SUB]",
  },
  managed_env_enum: {
    description: "Container App managed environments: apps, container images, ingress endpoints, VNet configuration",
    args: "[--subscription-id SUB]",
  },
  static_web_app_enum: {
    description: "Static Web Apps: deployments, custom domains, linked API backends, deployment tokens",
    args: "[--subscription-id SUB]",
  },

  // ── Credential Harvesting (14) ──
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
    description:
      "Extract credentials and metadata from Azure IMDS: subscription info, VM identity tokens, network config",
    args: "[--resource RESOURCE_URL]",
  },
  device_code_phish: {
    description:
      "Initiate device code auth flow for phishing — generates user_code, polls for token. #1 Azure initial access technique",
    args: "[--client-id ID] [--scope SCOPE] [--tenant TENANT]",
  },
  token_theft: {
    description:
      "Extract Azure tokens from local files: .azure/ profile, accessTokens.json, msal_token_cache, az CLI cache",
    args: "",
  },
  certificate_abuse: {
    description:
      "Generate/upload certificate for SP auth — bypasses MFA and conditional access. Enumerate existing cert credentials",
    args: "--app-id ID [--generate] [--subscription-id SUB]",
  },
  storage_key_dump: {
    description:
      "Extract storage account access keys and generate SAS tokens for all accessible accounts. Keys never expire",
    args: "[--account-name NAME] [--subscription-id SUB]",
  },
  automation_cred_dump: {
    description:
      "Extract credentials, variables, and certificates from Azure Automation Accounts including RunAs accounts",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  graph_token_harvest: {
    description: "Harvest OAuth tokens for 10 Azure resource audiences: Graph, Management, Key Vault, SQL, Storage, DevOps",
    args: "",
  },
  refresh_token_replay: {
    description: "Decode JWT tokens, extract PRT info (Windows), analyze local MSAL token caches for credential replay",
    args: "",
  },
  runbook_cred_extract: {
    description: "Export Automation Account runbook source code and scan for hardcoded credentials (passwords, connection strings, API keys)",
    args: "[--subscription-id SUB] [--automation-account NAME] [--resource-group RG]",
  },
  kubeconfig_dump: {
    description: "Extract AKS admin/user kubeconfig — full cluster access via management plane without network connectivity",
    args: "[--subscription-id SUB] [--cluster NAME] [--resource-group RG]",
  },
  webapp_env_dump: {
    description: "Extract App Service/Function App settings, connection strings, and publishing credentials with sensitive data detection",
    args: "[--subscription-id SUB] [--app NAME] [--resource-group RG]",
  },

  // ── Privilege Escalation (11) ──
  entra_privesc: {
    description:
      "Exploit Entra ID misconfigs: consent grant, SP secret injection, role assignment for privilege escalation",
    args: "--method <consent_grant|sp_secret|role_assign> [--target-id ID]",
  },
  custom_role_exploit: {
    description: "Find custom RBAC roles with dangerous actions: */write, Microsoft.Authorization/*, deployment write",
    args: "[--subscription-id SUB]",
  },
  conditional_access_audit: {
    description:
      "Enumerate CA policies — find gaps: no MFA for admins, excluded users, trusted locations, legacy auth allowed",
    args: "",
  },
  pim_abuse: {
    description:
      "Enumerate PIM eligible roles — find roles with no approval required. Attempt activation for instant admin",
    args: "[--role-id ID] [--activate]",
  },
  managed_identity_privesc: {
    description:
      "Cross-reference managed identities with RBAC — find over-privileged identities (Contributor on subscription)",
    args: "[--subscription-id SUB]",
  },
  deployment_privesc: {
    description:
      "Abuse deployments/write to deploy ARM template creating new Owner role assignment. Shows exploit template",
    args: "[--subscription-id SUB] [--resource-group RG]",
  },
  global_admin_elevate: {
    description: "Check Global Admin elevation to Azure resource access — enumerate all subscriptions after elevation, PIM eligible roles",
    args: "",
  },
  app_admin_privesc: {
    description: "Analyze service principal Graph API permissions and RBAC for privilege escalation paths via app credentials",
    args: "[--subscription-id SUB]",
  },
  resource_hierarchy_abuse: {
    description: "Analyze management group/subscription hierarchy, custom roles with wildcard actions, resource lock gaps",
    args: "[--subscription-id SUB]",
  },
  group_membership_abuse: {
    description: "Find role-assignable groups with owners, dynamic groups with weak membership rules for privilege escalation",
    args: "",
  },
  partner_admin_abuse: {
    description: "Enumerate GDAP/DAP partner relationships, cross-tenant access policies, partner trust configurations",
    args: "",
  },

  // ── Persistence (11) ──
  runbook_backdoor: {
    description:
      "Create/modify Automation Account runbook with reverse shell payload, publish and schedule for persistence",
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
    description:
      "Deploy Custom Script Extension on VMs for persistent code execution — survives VM restart, runs as SYSTEM/root",
    args: "--vm-name VM --resource-group RG --command CMD [--os windows|linux]",
  },
  webhook_persist: {
    description:
      "Create Event Grid subscription with webhook endpoint — event-driven callbacks on Azure resource changes",
    args: "--endpoint URL [--event-type TYPE] [--subscription-id SUB]",
  },
  devops_pipeline_backdoor: {
    description:
      "Inject steps into Azure DevOps pipeline YAML or create new pipeline with malicious build/release steps",
    args: "--org ORG --project PROJECT [--pipeline-id ID] [--callback-url URL]",
  },
  lighthouse_persist: {
    description:
      "Create Azure Lighthouse delegation to external tenant — rarely audited cross-tenant persistent access",
    args: "--tenant-id TENANT --principal-id PRINCIPAL [--role ROLE] [--subscription-id SUB]",
  },
  acr_image_backdoor: {
    description: "Enumerate ACR registries and repos, extract admin credentials, backdoor container images via tag replacement",
    args: "[--registry NAME] [--image IMAGE] [--method list|creds|inject] [--subscription-id SUB]",
  },
  scheduled_task_persist: {
    description: "Create Azure Automation schedules linked to runbooks for periodic execution persistence",
    args: "[--automation-account NAME] [--resource-group RG] [--runbook-name NAME] [--method list|create]",
  },
  oauth_app_persist: {
    description: "Enumerate OAuth apps/grants, add backdoor credentials to existing high-permission apps for persistent access",
    args: "[--name NAME] [--method list|add_cred]",
  },

  // ── Lateral Movement (10) ──
  vm_run_command: {
    description:
      "Execute commands on Azure VMs via Run Command API — no SSH/RDP needed, works through management plane even without public IP",
    args: "--vm-name VM --resource-group RG --cmd CMD [--os windows|linux]",
  },
  bastion_tunnel: {
    description:
      "Enumerate Azure Bastion hosts and create SSH/RDP tunnels to VMs in private VNets through management plane",
    args: "[--resource-group RG] [--target-vm VM] [--ssh-key KEY]",
  },
  arc_exec: {
    description:
      "Execute commands on Azure Arc-connected machines (on-prem/multi-cloud) — compromise Azure = compromise on-prem",
    args: "[--machine-name NAME] [--resource-group RG] [--cmd CMD]",
  },
  devops_service_conn: {
    description:
      "Enumerate Azure DevOps service connections — extract credentials for cross-environment pivoting to K8s, Docker, other subs",
    args: "--org ORG --project PROJECT",
  },
  cross_tenant_enum: {
    description:
      "Enumerate cross-tenant access settings, B2B collaborations, guest user access for multi-tenant pivoting",
    args: "",
  },
  custom_script_ext: {
    description: "Deploy Custom Script Extensions on VMs for lateral movement via management plane — list existing or deploy new",
    args: "[--vm-name VM] [--resource-group RG] [--script-uri URL] [--command CMD] [--os linux|windows] [--method list|deploy]",
  },
  userdata_command: {
    description: "Inject user data / custom data into VMs for code execution on cloud-init cycle — no network access needed",
    args: "[--vm-name VM] [--resource-group RG] [--user-data BASE64] [--method list|inject]",
  },
  intune_deploy: {
    description: "Enumerate Intune managed devices and deploy PowerShell scripts as SYSTEM for mass lateral movement",
    args: "[--action list|deploy_script]",
  },
  msbuild_exec: {
    description: "Enumerate Azure DevOps agent pools and self-hosted build agents for code execution on org infrastructure",
    args: "[--org ORG] [--project PROJECT] [--method list|exec]",
  },
  shared_image_inject: {
    description: "Enumerate Shared Image Galleries and inject backdoored image versions for supply-chain compromise of VM deployments",
    args: "[--gallery NAME] [--resource-group RG] [--method list|inject] [--subscription-id SUB]",
  },

  // ── Defense Evasion (11) ──
  diagnostic_tamper: {
    description: "Manipulate Azure diagnostic settings and activity logs — identify monitoring blind spots for evasion",
    args: "--action <status|disable> [--subscription-id SUB] [--resource-id RID]",
  },
  sentinel_suppress: {
    description: "Suppress/close Azure Sentinel incidents, disable analytics rules — blinds the SOC",
    args: "--action <list|close|disable_rule> [--subscription-id SUB] [--workspace WS]",
  },
  defender_disable: {
    description:
      "Disable Defender for Cloud plans (Servers, Storage, SQL, Containers, KeyVault, DNS, ARM) per subscription",
    args: "[--plan PLAN] [--subscription-id SUB]",
  },
  activity_log_tamper: {
    description:
      "Modify Activity Log diagnostic settings — change retention, delete/redirect log sinks to cover tracks",
    args: "--action <status|delete|redirect> [--subscription-id SUB]",
  },
  policy_exempt: {
    description:
      "Create Azure Policy exemptions to bypass security guardrails — stealthy, doesn't remove the policy itself",
    args: "--assignment ASSIGNMENT --name NAME [--subscription-id SUB]",
  },
  waf_bypass: {
    description: "Modify/disable Azure WAF policies — change mode from Prevention to Detection, add exclusion rules",
    args: "--action <list|disable|exclude> [--subscription-id SUB]",
  },
  alert_suppress: {
    description:
      "Suppress Azure Monitor alerts — disable alert rules, remove notification recipients from action groups",
    args: "--action <list|disable|suppress> [--subscription-id SUB]",
  },
  log_analytics_tamper: {
    description: "Tamper with Log Analytics workspace: reduce retention, set low daily cap, purge logs to blind SIEM/SOC",
    args: "[--action status|reduce_retention|set_daily_cap|purge] [--workspace NAME] [--resource-group RG] [--subscription-id SUB]",
  },
  nsg_flow_log_disable: {
    description: "Audit and disable NSG flow logs — enumerate NSGs without flow logging, disable existing flow logs",
    args: "[--action status|disable] [--nsg-name NAME] [--resource-group RG] [--subscription-id SUB]",
  },
  resource_move: {
    description: "Move resources between resource groups to evade RG-scoped monitoring, policies, and alert rules",
    args: "[--action list|create_rg|move] [--source-rg RG] [--target-rg RG] [--resource-id ID] [--subscription-id SUB]",
  },
  tag_manipulation: {
    description: "Audit and modify resource tags to bypass tag-based policies, compliance scopes, and monitoring rules",
    args: "[--action status|modify|remove] [--resource-id ID] [--tag-name NAME] [--tag-value VALUE] [--subscription-id SUB]",
  },

  // ── Exfiltration (12) ──
  storage_dump: {
    description: "Enumerate and download sensitive data from Azure Blob Storage containers",
    args: "[--account-name NAME] [--container CONTAINER] [--download] [--pattern REGEX]",
  },
  cosmos_dump: {
    description:
      "Enumerate and extract data from Cosmos DB — list databases, containers, query documents for sensitive data",
    args: "--account NAME [--database DB] [--container CONTAINER] [--query QUERY] [--max-items N]",
  },
  disk_snapshot: {
    description: "Create managed disk snapshots for offline analysis — export via SAS URL or share cross-subscription",
    args: "--disk-id DISK_ID --resource-group RG [--share-sub SUB]",
  },
  table_queue_dump: {
    description:
      "Extract data from Azure Table Storage and Queue Storage — enumerate tables, query entities, peek queue messages",
    args: "--account-name NAME [--table TABLE] [--queue QUEUE]",
  },
  file_share_dump: {
    description:
      "Enumerate and download from Azure File Shares (SMB) — find credentials and config files in mounted shares",
    args: "--account-name NAME [--share SHARE] [--pattern REGEX]",
  },
  data_lake_dump: {
    description:
      "Enumerate and extract from Azure Data Lake Storage Gen2 — filesystem listing, ACL checks, selective download",
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
  graph_mail_dump: {
    description: "Exfiltrate emails via Microsoft Graph API — read mail folders, search messages, detect forwarding rules",
    args: "[--target me|USER_UPN] [--folder FOLDER] [--search QUERY] [--max-items N]",
  },
  sharepoint_dump: {
    description: "Enumerate SharePoint sites and document libraries, search documents across all accessible sites via Graph API",
    args: "[--site NAME] [--search QUERY] [--max-items N]",
  },
  teams_dump: {
    description: "Enumerate Microsoft Teams channels and extract messages — chat history may contain credentials and sensitive data",
    args: "[--team NAME] [--channel NAME] [--max-items N]",
  },
  vm_disk_download: {
    description: "Snapshot VM disks and generate SAS URLs for full disk download and offline forensic analysis",
    args: "[--action list|snapshot_and_export] [--vm-name VM] [--disk-name DISK] [--resource-group RG] [--subscription-id SUB]",
  },

  // ── CIS Compliance (18) ──
  defender_plan_audit: {
    description: "CIS 2.1: Audit Defender for Cloud plan status across all resource types — check for disabled/free-tier plans",
    args: "[--subscription-id SUB]",
  },
  defender_contact_audit: {
    description: "CIS 2.1.21: Verify security contact configuration for high-severity alerts and email notifications",
    args: "[--subscription-id SUB]",
  },
  storage_security_audit: {
    description: "CIS 3.x: Audit storage account security — HTTPS enforcement, TLS version, public access, SAS expiry, key rotation",
    args: "[--subscription-id SUB]",
  },
  sql_audit_config: {
    description: "CIS 4.1.x: Audit Azure SQL security — auditing, TDE, Advanced Threat Protection, AD admin, firewall rules",
    args: "[--subscription-id SUB]",
  },
  postgres_audit: {
    description: "CIS 4.3.x: Audit PostgreSQL Flexible Server security — SSL, connection throttling, log checkpoints, retention",
    args: "[--subscription-id SUB]",
  },
  mysql_audit: {
    description: "CIS 4.4.x: Audit MySQL Flexible Server security — SSL enforcement, audit logging, TLS version",
    args: "[--subscription-id SUB]",
  },
  cosmos_security_audit: {
    description: "CIS 4.5.x: Audit Cosmos DB security — network restrictions, key-based auth, RBAC, managed identity access",
    args: "[--subscription-id SUB]",
  },
  diagnostic_audit: {
    description: "CIS 5.1.x: Audit diagnostic settings — ensure key resources have logging enabled to Log Analytics or Storage",
    args: "[--subscription-id SUB]",
  },
  activity_alert_audit: {
    description: "CIS 5.2.x: Audit Activity Log alerts — verify alerts exist for critical operations (policy, NSG, SQL, security)",
    args: "[--subscription-id SUB]",
  },
  network_watcher_audit: {
    description: "CIS 5.5: Verify Network Watcher is enabled in all regions with resources — required for NSG flow logs",
    args: "[--subscription-id SUB]",
  },
  vm_security_audit: {
    description: "CIS 7.x: Audit VM security — disk encryption, endpoint protection, approved extensions, trusted launch",
    args: "[--subscription-id SUB]",
  },
  appservice_security_audit: {
    description: "CIS 9.x: Audit App Service security — HTTPS, TLS 1.2+, managed identity, remote debugging, FTP state",
    args: "[--subscription-id SUB]",
  },
  keyvault_security_audit: {
    description: "CIS 8.x: Audit Key Vault security — RBAC vs access policies, soft-delete, purge protection, private endpoints",
    args: "[--subscription-id SUB]",
  },
  identity_mfa_audit: {
    description: "CIS 1.1.x: Audit MFA enforcement for all users, admins, and guest accounts via Conditional Access policies",
    args: "",
  },
  guest_access_audit: {
    description: "CIS 1.3-1.5: Audit guest user access restrictions, invitation settings, and external collaboration policies",
    args: "",
  },
  password_policy_audit: {
    description: "CIS 1.7-1.8: Audit password policies — banned passwords, self-service reset, lockout thresholds, expiry settings",
    args: "",
  },
  resource_lock_audit: {
    description: "CIS 8.5: Audit resource locks on critical resources — CanNotDelete or ReadOnly locks prevent accidental deletion",
    args: "[--subscription-id SUB]",
  },
  policy_compliance_audit: {
    description: "Audit Azure Policy compliance — non-compliant resources, policy assignments, initiative coverage, exemptions",
    args: "[--subscription-id SUB]",
  },

  // ── Identity Attack (10) ──
  federation_backdoor: {
    description: "Analyze and exploit Entra ID federation settings for persistent access via trusted domain federation",
    args: "",
  },
  pta_abuse: {
    description: "Enumerate Pass-Through Authentication agents — compromise PTA agent host for credential interception",
    args: "",
  },
  aadconnect_dump: {
    description: "Detect Azure AD Connect servers and extract sync credentials for on-prem Active Directory access",
    args: "",
  },
  seamless_sso_abuse: {
    description: "Enumerate Seamless SSO configuration — Kerberos-based SSO can be abused for ticket forging",
    args: "",
  },
  saml_forge: {
    description: "Analyze SAML/WS-Fed SSO configurations — find certificate-based auth weaknesses for Golden SAML attacks",
    args: "",
  },
  mfa_manipulation: {
    description: "Enumerate user MFA methods, find users without MFA, analyze legacy auth protocols that bypass MFA",
    args: "[--target USER_UPN]",
  },
  user_creation: {
    description: "Create backdoor Entra ID users with role assignments for persistent access (requires User Administrator)",
    args: "[--method list|create] [--upn UPN] [--role ROLE]",
  },
  password_spray: {
    description: "Analyze password policy and sign-in logs for password spray feasibility — lockout thresholds, smart lockout, success rates",
    args: "",
  },
  tenant_recon_insider: {
    description: "Deep tenant reconnaissance from authenticated insider — directory settings, licensing, security defaults, legacy protocols",
    args: "",
  },
  consent_phish: {
    description: "Analyze OAuth consent grant attack surface — illicit consent grants, admin-consented permissions, consent workflow gaps",
    args: "",
  },

  // ── Impact (5) ──
  resource_hijack: {
    description: "Enumerate crypto-mining opportunities — underutilized VMs, VMSS auto-scale, Batch accounts, Spot instances for resource hijacking",
    args: "[--subscription-id SUB]",
  },
  data_destroy: {
    description: "Assess data destruction impact — storage accounts without soft-delete, databases without backup, unprotected resources",
    args: "[--subscription-id SUB]",
  },
  ransomware_sim: {
    description: "Simulate ransomware impact assessment — find unencrypted disks, backup gaps, recovery vault weaknesses",
    args: "[--subscription-id SUB]",
  },
  account_lockout: {
    description: "Assess account lockout impact — enumerate users, smart lockout policies, lockout thresholds and duration",
    args: "",
  },
  service_disruption: {
    description: "Assess service disruption impact — auto-scale manipulation, DNS poisoning, certificate deletion, WAF bypass",
    args: "[--subscription-id SUB]",
  },

  // ── M365 (4) ──
  exchange_abuse: {
    description: "Enumerate Exchange Online: mailbox permissions, transport rules, forwarding rules, mail-enabled security groups",
    args: "",
  },
  sharepoint_enum: {
    description: "Enumerate SharePoint Online: sites, permissions, external sharing, sensitivity labels, DLP policies",
    args: "",
  },
  teams_m365_enum: {
    description: "Enumerate Teams: settings, guest access, messaging policies, external access, app permissions",
    args: "",
  },
  onedrive_access: {
    description: "Enumerate OneDrive: accessible drives, shared files, recent documents, external sharing status",
    args: "",
  },

  // ── Cleanup (1) ──
  cleanup_azure: {
    description:
      "Remove all CyberStrike-created Azure resources: SPs, runbooks, extensions, event grid subs, policy exemptions, snapshots. ALWAYS run before leaving",
    args: "[--dry-run]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS

const dispatch: Record<Program, (args: string[], timeout: number) => Promise<HookResult>> = {
  // Recon (45)
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
  apim_enum: apimEnum,
  databricks_enum: databricksEnum,
  app_insights_enum: appInsightsEnum,
  monitor_enum: monitorEnum,
  recovery_vault_enum: recoveryVaultEnum,
  intune_enum: intuneEnum,
  graph_user_enum: graphUserEnum,
  app_registration_enum: appRegistrationEnum,
  logic_app_connector_enum: logicAppConnectorEnum,
  automation_runbook_enum: automationRunbookEnum,
  synapse_enum: synapseEnum,
  purview_enum: purviewEnum,
  subdomain_takeover: subdomainTakeover,
  stale_permission_audit: stalePermissionAudit,
  public_exposure_scan: publicExposureScan,
  cognitive_services_enum: cognitiveServicesEnum,
  iot_hub_enum: iotHubEnum,
  signalr_enum: signalrEnum,
  event_grid_enum: eventGridEnum,
  batch_enum: batchEnum,
  maps_search_enum: mapsSearchEnum,
  sentinel_enum: sentinelEnum,
  vpn_gateway_enum: vpnGatewayEnum,
  express_route_enum: expressRouteEnum,
  private_link_audit: privateLinkAudit,
  databricks_secret_dump: databricksSecretDump,
  service_fabric_enum: serviceFabricEnum,
  batch_account_enum: batchAccountEnum,
  managed_env_enum: managedEnvEnum,
  static_web_app_enum: staticWebAppEnum,
  // Credential (14)
  keyvault_dump: keyvaultDump,
  managed_identity: managedIdentity,
  azuread_token: azureadToken,
  imds_harvest: imdsHarvest,
  device_code_phish: deviceCodePhish,
  token_theft: tokenTheft,
  certificate_abuse: certificateAbuse,
  storage_key_dump: storageKeyDump,
  automation_cred_dump: automationCredDump,
  graph_token_harvest: graphTokenHarvest,
  refresh_token_replay: refreshTokenReplay,
  runbook_cred_extract: runbookCredExtract,
  kubeconfig_dump: kubeconfigDump,
  webapp_env_dump: webappEnvDump,
  // Privesc (11)
  entra_privesc: entraPrivesc,
  custom_role_exploit: customRoleExploit,
  conditional_access_audit: conditionalAccessAudit,
  pim_abuse: pimAbuse,
  managed_identity_privesc: managedIdentityPrivesc,
  deployment_privesc: deploymentPrivesc,
  global_admin_elevate: globalAdminElevate,
  app_admin_privesc: appAdminPrivesc,
  resource_hierarchy_abuse: resourceHierarchyAbuse,
  group_membership_abuse: groupMembershipAbuse,
  partner_admin_abuse: partnerAdminAbuse,
  // Persistence (11)
  runbook_backdoor: runbookBackdoor,
  logic_app_backdoor: logicAppBackdoor,
  function_app_backdoor: functionAppBackdoor,
  sp_persist: spPersist,
  vm_extension_backdoor: vmExtensionBackdoor,
  webhook_persist: webhookPersist,
  devops_pipeline_backdoor: devopsPipelineBackdoor,
  lighthouse_persist: lighthousePersist,
  acr_image_backdoor: acrImageBackdoor,
  scheduled_task_persist: scheduledTaskPersist,
  oauth_app_persist: oauthAppPersist,
  // Lateral (10)
  vm_run_command: vmRunCommand,
  bastion_tunnel: bastionTunnel,
  arc_exec: arcExec,
  devops_service_conn: devopsServiceConn,
  cross_tenant_enum: crossTenantEnum,
  custom_script_ext: customScriptExt,
  userdata_command: userdataCommand,
  intune_deploy: intuneDeploy,
  msbuild_exec: msbuildExec,
  shared_image_inject: sharedImageInject,
  // Evasion (11)
  diagnostic_tamper: diagnosticTamper,
  sentinel_suppress: sentinelSuppress,
  defender_disable: defenderDisable,
  activity_log_tamper: activityLogTamper,
  policy_exempt: policyExempt,
  waf_bypass: wafBypass,
  alert_suppress: alertSuppress,
  log_analytics_tamper: logAnalyticsTamper,
  nsg_flow_log_disable: nsgFlowLogDisable,
  resource_move: resourceMove,
  tag_manipulation: tagManipulation,
  // Exfil (12)
  storage_dump: storageDump,
  cosmos_dump: cosmosDump,
  disk_snapshot: diskSnapshot,
  table_queue_dump: tableQueueDump,
  file_share_dump: fileShareDump,
  data_lake_dump: dataLakeDump,
  service_bus_sniff: serviceBusSniff,
  event_hub_tap: eventHubTap,
  graph_mail_dump: graphMailDump,
  sharepoint_dump: sharepointDump,
  teams_dump: teamsDump,
  vm_disk_download: vmDiskDownload,
  // Compliance (18)
  defender_plan_audit: defenderPlanAudit,
  defender_contact_audit: defenderContactAudit,
  storage_security_audit: storageSecurityAudit,
  sql_audit_config: sqlAuditConfig,
  postgres_audit: postgresAudit,
  mysql_audit: mysqlAudit,
  cosmos_security_audit: cosmosSecurityAudit,
  diagnostic_audit: diagnosticAudit,
  activity_alert_audit: activityAlertAudit,
  network_watcher_audit: networkWatcherAudit,
  vm_security_audit: vmSecurityAudit,
  appservice_security_audit: appserviceSecurityAudit,
  keyvault_security_audit: keyvaultSecurityAudit,
  identity_mfa_audit: identityMfaAudit,
  guest_access_audit: guestAccessAudit,
  password_policy_audit: passwordPolicyAudit,
  resource_lock_audit: resourceLockAudit,
  policy_compliance_audit: policyComplianceAudit,
  // Identity (10)
  federation_backdoor: federationBackdoor,
  pta_abuse: ptaAbuse,
  aadconnect_dump: aadconnectDump,
  seamless_sso_abuse: seamlessSsoAbuse,
  saml_forge: samlForge,
  mfa_manipulation: mfaManipulation,
  user_creation: userCreation,
  password_spray: passwordSpray,
  tenant_recon_insider: tenantReconInsider,
  consent_phish: consentPhish,
  // Impact (5)
  resource_hijack: resourceHijack,
  data_destroy: dataDestroy,
  ransomware_sim: ransomwareSim,
  account_lockout: accountLockout,
  service_disruption: serviceDisruption,
  // M365 (4)
  exchange_abuse: exchangeAbuse,
  sharepoint_m365_enum: sharepointEnum,
  teams_m365_enum: teamsEnum,
  onedrive_access: onedriveAccess,
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
  "AZ-APIM-001": "CWE-522",
  "AZ-APIM-002": "CWE-200",
  "AZ-DATABRICKS-001": "CWE-200",
  "AZ-APPINSIGHTS-001": "CWE-522",
  "AZ-MONITOR-001": "CWE-778",
  "AZ-VAULT-001": "CWE-693",
  "AZ-INTUNE-ENUM-001": "CWE-200",
  "AZ-GRAPHUSER-001": "CWE-200",
  "AZ-APPREG-001": "CWE-522",
  "AZ-LOGIC-CONN-001": "CWE-522",
  "AZ-AUTO-ENUM-001": "CWE-200",
  "AZ-SYNAPSE-001": "CWE-200",
  "AZ-PURVIEW-001": "CWE-200",
  "AZ-SUBDOMAIN-001": "CWE-672",
  "AZ-STALE-001": "CWE-269",
  "AZ-PUBLIC-001": "CWE-284",
  "AZ-COG-001": "CWE-522",
  "AZ-SF-001": "CWE-200",
  "AZ-CAPP-001": "CWE-200",
  "AZ-SWA-001": "CWE-200",
  "AZ-IOT-001": "CWE-522",
  "AZ-SIGNALR-001": "CWE-522",
  "AZ-EVTGRID-001": "CWE-200",
  "AZ-BATCH-001": "CWE-522",
  "AZ-MAPS-001": "CWE-522",
  "AZ-SENTINEL-ENUM-001": "CWE-200",
  "AZ-VPN-001": "CWE-522",
  "AZ-ER-001": "CWE-200",
  "AZ-PL-001": "CWE-284",
  "AZ-BATCH-002": "CWE-522",
  "AZ-SWA-002": "CWE-522",
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
  "AZ-GRAPH-001": "CWE-522",
  "AZ-PRT-001": "CWE-522",
  "AZ-PRT-002": "CWE-522",
  "AZ-PRT-003": "CWE-312",
  "AZ-RUNBOOK-001": "CWE-798",
  "AZ-KUBE-001": "CWE-284",
  "AZ-KUBE-002": "CWE-284",
  "AZ-KUBE-003": "CWE-522",
  "AZ-KUBE-004": "CWE-522",
  "AZ-WEBAPP-001": "CWE-312",
  "AZ-WEBAPP-002": "CWE-312",
  "AZ-WEBAPP-003": "CWE-522",
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
  "AZ-DEPLOY-002": "CWE-269",
  "AZ-GA-001": "CWE-269",
  "AZ-GA-002": "CWE-269",
  "AZ-GA-003": "CWE-269",
  "AZ-APPADMIN-001": "CWE-269",
  "AZ-APPADMIN-002": "CWE-269",
  "AZ-HIER-001": "CWE-269",
  "AZ-HIER-002": "CWE-269",
  "AZ-HIER-003": "CWE-693",
  "AZ-GROUP-001": "CWE-269",
  "AZ-GROUP-002": "CWE-269",
  "AZ-GROUP-003": "CWE-269",
  "AZ-PARTNER-001": "CWE-284",
  "AZ-PARTNER-002": "CWE-284",
  "AZ-PARTNER-003": "CWE-284",
  // Persistence
  "AZ-PERSIST-001": "CWE-547",
  "AZ-PERSIST-002": "CWE-547",
  "AZ-PERSIST-003": "CWE-547",
  "AZ-PERSIST-004": "CWE-547",
  "AZ-EXT-001": "CWE-94",
  "AZ-WEBHOOK-001": "CWE-547",
  "AZ-DEVOPS-001": "CWE-94",
  "AZ-LH-001": "CWE-284",
  "AZ-LH-002": "CWE-284",
  "AZ-ACR-PERSIST-001": "CWE-284",
  "AZ-ACR-PERSIST-002": "CWE-522",
  "AZ-ACR-PERSIST-003": "CWE-94",
  "AZ-SCHED-001": "CWE-547",
  "AZ-OAUTH-001": "CWE-269",
  "AZ-OAUTH-002": "CWE-269",
  "AZ-OAUTH-003": "CWE-522",
  // Lateral
  "AZ-RUNCMD-001": "CWE-78",
  "AZ-RUNCMD-002": "CWE-78",
  "AZ-BASTION-001": "CWE-284",
  "AZ-ARC-001": "CWE-78",
  "AZ-SVCCONN-001": "CWE-522",
  "AZ-XTENANT-001": "CWE-284",
  "AZ-XTENANT-002": "CWE-284",
  "AZ-XTENANT-003": "CWE-200",
  "AZ-LATERAL-001": "CWE-78",
  "AZ-CSE-001": "CWE-94",
  "AZ-UDATA-001": "CWE-200",
  "AZ-UDATA-002": "CWE-94",
  "AZ-INTUNE-001": "CWE-200",
  "AZ-INTUNE-002": "CWE-94",
  "AZ-BUILD-001": "CWE-94",
  "AZ-BUILD-002": "CWE-94",
  "AZ-SIG-001": "CWE-200",
  "AZ-SIG-002": "CWE-94",
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
  "AZ-ALERT-003": "CWE-778",
  "AZ-LAW-001": "CWE-778",
  "AZ-LAW-002": "CWE-778",
  "AZ-LAW-003": "CWE-778",
  "AZ-NSGFLOW-001": "CWE-778",
  "AZ-NSGFLOW-002": "CWE-778",
  "AZ-MOVE-001": "CWE-693",
  "AZ-MOVE-002": "CWE-693",
  "AZ-TAG-001": "CWE-693",
  "AZ-TAG-002": "CWE-693",
  "AZ-TAG-003": "CWE-693",
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
  "AZ-EHUB-002": "CWE-200",
  "AZ-MAIL-001": "CWE-200",
  "AZ-SP-EXFIL-001": "CWE-200",
  "AZ-SP-EXFIL-002": "CWE-200",
  "AZ-TEAMS-001": "CWE-200",
  "AZ-TEAMS-002": "CWE-200",
  "AZ-VMDISK-001": "CWE-200",
  "AZ-VMDISK-002": "CWE-200",
  // Compliance
  "AZ-CIS-DEFENDER-001": "CWE-693",
  "AZ-CIS-DEFENDER-002": "CWE-693",
  "AZ-CIS-CONTACT-001": "CWE-778",
  "AZ-CIS-STORAGE-001": "CWE-319",
  "AZ-CIS-STORAGE-002": "CWE-319",
  "AZ-CIS-STORAGE-003": "CWE-284",
  "AZ-CIS-SQL-001": "CWE-778",
  "AZ-CIS-SQL-002": "CWE-311",
  "AZ-CIS-SQL-003": "CWE-693",
  "AZ-CIS-PG-001": "CWE-319",
  "AZ-CIS-PG-002": "CWE-778",
  "AZ-CIS-MYSQL-001": "CWE-319",
  "AZ-CIS-COSMOS-001": "CWE-284",
  "AZ-CIS-DIAG-001": "CWE-778",
  "AZ-CIS-ALERT-001": "CWE-778",
  "AZ-CIS-NW-001": "CWE-778",
  "AZ-CIS-VM-001": "CWE-311",
  "AZ-CIS-VM-002": "CWE-693",
  "AZ-CIS-APPSVC-001": "CWE-319",
  "AZ-CIS-APPSVC-002": "CWE-319",
  "AZ-CIS-KV-001": "CWE-693",
  "AZ-CIS-KV-002": "CWE-284",
  "AZ-CIS-MFA-001": "CWE-287",
  "AZ-CIS-GUEST-001": "CWE-284",
  "AZ-CIS-PWD-001": "CWE-521",
  "AZ-CIS-LOCK-001": "CWE-693",
  "AZ-CIS-POLICY-001": "CWE-693",
  // Identity
  "AZ-FED-001": "CWE-284",
  "AZ-FED-002": "CWE-284",
  "AZ-PTA-001": "CWE-522",
  "AZ-AADC-001": "CWE-522",
  "AZ-SSO-001": "CWE-287",
  "AZ-SAML-001": "CWE-290",
  "AZ-MFA-001": "CWE-287",
  "AZ-MFA-002": "CWE-287",
  "AZ-USERCREATE-001": "CWE-269",
  "AZ-SPRAY-001": "CWE-521",
  "AZ-TENANT-001": "CWE-200",
  "AZ-CONSENT-001": "CWE-269",
  // Impact
  "AZ-HIJACK-001": "CWE-400",
  "AZ-DESTROY-001": "CWE-400",
  "AZ-RANSOM-001": "CWE-311",
  "AZ-LOCKOUT-001": "CWE-307",
  "AZ-DISRUPT-001": "CWE-400",
  // M365
  "AZ-EXCHANGE-001": "CWE-284",
  "AZ-EXCHANGE-002": "CWE-200",
  "AZ-SPO-001": "CWE-284",
  "AZ-M365TEAMS-001": "CWE-284",
  "AZ-ONEDRIVE-001": "CWE-200",
  // Cleanup
  "AZ-CLEANUP-001": "CWE-1254",
}

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const AzurehookTool = Tool.define("azurehook", {
  description: `Execute an Azure post-exploitation program. 154 programs across 13 categories: recon (47), credential (14), privesc (11), persistence (11), lateral (10), identity (10), evasion (11), exfil (12), compliance (18), impact (5), m365 (4), cleanup (1). Uses az CLI, Azure REST API, and Microsoft Graph. Available: ${programKeys.join(", ")}. ALWAYS run cleanup_azure before leaving.`,
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
    if (
      !Bun.which("az") &&
      !["managed_identity", "imds_harvest", "token_theft", "device_code_phish"].includes(params.program)
    ) {
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
