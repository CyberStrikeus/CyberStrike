---
name: cis-azure-foundations-8.1.5.1
description: "Ensure That Microsoft Defender for Storage Is Set To 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, storage]
cis_id: "8.1.5.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.5.1 Ensure That Microsoft Defender for Storage Is Set To 'On' (Automated)

## Description

Turning on Microsoft Defender for Storage enables threat detection for Storage, providing threat intelligence, anomaly detection, and behavior analytics in the Microsoft Defender for Cloud.

## Rationale

Enabling Microsoft Defender for Storage allows for greater defense-in-depth, with threat detection provided by the Microsoft Security Response Center (MSRC).

## Impact

Turning on Microsoft Defender for Storage incurs an additional cost per resource.

## Audit Procedure

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment Settings`.
3. Click on the subscription name.
4. Select the `Defender plans` blade.
5. Ensure `Status` is set to `On` for `Storage`.

**From Azure CLI:**
```
az security pricing show -n StorageAccounts
```
Ensure the output is `Standard`.

**From PowerShell:**
```
Get-AzSecurityPricing -Name 'StorageAccounts' | Select-Object Name,PricingTier
```
Ensure output for `Name PricingTier` is `StorageAccounts Standard`.

**From Azure Policy:**
- Policy ID: `640d2586-54d2-465f-877f-9ffc1d2109f4` - Name: 'Microsoft Defender for Storage should be enabled'

## Expected Result

The pricing tier for StorageAccounts should be `Standard`.

## Remediation

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment Settings`.
3. Click on the subscription name.
4. Select the `Defender plans` blade.
5. Set `Status` to `On` for `Storage`.
6. Select `Save`.

**From Azure CLI:**
```
az security pricing create -n StorageAccounts --tier 'standard'
```

**From PowerShell:**
```
Set-AzSecurityPricing -Name 'StorageAccounts' -PricingTier 'Standard'
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
