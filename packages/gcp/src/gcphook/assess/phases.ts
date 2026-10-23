import {
  gcpEnum,
  vpcEnum,
  iamAnalyzer,
  sqlEnum,
  kmsEnum,
  orgEnum,
  dnsEnum,
  loggingEnum,
  spannerEnum,
  artifactRegistryEnum,
  gkeEnum,
} from "../recon"

import { gcpPrivesc, customRoleAbuse, osLoginAbuse } from "../privesc"
import { auditLogTamper, vpcFlowTamper } from "../evasion"

import type { PhaseDef } from "./types"

export const GCP_PHASES: PhaseDef[] = [
  {
    name: "Identity & Permissions",
    groups: [
      {
        key: "identity",
        label: "Identity",
        programs: [
          { name: "gcp_enum", fn: gcpEnum },
          { name: "iam_analyzer", fn: iamAnalyzer },
          { name: "org_enum", fn: orgEnum },
        ],
      },
    ],
  },
  {
    name: "Infrastructure Enum",
    groups: [
      {
        key: "compute",
        label: "Compute",
        programs: [
          { name: "gke_enum", fn: gkeEnum },
        ],
      },
      {
        key: "network",
        label: "Network",
        programs: [
          { name: "vpc_enum", fn: vpcEnum },
          { name: "dns_enum", fn: dnsEnum },
        ],
      },
      {
        key: "data",
        label: "Data Stores",
        programs: [
          { name: "sql_enum", fn: sqlEnum },
          { name: "kms_enum", fn: kmsEnum },
          { name: "spanner_enum", fn: spannerEnum },
          { name: "artifact_registry_enum", fn: artifactRegistryEnum },
        ],
      },
    ],
  },
  {
    name: "Privilege Escalation",
    groups: [
      {
        key: "privesc",
        label: "Privilege Escalation",
        programs: [
          { name: "gcp_privesc", fn: gcpPrivesc },
          { name: "custom_role_abuse", fn: customRoleAbuse },
          { name: "os_login_abuse", fn: osLoginAbuse },
        ],
      },
    ],
  },
  {
    name: "Compliance",
    skip: (ctx) => (ctx.skipCompliance ? "--skip-compliance" : false),
    groups: [
      {
        key: "compliance",
        label: "Logging & Compliance",
        programs: [
          { name: "logging_enum", fn: loggingEnum },
          { name: "audit_log_tamper", fn: auditLogTamper },
          { name: "vpc_flow_tamper", fn: vpcFlowTamper },
        ],
      },
    ],
  },
]
