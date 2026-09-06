import type { CloudAnalysis } from "cyberstrike/public"

export const CLOUD_GROUPS: CloudAnalysis.GroupDef[] = [
  {
    key: "identity",
    label: "Identity & Permissions",
    analyst: "cloud-analyst-identity",
    description:
      "Entra ID users/groups/apps, RBAC role assignments, service principals, managed identities, Graph API enumeration. Foundation for all other groups.",
    programs: [
      "subscription_enum",
      "entra_enum",
      "rbac_audit",
      "graph_user_enum",
      "app_registration_enum",
    ],
  },
  {
    key: "compute",
    label: "Compute",
    analyst: "cloud-analyst-compute",
    description:
      "VMs, VMSS, AKS clusters, container instances, managed environments, static web apps, service fabric, batch accounts, app services.",
    programs: [
      "vm_enum",
      "vmss_enum",
      "aks_enum",
      "container_instance_enum",
      "managed_env_enum",
      "static_web_app_enum",
      "service_fabric_enum",
      "batch_account_enum",
      "app_service_enum",
    ],
  },
  {
    key: "network",
    label: "Network",
    analyst: "cloud-analyst-network",
    description:
      "VNets, NSG rules, DNS zones, Front Door, VPN gateways, ExpressRoute, private link configurations.",
    programs: [
      "vnet_enum",
      "nsg_audit",
      "dns_enum",
      "front_door_enum",
      "vpn_gateway_enum",
      "express_route_enum",
      "private_link_audit",
    ],
  },
  {
    key: "data",
    label: "Data Stores",
    analyst: "cloud-analyst-data",
    description:
      "SQL databases, Redis caches, Data Factory pipelines, Synapse workspaces, Purview catalogs.",
    programs: [
      "sql_enum_azure",
      "redis_enum",
      "data_factory_enum",
      "synapse_enum",
      "purview_enum",
    ],
  },
  {
    key: "security",
    label: "Security & Monitoring",
    analyst: "cloud-analyst-security",
    description:
      "Sentinel SIEM, Azure Monitor, Application Insights, Recovery Services vaults.",
    programs: [
      "sentinel_enum",
      "monitor_enum",
      "app_insights_enum",
      "recovery_vault_enum",
    ],
  },
  {
    key: "access",
    label: "Identity & Access Services",
    analyst: "cloud-analyst-access",
    description:
      "Intune MDM, Logic App connectors, Automation runbooks, API Management instances.",
    programs: [
      "intune_enum",
      "logic_app_connector_enum",
      "automation_runbook_enum",
      "apim_enum",
    ],
  },
  {
    key: "specialized",
    label: "Specialized Services",
    analyst: "cloud-analyst-specialized",
    description:
      "Container registries, Databricks, IoT Hub, SignalR, Event Grid, Batch, Maps, Cognitive Services.",
    programs: [
      "acr_enum",
      "databricks_enum",
      "iot_hub_enum",
      "signalr_enum",
      "event_grid_enum",
      "batch_enum",
      "maps_search_enum",
      "cognitive_services_enum",
    ],
  },
  {
    key: "compliance",
    label: "CIS Compliance",
    analyst: "cloud-analyst-compliance",
    description:
      "CIS Azure Foundations Benchmark checks — Defender plans, storage security, SQL audit, VM security, identity MFA, network security, logging, key management.",
    programs: [
      "defender_plan_audit",
      "defender_contact_audit",
      "storage_security_audit",
      "sql_audit_config",
      "postgres_audit",
      "mysql_audit",
      "cosmos_security_audit",
      "diagnostic_audit",
      "activity_alert_audit",
      "network_watcher_audit",
      "vm_security_audit",
      "appservice_security_audit",
      "keyvault_security_audit",
      "identity_mfa_audit",
      "guest_access_audit",
      "password_policy_audit",
      "resource_lock_audit",
      "policy_compliance_audit",
    ],
  },
  {
    key: "exposure",
    label: "Exposure Analysis",
    analyst: "cloud-analyst-exposure",
    description:
      "Public-facing resources, dangling CNAMEs (subdomain takeover), stale/unused permissions.",
    programs: [
      "public_exposure_scan",
      "subdomain_takeover",
      "stale_permission_audit",
      "conditional_access_audit",
    ],
  },
]

export function groupByKey(key: string): CloudAnalysis.GroupDef | undefined {
  return CLOUD_GROUPS.find((g) => g.key === key)
}

export function groupByAnalyst(analyst: string): CloudAnalysis.GroupDef | undefined {
  return CLOUD_GROUPS.find((g) => g.analyst === analyst)
}

export function identityGroup(): CloudAnalysis.GroupDef {
  const g = CLOUD_GROUPS.find((g) => g.key === "identity")
  if (!g) throw new Error("identity group not found in CLOUD_GROUPS")
  return g
}

export function parallelGroups(): CloudAnalysis.GroupDef[] {
  return CLOUD_GROUPS.filter((g) => g.key !== "identity")
}
