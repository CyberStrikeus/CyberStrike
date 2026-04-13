---
name: cis-azure-foundations-8.1.7.2
description: "Ensure That Microsoft Defender for Open-Source Relational Databases Is Set To 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, databases, open-source-relational]
cis_id: "8.1.7.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.7.2 Ensure That Microsoft Defender for Open-Source Relational Databases Is Set To 'On' (Automated)

## Description

Turning on Microsoft Defender for Open-source relational databases enables threat detection for Open-source relational databases, providing threat intelligence, anomaly detection, and behavior analytics in the Microsoft Defender for Cloud.

## Rationale

Enabling Microsoft Defender for Open-source relational databases allows for greater defense-in-depth, with threat detection provided by the Microsoft Security Response Center (MSRC).

## Impact

Turning on Microsoft Defender for Open-source relational databases incurs an additional cost per resource.

## Audit Procedure

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment Settings`.
3. Click on the subscription name.
4. Select the `Defender plans` blade.
5. Click `Select types >` in the row for `Databases`.
6. Ensure the toggle switch next to `Open-source relational databases` is set to `On`.

**From Azure CLI:**
```
az security pricing show -n OpenSourceRelationalDatabases --query pricingTier
```

**From PowerShell:**
```
Get-AzSecurityPricing | Where-Object {$_.Name -eq 'OpenSourceRelationalDatabases'} | Select-Object Name, PricingTier
```
Ensure output for `Name PricingTier` is `OpenSourceRelationalDatabases Standard`.

**From Azure Policy:**
- Policy ID: `0a9fbe0d-c5c4-4da8-87d8-f4fd77338835` - Name: 'Azure Defender for open-source relational databases should be enabled'

## Expected Result

The pricing tier for OpenSourceRelationalDatabases should be `Standard`.

## Remediation

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment Settings`.
3. Click on the subscription name.
4. Select the `Defender plans` blade.
5. Click `Select types >` in the row for `Databases`.
6. Set the toggle switch next to `Open-source relational databases` to `On`.
7. Select `Continue`.
8. Select `Save`.

**From Azure CLI:**
```
az security pricing create -n 'OpenSourceRelationalDatabases' --tier 'standard'
```

**From PowerShell:**
```
set-azsecuritypricing -name "OpenSourceRelationalDatabases" -pricingtier "Standard"
```

## Default Value

By default, Microsoft Defender plan is off.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/alerts-overview
2. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/pricings/update
3. https://learn.microsoft.com/en-us/powershell/module/az.security/get-azsecuritypricing

## Profile

- Level 2
