---
name: cis-azure-foundations-8.1.7.4
description: "Ensure That Microsoft Defender for SQL Servers on Machines Is Set To 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, databases, sql-servers]
cis_id: "8.1.7.4"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.7.4 Ensure That Microsoft Defender for SQL Servers on Machines Is Set To 'On' (Automated)

## Description

Turning on Microsoft Defender for SQL servers on machines enables threat detection for SQL servers on machines, providing threat intelligence, anomaly detection, and behavior analytics in Microsoft Defender for Cloud.

## Rationale

Enabling Microsoft Defender for SQL servers on machines allows for greater defense-in-depth, functionality for discovering and classifying sensitive data, surfacing and mitigating potential database vulnerabilities, and detecting anomalous activities that could indicate a threat to your database.

## Impact

Turning on Microsoft Defender for SQL servers on machines incurs an additional cost per resource.

## Audit Procedure

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment Settings`.
3. Click on the subscription name.
4. Select the `Defender plans` blade.
5. Click `Select types >` in the row for `Databases`.
6. Ensure the toggle switch next to `SQL servers on machines` is set to `On`.

**From Azure CLI:**

```
az security pricing show -n SqlServerVirtualMachines
```

Ensure the 'PricingTier' is set to 'Standard'.

**From PowerShell:**

```
Get-AzSecurityPricing -Name 'SqlServerVirtualMachines' | Select-Object Name,PricingTier
```

Ensure the 'PricingTier' is set to 'Standard'.

**From Azure Policy:**

- Policy ID: `6581d072-105e-4418-827f-bd446d56421b` - Name: 'Azure Defender for SQL servers on machines should be enabled'
- Policy ID: `abfb4388-5bf4-4ad7-ba82-2cd2f41ceae9` - Name: 'Azure Defender for SQL should be enabled for unprotected Azure SQL servers'

## Expected Result

The pricing tier for SqlServerVirtualMachines should be `Standard`.

## Remediation

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment Settings`.
3. Click on the subscription name.
4. Select the `Defender plans` blade.
5. Click `Select types >` in the row for `Databases`.
6. Set the toggle switch next to `SQL servers on machines` to `On`.
7. Select `Continue`.
8. Select `Save`.

**From Azure CLI:**

```
az security pricing create -n SqlServerVirtualMachines --tier 'standard'
```

**From PowerShell:**

```
Set-AzSecurityPricing -Name 'SqlServerVirtualMachines' -PricingTier 'Standard'
```

## Default Value

By default, Microsoft Defender plan is off.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-sql-usage
2. https://learn.microsoft.com/en-us/azure/defender-for-cloud/alerts-overview
3. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/pricings/update
4. https://learn.microsoft.com/en-us/powershell/module/az.security/get-azsecuritypricing

## Profile

- Level 2
