---
name: cis-azure-foundations-8.1.2.1
description: "Ensure Microsoft Defender for APIs is set to 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, api]
cis_id: "8.1.2.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.2.1 Ensure Microsoft Defender for APIs is set to 'On' (Automated)

## Description

Microsoft Defender for APIs offers full lifecycle protection, detection, and response coverage for APIs. Due to its potentially high cost, Microsoft Defender for APIs may not be suitable for all environments and should be evaluated carefully before implementation.

## Rationale

Microsoft Defender for APIs helps provide visibility into business-critical APIs, assess and improve their security posture, prioritize vulnerability remediation, and detect threats in real time.

## Impact

Microsoft Defender for APIs uses a tiered pricing model, billed per subscription per hour, with each tier allowing a set limit of API calls. In high-traffic environments, this may result in significant or prohibitive costs.

## Audit Procedure

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. Under `Cloud Workload Protection (CWP)`, in the row for `APIs`, ensure the `Status` is set to `On`.

**From Azure CLI:**

```
az security pricing show --name Api --query pricingTier
```

Ensure `"Standard"` is returned.

**From PowerShell:**

```
Get-AzSecurityPricing -Name Api | Select-Object PricingTier
```

Ensure `Standard` is returned.

**From Azure Policy:**

- Policy ID: `7926a6d1-b268-4586-8197-e8ae90c877d7` - Name: 'Microsoft Defender for APIs should be enabled'

## Expected Result

The pricing tier for Api should be `Standard`.

## Remediation

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. Under `Cloud Workload Protection (CWP)`, in the row for `APIs`, set the toggle switch for `Status` to `On`.
6. Select a plan.
7. Click `Save` to save the plan selection.
8. Click `Save` to enable Defender for APIs.

**From Azure CLI:**

```
az security pricing create --name Api --tier Standard --subplan <subplan>
```

Valid subplan values: P1, P2, P3, P4, and P5.

**From PowerShell:**

```
Set-AzSecurityPricing -Name Api -PricingTier Standard -SubPlan <subplan>
```

Valid SubPlan values: P1, P2, P3, P4, and P5.

## Default Value

Defender for APIs is disabled by default.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-apis-introduction
2. https://azure.microsoft.com/en-us/pricing/details/defender-for-cloud/#pricing
3. https://learn.microsoft.com/en-us/cli/azure/security/pricing
4. https://learn.microsoft.com/en-us/powershell/module/az.security/get-azsecuritypricing
5. https://learn.microsoft.com/en-us/powershell/module/az.security/set-azsecuritypricing

## Profile

- Level 2
