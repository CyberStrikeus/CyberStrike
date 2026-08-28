---
name: cis-azure-foundations-8.1.1.1
description: "Ensure Microsoft Defender CSPM is set to 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, cspm]
cis_id: "8.1.1.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.1.1 Ensure Microsoft Defender CSPM is set to 'On' (Automated)

## Description

Enable Microsoft Defender CSPM to continuously assess cloud resources for security misconfigurations, compliance risks, and exposure to threats.

## Rationale

Microsoft Defender CSPM provides detailed visibility into the security state of assets and workloads and offers hardening guidance to help improve security posture.

## Impact

Enabling Microsoft Defender CSPM incurs hourly charges for each billable compute, database, and storage resource. This can lead to significant costs in larger environments. Careful planning and cost analysis are recommended before enabling the service.

## Audit Procedure

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. Under `Cloud Security Posture Management (CSPM)`, in the row for `Defender CSPM`, ensure `Status` is set to `On`.

**From Azure CLI:**

```
az security pricing show --name CloudPosture --query pricingTier
```

Ensure `"Standard"` is returned.

**From PowerShell:**

```
Get-AzSecurityPricing -Name CloudPosture | Select-Object PricingTier
```

Ensure `Standard` is returned.

**From Azure Policy:**

- Policy ID: `1f90fc71-a595-4066-8974-d4d0802e8ef0` - Name: 'Microsoft Defender CSPM should be enabled'

## Expected Result

The pricing tier for CloudPosture should be `Standard`.

## Remediation

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. Under `Cloud Security Posture Management (CSPM)`, in the row for `Defender CSPM`, set the toggle switch for `Status` to `On`.
6. Click `Save`.

**From Azure CLI:**

```
az security pricing create --name CloudPosture --tier Standard --extensions name=ApiPosture isEnabled=true
```

**From PowerShell:**

```
Set-AzSecurityPricing -Name CloudPosture -PricingTier Standard -Extension '[{"name":"ApiPosture","isEnabled":"True"}]'
```

## Default Value

Defender CSPM is disabled by default.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/concept-cloud-security-posture-management
2. https://learn.microsoft.com/en-us/azure/defender-for-cloud/tutorial-enable-cspm-plan
3. https://azure.microsoft.com/en-us/pricing/details/defender-for-cloud/#pricing
4. https://learn.microsoft.com/en-us/cli/azure/security/pricing
5. https://learn.microsoft.com/en-us/powershell/module/az.security/get-azsecuritypricing
6. https://learn.microsoft.com/en-us/powershell/module/az.security/set-azsecuritypricing

## Profile

- Level 2
