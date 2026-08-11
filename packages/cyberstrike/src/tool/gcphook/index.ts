import z from "zod"
import { Tool } from "../tool"
import type { Finding, HookResult } from "./shared"

import { gcpEnum, vpcEnum, iamAnalyzer, sqlEnum, kmsEnum, orgEnum, dnsEnum, loggingEnum, spannerEnum, artifactRegistryEnum, gkeEnum } from "./recon"
import { metadataHarvestGcp, secretsDumpGcp, saKeyCreate, firestoreDump } from "./credential"
import { gcpPrivesc, customRoleAbuse, osLoginAbuse } from "./privesc"
import { cloudfuncBackdoor, cloudRunBackdoor, schedulerPersist, cloudBuildBackdoor, composerBackdoor } from "./persistence"
import { gcsDump, bigqueryDump, computeSnapshot, pubsubSniff, sourceRepoDump, dlpScan } from "./exfil"
import { auditLogTamper, vpcFlowTamper, vpcFirewallModify } from "./evasion"
import { cleanupGcp } from "./cleanup"

const PROGRAMS = {
  // ── Recon (11) ──
  gcp_enum: {
    description: "Enumerate GCP project resources: compute instances, GKE clusters, Cloud SQL, Cloud Functions, Cloud Run, storage buckets, IAM policies, VPCs, firewalls",
    args: "[--project PROJECT]",
  },
  vpc_enum: {
    description: "Enumerate VPC networks, subnets, firewall rules, routes, Cloud NAT, and VPN tunnels",
    args: "[--project PROJECT]",
  },
  iam_analyzer: {
    description: "Deep IAM analysis: overprivileged service accounts, custom roles with dangerous permissions, cross-project bindings, key rotation status",
    args: "[--project PROJECT]",
  },
  sql_enum: {
    description: "Enumerate Cloud SQL instances: version, flags, SSL enforcement, authorized networks, backup status, public IP exposure",
    args: "[--project PROJECT]",
  },
  kms_enum: {
    description: "Enumerate Cloud KMS keyrings, keys, IAM bindings. Check for overly permissive key access and rotation policies",
    args: "[--project PROJECT]",
  },
  org_enum: {
    description: "Enumerate GCP organization: projects, folders, org policies, constraint violations",
    args: "[--org-id ORG_ID]",
  },
  dns_enum: {
    description: "Enumerate Cloud DNS zones, records, DNSSEC status, and potential subdomain takeover targets",
    args: "[--project PROJECT]",
  },
  logging_enum: {
    description: "Enumerate logging configuration: sinks, metrics, exclusions, audit log status — identify blind spots",
    args: "[--project PROJECT]",
  },
  spanner_enum: {
    description: "Enumerate Cloud Spanner instances, databases, IAM bindings, and backup policies",
    args: "[--project PROJECT]",
  },
  artifact_registry_enum: {
    description: "Enumerate Artifact Registry repositories, images, and IAM policies for container image access",
    args: "[--project PROJECT]",
  },
  gke_enum: {
    description: "Deep GKE cluster enumeration: node pools, workload identity, network policies, RBAC, pod security, master authorized networks",
    args: "[--project PROJECT] [--cluster NAME] [--zone ZONE]",
  },

  // ── Credential (4) ──
  metadata_harvest_gcp: {
    description: "Harvest credentials from GCP metadata server: service account token, project info, instance attributes, custom metadata, SSH keys",
    args: "",
  },
  secrets_dump_gcp: {
    description: "Extract all secrets from GCP Secret Manager with version data. Lists and decodes accessible secret values",
    args: "[--project PROJECT]",
  },
  sa_key_create: {
    description: "Create new service account key for persistence. Downloads JSON key file for specified service account",
    args: "--sa-email EMAIL [--project PROJECT]",
  },
  firestore_dump: {
    description: "Dump Firestore/Datastore collections and documents. Searches for credentials, tokens, and PII in document fields",
    args: "[--project PROJECT] [--collection NAME]",
  },

  // ── Privesc (3) ──
  gcp_privesc: {
    description: "Check current IAM permissions for privilege escalation paths: setIamPolicy, actAs, signBlob, deploy functions, create keys",
    args: "[--project PROJECT]",
  },
  custom_role_abuse: {
    description: "Audit and exploit custom IAM roles: find roles with dangerous permission combinations, check for role update permissions",
    args: "[--project PROJECT]",
  },
  os_login_abuse: {
    description: "Exploit OS Login for compute instance access: check OS Login status, SSH key injection, sudo access via roles",
    args: "[--project PROJECT]",
  },

  // ── Persistence (5) ──
  cloudfunc_backdoor: {
    description: "Deploy a Cloud Function backdoor with HTTP trigger for persistent access and command execution",
    args: "--name NAME --runtime <nodejs20|python312> [--project PROJECT]",
  },
  cloud_run_backdoor: {
    description: "Deploy a Cloud Run service backdoor with configurable image and environment for persistent access",
    args: "--name NAME --image IMAGE [--project PROJECT] [--region REGION] [--env KEY=VAL]",
  },
  scheduler_persist: {
    description: "Create Cloud Scheduler job for periodic callback/command execution. Supports HTTP, Pub/Sub, and App Engine targets",
    args: "--name NAME --schedule CRON --url URL [--project PROJECT]",
  },
  cloud_build_backdoor: {
    description: "Create Cloud Build trigger for build-time persistence: injects commands into CI/CD pipeline on repository events",
    args: "--repo REPO --branch BRANCH --command CMD [--project PROJECT]",
  },
  composer_backdoor: {
    description: "Inject DAG into Cloud Composer (managed Airflow) environment for scheduled task execution and data access",
    args: "--environment ENV --dag-name NAME --command CMD [--project PROJECT] [--location LOCATION]",
  },

  // ── Exfil (6) ──
  gcs_dump: {
    description: "Enumerate and download files from GCS buckets. Supports pattern-based filtering and permission checks for public access",
    args: "--bucket BUCKET [--pattern REGEX] [--output DIR] [--project PROJECT]",
  },
  bigquery_dump: {
    description: "Enumerate and extract data from BigQuery datasets. Lists tables, schemas, row counts, and exports matching data",
    args: "[--project PROJECT] [--dataset DATASET] [--query SQL]",
  },
  compute_snapshot: {
    description: "Create disk snapshots for offline analysis and data exfiltration. Supports cross-project sharing",
    args: "--disk DISK --zone ZONE [--project PROJECT] [--share-project PROJECT]",
  },
  pubsub_sniff: {
    description: "Create subscription to sniff Pub/Sub messages. Captures real-time event data flowing through topics",
    args: "--topic TOPIC [--project PROJECT] [--duration SECONDS]",
  },
  source_repo_dump: {
    description: "Clone and search Cloud Source Repositories for secrets, credentials, and sensitive data in code",
    args: "[--project PROJECT] [--repo NAME]",
  },
  dlp_scan: {
    description: "Use Cloud DLP API to scan GCS buckets or BigQuery tables for PII, credentials, and sensitive data",
    args: "--target BUCKET_OR_TABLE [--project PROJECT]",
  },

  // ── Evasion (3) ──
  audit_log_tamper: {
    description: "Enumerate and manipulate GCP audit logging: check status, modify log sinks to filter events, disable data access logs",
    args: "--action <status|disable_data_access|modify_sink> [--project PROJECT]",
  },
  vpc_flow_tamper: {
    description: "Disable or enumerate VPC Flow Logs on subnets to reduce detection",
    args: "[--subnet SUBNET] [--region REGION] [--action status|disable] [--project PROJECT_ID]",
  },
  vpc_firewall_modify: {
    description: "Create/modify VPC firewall rules for lateral movement access",
    args: "[--rule-name NAME] [--action list|create|modify] [--project PROJECT_ID]",
  },

  // ── Cleanup (1) ──
  cleanup_gcp: {
    description: "Remove all CyberStrike GCP artifacts: snapshots, functions, Run services, scheduler jobs, build triggers, firewall rules. ALWAYS run before leaving",
    args: "[--project PROJECT] [--dry-run]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS

const dispatch: Record<Program, (args: string[], timeout: number) => Promise<HookResult>> = {
  // Recon
  gcp_enum: gcpEnum,
  vpc_enum: vpcEnum,
  iam_analyzer: iamAnalyzer,
  sql_enum: sqlEnum,
  kms_enum: kmsEnum,
  org_enum: orgEnum,
  dns_enum: dnsEnum,
  logging_enum: loggingEnum,
  spanner_enum: spannerEnum,
  artifact_registry_enum: artifactRegistryEnum,
  gke_enum: gkeEnum,
  // Credential
  metadata_harvest_gcp: metadataHarvestGcp,
  secrets_dump_gcp: secretsDumpGcp,
  sa_key_create: saKeyCreate,
  firestore_dump: firestoreDump,
  // Privesc
  gcp_privesc: gcpPrivesc,
  custom_role_abuse: customRoleAbuse,
  os_login_abuse: osLoginAbuse,
  // Persistence
  cloudfunc_backdoor: cloudfuncBackdoor,
  cloud_run_backdoor: cloudRunBackdoor,
  scheduler_persist: schedulerPersist,
  cloud_build_backdoor: cloudBuildBackdoor,
  composer_backdoor: composerBackdoor,
  // Exfil
  gcs_dump: gcsDump,
  bigquery_dump: bigqueryDump,
  compute_snapshot: computeSnapshot,
  pubsub_sniff: pubsubSniff,
  source_repo_dump: sourceRepoDump,
  dlp_scan: dlpScan,
  // Evasion
  audit_log_tamper: auditLogTamper,
  vpc_flow_tamper: vpcFlowTamper,
  vpc_firewall_modify: vpcFirewallModify,
  // Cleanup
  cleanup_gcp: cleanupGcp,
}

const CWE_MAP: Record<string, string> = {
  "GCP-ENUM-IAM-001": "CWE-269",
  "GCP-VPC-001": "CWE-778",
  "GCP-FW-001": "CWE-284",
  "GCP-IAM-001": "CWE-320",
  "GCP-IAM-002": "CWE-269",
  "GCP-IAM-003": "CWE-284",
  "GCP-SQL-001": "CWE-284",
  "GCP-SQL-002": "CWE-319",
  "GCP-SQL-003": "CWE-693",
  "GCP-KMS-001": "CWE-320",
  "GCP-ORG-001": "CWE-200",
  "GCP-DNS-001": "CWE-693",
  "GCP-LOG-001": "CWE-778",
  "GCP-SPANNER-001": "CWE-200",
  "GCP-AR-001": "CWE-200",
  "GCP-GKE-ABAC": "CWE-269",
  "GCP-GKE-001": "CWE-522",
  "GCP-META-001": "CWE-522",
  "GCP-SECRET-001": "CWE-522",
  "GCP-SAKEY-001": "CWE-522",
  "GCP-FIRESTORE-001": "CWE-200",
  "GCP-PRIVESC-001": "CWE-269",
  "GCP-PRIVESC-002": "CWE-269",
  "GCP-PRIVESC-003": "CWE-269",
  "GCP-PRIVESC-004": "CWE-269",
  "GCP-ROLE-001": "CWE-269",
  "GCP-OSLOGIN-001": "CWE-284",
  "GCP-FUNC-001": "CWE-94",
  "GCP-FUNC-002": "CWE-94",
  "GCP-RUN-001": "CWE-94",
  "GCP-RUN-002": "CWE-94",
  "GCP-SCHED-001": "CWE-547",
  "GCP-BUILD-001": "CWE-94",
  "GCP-COMPOSER-001": "CWE-94",
  "GCP-GCS-001": "CWE-200",
  "GCP-GCS-002": "CWE-200",
  "GCP-BQ-001": "CWE-200",
  "GCP-BQ-002": "CWE-200",
  "GCP-SNAP-001": "CWE-200",
  "GCP-PUBSUB-001": "CWE-200",
  "GCP-PUBSUB-002": "CWE-200",
  "GCP-REPO-001": "CWE-200",
  "GCP-DLP-001": "CWE-200",
  "GCP-AUDIT-001": "CWE-778",
  "GCP-AUDIT-002": "CWE-778",
  "GCP-FLOW-001": "CWE-778",
  "GCP-FW-MOD-001": "CWE-284",
  "GCP-FW-MOD-002": "CWE-284",
  "GCP-CLEANUP-001": "CWE-1254",
}

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const GcphookTool = Tool.define("gcphook", {
  description: `Execute a GCP post-exploitation program. 33 programs across 7 categories: recon (11), credential (4), privesc (3), persistence (5), exfil (6), evasion (3), cleanup (1). Uses gcloud CLI. Available: ${programKeys.join(", ")}. ALWAYS run cleanup_gcp before leaving.`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "GCP program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    if (!Bun.which("gcloud") && params.program !== "metadata_harvest_gcp") {
      return {
        title: `gcphook: ${params.program}`,
        output: "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install",
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
        title: `gcphook: ${program}`,
        output: `[-] ${program} failed: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program, findings: [] as Finding[] },
      }
    }

    const enriched = result.findings.map((f) => {
      const cwe = CWE_MAP[f.checkId]
      return cwe ? { ...f, cwe } : f
    })

    return {
      title: `gcphook: ${program}`,
      output: result.output,
      metadata: { program, findings: enriched },
    }
  },
})
