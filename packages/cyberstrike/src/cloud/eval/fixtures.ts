import type { Finding } from "../../tool/azurehook/shared"

export interface EvalCase {
  name: string
  findings: Finding[]
  expectedClassification: Record<string, "formulaic" | "investigate">
  expectedTriage: Record<string, "approved" | "rejected">
}

function finding(overrides: Partial<Finding> & Pick<Finding, "checkId" | "title" | "severity">): Finding {
  return {
    provider: "azure",
    status: "FAIL",
    resource: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-prod",
    details: "",
    remediation: "",
    ...overrides,
  }
}

// ── Boundary cases: patterns that appear in details but NOT title ──
// These must stay formulaic — the classifier matches title only.

export const BOUNDARY_CASES: EvalCase[] = [
  {
    name: "boundary-anonymous-in-details-only",
    findings: [
      finding({
        checkId: "AZ-BOUND-001",
        title: "Storage container access level set to Blob",
        severity: "high",
        details: "Container allows anonymous access to blobs. Public read access is enabled.",
      }),
    ],
    expectedClassification: { "AZ-BOUND-001": "formulaic" },
    expectedTriage: {},
  },
  {
    name: "boundary-secret-in-details-only",
    findings: [
      finding({
        checkId: "AZ-BOUND-002",
        title: "App Configuration store has no private endpoint",
        severity: "high",
        details: "App Configuration contains secrets and connection strings accessible over public network.",
      }),
    ],
    expectedClassification: { "AZ-BOUND-002": "formulaic" },
    expectedTriage: {},
  },
  {
    name: "boundary-credential-in-title",
    findings: [
      finding({
        checkId: "AZ-BOUND-003",
        title: "Function App has credential stored in app settings",
        severity: "high",
        details: "Database connection string is stored in plain text in application settings.",
      }),
    ],
    expectedClassification: { "AZ-BOUND-003": "investigate" },
    expectedTriage: {},
  },
  {
    name: "boundary-low-severity-with-pattern",
    findings: [
      finding({
        checkId: "AZ-BOUND-004",
        title: "Service Principal has Reader role on subscription",
        severity: "low",
        details: "Reader role grants read-only access to all resources.",
      }),
    ],
    expectedClassification: { "AZ-BOUND-004": "formulaic" },
    expectedTriage: {},
  },
  {
    name: "boundary-medium-severity-with-pattern",
    findings: [
      finding({
        checkId: "AZ-BOUND-005",
        title: "Key Vault allows network access from all VNets",
        severity: "medium",
        details: "Key Vault secrets are accessible from any virtual network.",
      }),
    ],
    expectedClassification: { "AZ-BOUND-005": "formulaic" },
    expectedTriage: {},
  },
  {
    name: "boundary-critical-always-investigate",
    findings: [
      finding({
        checkId: "AZ-BOUND-006",
        title: "SQL firewall allows 0.0.0.0",
        severity: "critical",
        details: "Basic firewall rule, no identity patterns at all.",
      }),
    ],
    expectedClassification: { "AZ-BOUND-006": "investigate" },
    expectedTriage: {},
  },
]

// ── Mixed group classification ──

export const GROUP_CASES: {
  name: string
  groups: { key: string; findings: Finding[] }[]
  expected: Record<string, { formulaic: number; investigate: number }>
}[] = [
  {
    name: "mixed-identity-group",
    groups: [
      {
        key: "identity",
        findings: [
          finding({ checkId: "G-001", title: "Managed Identity overprivileged", severity: "high" }),
          finding({ checkId: "G-002", title: "MFA not enforced for admin accounts", severity: "high" }),
          finding({ checkId: "G-003", title: "Guest user with elevated role assignment", severity: "critical" }),
        ],
      },
    ],
    expected: { identity: { formulaic: 1, investigate: 2 } },
  },
  {
    name: "all-formulaic-data-group",
    groups: [
      {
        key: "data",
        findings: [
          finding({ checkId: "G-004", title: "Storage account TLS 1.0 enabled", severity: "medium" }),
          finding({ checkId: "G-005", title: "SQL auditing not configured", severity: "medium" }),
          finding({ checkId: "G-006", title: "Cosmos DB firewall allows all Azure IPs", severity: "high" }),
        ],
      },
    ],
    expected: { data: { formulaic: 3, investigate: 0 } },
  },
  {
    name: "multi-group-split",
    groups: [
      {
        key: "compute",
        findings: [
          finding({ checkId: "G-007", title: "VM disk encryption disabled", severity: "medium" }),
          finding({ checkId: "G-008", title: "VM has lateral movement path via managed identity", severity: "high" }),
        ],
      },
      {
        key: "network",
        findings: [
          finding({ checkId: "G-009", title: "VPN gateway uses weak cipher", severity: "high" }),
          finding({ checkId: "G-010", title: "NSG allows SSH from internet", severity: "high" }),
        ],
      },
    ],
    expected: {
      compute: { formulaic: 1, investigate: 1 },
      network: { formulaic: 1, investigate: 1 },
    },
  },
]

// ── Core eval cases ──

