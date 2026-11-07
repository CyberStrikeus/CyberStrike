import type { CloudAnalysis } from "cyberstrike/public"

export const CLOUD_GROUPS: CloudAnalysis.GroupDef[] = [
  {
    key: "identity",
    label: "IAM & Identity",
    analyst: "cloud-analyst-identity",
    description:
      "Service accounts, IAM bindings, custom roles, organization policies, cross-project trust, key rotation, workload identity. Foundation for all other groups.",
    programs: [
      "gcp_enum",
      "iam_analyzer",
      "org_enum",
      "sa_key_create",
      "gcp_privesc",
      "custom_role_abuse",
    ],
  },
  {
    key: "compute",
    label: "Compute & Containers",
    analyst: "cloud-analyst-compute",
    description:
      "GCE instances, GKE clusters, node pools, workload identity, OS Login, instance metadata, container exec. Lateral movement via compute.",
    programs: [
      "gke_enum",
      "metadata_harvest_gcp",
      "os_login_abuse",
      "compute_snapshot",
    ],
  },
  {
    key: "network",
    label: "Network & Exposure",
    analyst: "cloud-analyst-network",
    description:
      "VPC networks, subnets, firewall rules, routes, VPN tunnels, Cloud NAT, Cloud DNS zones, DNSSEC. Public exposure and network pivot analysis.",
    programs: [
      "vpc_enum",
      "dns_enum",
      "vpc_firewall_modify",
    ],
  },
  {
    key: "data",
    label: "Data Stores",
    analyst: "cloud-analyst-data",
    description:
      "Cloud SQL, KMS, Spanner, Artifact Registry, Secret Manager, Firestore, GCS buckets, BigQuery, Pub/Sub. Data exposure, encryption, exfiltration paths.",
    programs: [
      "sql_enum",
      "kms_enum",
      "spanner_enum",
      "artifact_registry_enum",
      "secrets_dump_gcp",
      "firestore_dump",
      "gcs_dump",
      "bigquery_dump",
      "pubsub_sniff",
      "source_repo_dump",
      "dlp_scan",
    ],
  },
  {
    key: "privesc",
    label: "Privilege Escalation",
    analyst: "cloud-analyst-privesc",
    description:
      "IAM privilege escalation paths — setIamPolicy, actAs, signBlob, deploy functions, custom role abuse, OS Login exploitation.",
    programs: [
      "gcp_privesc",
      "custom_role_abuse",
      "os_login_abuse",
    ],
  },
  {
    key: "compliance",
    label: "Logging & Compliance",
    analyst: "cloud-analyst-compliance",
    description:
      "Audit logging, log sinks, log-based metrics, alerting policies, VPC flow logs. Identify blind spots and monitoring gaps.",
    programs: [
      "logging_enum",
      "audit_log_tamper",
      "vpc_flow_tamper",
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
