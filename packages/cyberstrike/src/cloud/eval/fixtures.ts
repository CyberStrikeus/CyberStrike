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