export const EVAL_CASES: EvalCase[] = [
  {
    name: "storage-public-access",
    findings: [
      finding({
        checkId: "AZ-DATA-001",
        title: "Storage account allows public blob access",
        severity: "high",
        resource: "/subscriptions/sub1/resourceGroups/rg-prod/providers/Microsoft.Storage/storageAccounts/stprod01",
        details: "Storage account stprod01 has allowBlobPublicAccess enabled. Any container with public access level will expose blobs to anonymous access.",
        remediation: "Set allowBlobPublicAccess to false on the storage account.",
      }),
    ],
    expectedClassification: { "AZ-DATA-001": "formulaic" },
    expectedTriage: { "AZ-DATA-001": "approved" },
  },
  {
    name: "managed-identity-overprivileged",
    findings: [
      finding({
        checkId: "AZ-IAM-003",
        title: "Managed Identity with Contributor on Key Vault",
        severity: "high",
        resource: "/subscriptions/sub1/resourceGroups/rg-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mi-deploy",
        details: "Managed identity mi-deploy has Contributor role on Key Vault kv-prod-secrets. This grants full read/write access to all secrets, keys, and certificates.",
        remediation: "Assign least-privilege Key Vault access policy instead of Contributor role.",
      }),
    ],
    expectedClassification: { "AZ-IAM-003": "investigate" },
    expectedTriage: { "AZ-IAM-003": "approved" },
  },
  {
    name: "nsg-rule-any-any",
    findings: [
      finding({
        checkId: "AZ-NET-005",
        title: "NSG allows inbound from any source to any port",
        severity: "high",
        resource: "/subscriptions/sub1/resourceGroups/rg-dev/providers/Microsoft.Network/networkSecurityGroups/nsg-dev-vm",
        details: "NSG rule 'AllowAll' permits inbound traffic from 0.0.0.0/0 on all ports (0-65535). This effectively disables network filtering.",
        remediation: "Restrict NSG rules to specific source IPs and required ports only.",
      }),
    ],
    expectedClassification: { "AZ-NET-005": "formulaic" },
    expectedTriage: { "AZ-NET-005": "approved" },
  },
  {
    name: "sql-tde-disabled-false-positive",
    findings: [
      finding({
        checkId: "AZ-DATA-010",
        title: "SQL Database TDE not enabled",
        severity: "medium",
        resource: "/subscriptions/sub1/resourceGroups/rg-prod/providers/Microsoft.Sql/servers/sql-prod/databases/db-analytics",
        details: "Transparent Data Encryption (TDE) is not enabled on database db-analytics. TDE is enabled by default on Azure SQL; this may be a check misconfiguration.",
        remediation: "Enable TDE via ALTER DATABASE SET ENCRYPTION ON.",
      }),
    ],
    expectedClassification: { "AZ-DATA-010": "formulaic" },
    expectedTriage: { "AZ-DATA-010": "rejected" },
  },
  {
    name: "service-principal-credential-exposure",
    findings: [
      finding({
        checkId: "AZ-IAM-007",
        title: "Service Principal with password credential expiring in 180+ days",
        severity: "critical",
        resource: "/subscriptions/sub1/providers/Microsoft.AAD/servicePrincipals/sp-ci-deploy",
        details: "Service principal sp-ci-deploy has a password credential valid for 730 days. Long-lived credentials increase risk of credential theft and lateral movement.",
        remediation: "Rotate to short-lived credentials (90 days max) or use managed identity.",
      }),
    ],
    expectedClassification: { "AZ-IAM-007": "investigate" },
    expectedTriage: { "AZ-IAM-007": "approved" },
  },
  {
    name: "diagnostic-logging-disabled",
    findings: [
      finding({
        checkId: "AZ-SEC-002",
        title: "Diagnostic logging not enabled on Key Vault",
        severity: "medium",
        resource: "/subscriptions/sub1/resourceGroups/rg-prod/providers/Microsoft.KeyVault/vaults/kv-prod-app",
        details: "Key Vault kv-prod-app does not have diagnostic logging enabled. Without logs, access to secrets and keys cannot be audited.",
        remediation: "Enable diagnostic settings to send logs to Log Analytics workspace.",
      }),
    ],
    expectedClassification: { "AZ-SEC-002": "formulaic" },
    expectedTriage: { "AZ-SEC-002": "approved" },
  },
  {
    name: "rbac-custom-role-wildcard",
    findings: [
      finding({
        checkId: "AZ-IAM-012",
        title: "Custom role definition with wildcard actions",
        severity: "high",
        resource: "/subscriptions/sub1/providers/Microsoft.Authorization/roleDefinitions/custom-superadmin",
        details: "Custom role 'SuperAdmin' has actions: ['*'] and assignableScopes: ['/subscriptions/sub1']. This is equivalent to Owner role without the deny-override protection.",
        remediation: "Replace wildcard actions with specific required permissions.",
      }),
    ],
    expectedClassification: { "AZ-IAM-012": "investigate" },
    expectedTriage: { "AZ-IAM-012": "approved" },
  },
  {
    name: "app-service-http-only",
    findings: [
      finding({
        checkId: "AZ-COMP-004",
        title: "App Service allows HTTP (not HTTPS only)",
        severity: "medium",
        resource: "/subscriptions/sub1/resourceGroups/rg-prod/providers/Microsoft.Web/sites/app-internal-tool",
        details: "App Service app-internal-tool does not enforce HTTPS-only. HTTP traffic is allowed which could expose data in transit.",
        remediation: "Enable HTTPS Only in App Service configuration.",
      }),
    ],
    expectedClassification: { "AZ-COMP-004": "formulaic" },
    expectedTriage: { "AZ-COMP-004": "approved" },
  },
]
