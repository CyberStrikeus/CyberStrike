---
name: cis-azure-foundations-8.1.10
description: "Ensure That Microsoft Defender for Resource Manager Is Set To 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, resource-manager]
cis_id: "8.1.10"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.10 Ensure That Microsoft Defender for Resource Manager Is Set To 'On' (Automated)

## Description

Enable Microsoft Defender for Resource Manager to automatically monitor all Azure Resource Manager operations in the organization, detecting threats targeting the management layer of Azure.

## Rationale

Azure Resource Manager is the deployment and management service for Azure. It provides a management layer that enables the creation, updating, and deletion of resources. Microsoft Defender for Resource Manager monitors all resource management operations, detecting suspicious activities such as operations from malicious IP addresses, disabling antimalware, and suspicious scripts running via VM extensions. This provides critical visibility into potential attacks against the Azure control plane.

## Impact

Enabling Microsoft Defender for Resource Manager incurs additional costs based on the number of resource management operations. Organizations should evaluate their operational volume to estimate costs before enabling.

## Audit Procedure

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. Locate `Resource Manager` in the list and ensure the `Status` is set to `On`.

**From Azure CLI:**
```
az security pricing show -n Arm --query pricingTier
```
Ensure `"Standard"` is returned.

**From PowerShell:**
```
Get-AzSecurityPricing -Name Arm | Select-Object PricingTier
```
Ensure `Standard` is returned.

## Expected Result

The pricing tier for Arm (Resource Manager) should be `Standard`.

## Remediation

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. In the row for `Resource Manager`, set the `Status` toggle to `On`.
6. Click `Save`.

**From Azure CLI:**
```
az security pricing create -n Arm --tier Standard
```

**From PowerShell:**
```
Set-AzSecurityPricing -Name Arm -PricingTier Standard
```

## Default Value

Microsoft Defender for Resource Manager is disabled (Free tier) by default.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-resource-manager-introduction
2. https://learn.microsoft.com/en-us/azure/defender-for-cloud/enable-enhanced-security
3. https://azure.microsoft.com/en-us/pricing/details/defender-for-cloud/#pricing
4. https://learn.microsoft.com/en-us/cli/azure/security/pricing
5. https://learn.microsoft.com/en-us/powershell/module/az.security/set-azsecuritypricing

## Profile

- Level 2
