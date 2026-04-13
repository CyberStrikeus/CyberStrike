---
name: cis-azure-foundations-2.1.2
description: "Ensure network security groups are configured for Databricks subnets"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, databricks, analytics]
cis_id: "2.1.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-2.1.1, cis-azure-foundations-2.1.9]
prerequisites: []
severity_boost: {}
---

# Ensure network security groups are configured for Databricks subnets

## Description

Network Security Groups (NSGs) should be implemented to control inbound and outbound traffic to Azure Databricks subnets, ensuring only authorized communication. NSGs operate using a rule-based model that includes both explicit allow/deny rules and an implicit deny at the end of the rule list. This means that any traffic not explicitly allowed is automatically denied. To ensure secure and predictable behavior, NSGs should be configured with explicit deny rules for known unwanted traffic, in addition to the default implicit deny, to improve visibility and auditability of blocked traffic. This approach helps enforce least privilege and minimizes the risk of unauthorized access to Databricks resources.

## Rationale

Using NSGs with both explicit allow and deny rules provides clear documentation and control over permitted and prohibited traffic. While Azure NSGs implicitly deny all traffic not explicitly allowed, defining explicit deny rules for known malicious or unnecessary sources enhances clarity, simplifies troubleshooting, and supports compliance audits. This layered approach strengthens the security posture of Databricks environments by ensuring only essential communication is permitted.

## Impact

- NSGs require ongoing maintenance to ensure rule accuracy and alignment with evolving business and security requirements.
- Misconfigured NSGs -- especially overly broad allow rules or missing explicit denies -- can inadvertently expose Databricks resources or block legitimate traffic.
- Relying solely on implicit deny may obscure the intent behind traffic restrictions, making it harder to audit or troubleshoot network behavior.

## Audit Procedure

### Audit from Azure Portal

1. Navigate to Virtual Networks > Subnets, and review NSG assignments.

### Audit from Azure CLI

```bash
az network nsg list --query "[].{Name:name, Rules:securityRules}"
```

### Audit from PowerShell

```powershell
Get-AzNetworkSecurityGroup -ResourceGroupName <resource-group-name>
```

## Expected Result

Each Databricks subnet should have an NSG assigned with explicit allow and deny rules that enforce least privilege access. The NSG should contain rules specific to Databricks communication requirements.

## Remediation

### Remediate from Azure Portal

1. Assign NSG to Databricks subnets under Networking > NSG Settings.

## Default Value

By default, Databricks subnets do not have NSGs assigned.

## References

1. https://learn.microsoft.com/en-us/security/benchmark/azure/baselines/azure-databricks-security-baseline
2. https://learn.microsoft.com/en-us/azure/databricks/security/network/classic/vnet-inject#network-security-group-rules

## CIS Controls

| Controls Version | Control                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers                   | x    | x    | x    |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering                 | x    | x    | x    |

## Profile

Level 1 | Automated
