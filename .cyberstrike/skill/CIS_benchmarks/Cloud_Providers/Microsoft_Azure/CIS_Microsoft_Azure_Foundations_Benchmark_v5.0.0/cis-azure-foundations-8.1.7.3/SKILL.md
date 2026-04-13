---
name: cis-azure-foundations-8.1.7.3
description: "Ensure That Microsoft Defender for Azure SQL Databases Is Set To 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, databases, sql]
cis_id: "8.1.7.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.7.3 Ensure That Microsoft Defender for (Managed Instance) Azure SQL Databases Is Set To 'On' (Automated)

## Description

Turning on Microsoft Defender for Azure SQL Databases enables threat detection for Managed Instance Azure SQL databases, providing threat intelligence, anomaly detection, and behavior analytics in Microsoft Defender for Cloud.

## Rationale

Enabling Microsoft Defender for Azure SQL Databases allows for greater defense-in-depth, includes functionality for discovering and classifying sensitive data, surfacing and mitigating potential database vulnerabilities, and detecting anomalous activities that could indicate a threat to your database.

## Impact

Turning on Microsoft Defender for Azure SQL Databases incurs an additional cost per resource.

## Audit Procedure

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment Settings`.
3. Click on the subscription name.
4. Select the `Defender plans` blade.
5. Click `Select types >` in the row for `Databases`.
6. Ensure the toggle switch next to `Azure SQL Databases` is set to `On`.

**From Azure CLI:**

```
az security pricing show -n SqlServers
```

Ensure `-PricingTier` is set to `Standard`.

**From PowerShell:**

```
Get-AzSecurityPricing -Name 'SqlServers' | Select-Object Name,PricingTier
```

Ensure the `-PricingTier` is set to `Standard`.

**From Azure Policy:**

- Policy ID: `7fe3b40f-802b-4cdd-8bd4-fd799c948cc2` - Name: 'Azure Defender for Azure SQL Database servers should be enabled'
- Policy ID: `abfb7388-5bf4-4ad7-ba99-2cd2f41cebb9` - Name: 'Azure Defender for SQL should be enabled for unprotected SQL Managed Instances'
- Policy ID: `3bc8a0d5-38e0-4a3d-a657-2cb64468fc34` - Name: 'Azure Defender for SQL should be enabled for unprotected MySQL flexible servers'
- Policy ID: `d38668f5-d155-42c7-ab3d-9b57b50f8fbf` - Name: 'Azure Defender for SQL should be enabled for unprotected PostgreSQL flexible servers'
- Policy ID: `d31e5c31-63b2-4f12-887b-e49456834fa1` - Name: 'Microsoft Defender for SQL should be enabled for unprotected Synapse workspaces'
- Policy ID: `938c4981-c2c9-4168-9cd6-972b8675f906` - Name: 'Microsoft Defender for SQL status should be protected for Arc-enabled SQL Servers'

## Expected Result

The pricing tier for SqlServers should be `Standard`.

## Remediation

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment Settings`.
3. Click on the subscription name.
4. Select the `Defender plans` blade.
5. Click `Select types >` in the row for `Databases`.
6. Set the toggle switch next to `Azure SQL Databases` to `On`.
7. Select `Continue`.
8. Select `Save`.

**From Azure CLI:**

```
az security pricing create -n SqlServers --tier 'standard'
```

**From PowerShell:**

```
Set-AzSecurityPricing -Name 'SqlServers' -PricingTier 'Standard'
```

## Default Value

By default, Microsoft Defender plan is off.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/alerts-overview
2. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/pricings/list
3. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/pricings/update
4. https://learn.microsoft.com/en-us/powershell/module/az.security/get-azsecuritypricing

## Profile

- Level 2
