---
name: cis-azure-foundations-8.1.3.1
description: "Ensure that Defender for Servers is set to 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, servers]
cis_id: "8.1.3.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.3.1 Ensure that Defender for Servers is set to 'On' (Automated)

## Description

The Defender for Servers plan in Microsoft Defender for Cloud reduces security risk by providing actionable recommendations to improve and remediate machine security posture. Defender for Servers also helps to protect machines against real-time security threats and attacks. Defender for Servers offers two paid plans: Plan 1 and Plan 2.

## Rationale

Enabling Defender for Servers allows for greater defense-in-depth, with threat detection provided by the Microsoft Security Response Center (MSRC).

## Impact

Enabling Defender for Servers in Microsoft Defender for Cloud incurs an additional cost per resource. Plan 1: Subscription only. Plan 2: Subscription and workspace.

## Audit Procedure

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment settings`.
3. Click on a subscription name.
4. Select `Defender plans` in the left pane.
5. Under `Cloud Workload Protection (CWP)`, locate `Servers` in the Plan column, ensure Status is set to `On`.
6. Repeat steps 1-5 for each subscription.

**From Azure CLI:**
```
az security pricing show -n VirtualMachines --query pricingTier
```
If the tenant is licensed and enabled, the output will indicate `Standard`.

**From PowerShell:**
```
Get-AzSecurityPricing -Name 'VirtualMachines' | Select-Object Name,PricingTier
```
If the tenant is licensed and enabled, the `-PricingTier` parameter will indicate `Standard`.

**From Azure Policy:**
- Policy ID: `4da35fc9-c9e7-4960-aec9-797fe7d9051d` - Name: 'Azure Defender for servers should be enabled'

## Expected Result

The pricing tier for VirtualMachines should be `Standard`.

## Remediation

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment settings`.
3. Click on a subscription name.
4. Click `Defender plans` in the left pane.
5. Under `Cloud Workload Protection (CWP)`, locate `Servers` in the Plan column, set Status to `On`.
6. Select `Save`.
7. Repeat steps 1-6 for each subscription requiring remediation.

**From Azure CLI:**
```
az security pricing create -n VirtualMachines --tier 'standard'
```

**From PowerShell:**
```
Set-AzSecurityPricing -Name 'VirtualMachines' -PricingTier 'Standard'
```

## Default Value

By default, the Defender for Servers plan is disabled.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-servers-overview
2. https://learn.microsoft.com/en-us/azure/defender-for-cloud/plan-defender-for-servers
3. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/pricings/list
4. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/pricings/update
5. https://learn.microsoft.com/en-us/powershell/module/az.security/get-azsecuritypricing
6. https://learn.microsoft.com/en-us/powershell/module/az.security/set-azsecuritypricing

## Profile

- Level 2
