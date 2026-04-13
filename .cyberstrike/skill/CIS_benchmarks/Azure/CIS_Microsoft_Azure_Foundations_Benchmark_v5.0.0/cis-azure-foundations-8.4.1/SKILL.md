---
name: cis-azure-foundations-8.4.1
description: "Ensure That Microsoft Defender for APIs Is Set To 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, apis]
cis_id: "8.4.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.4.1 Ensure That Microsoft Defender for APIs Is Set To 'On' (Automated)

## Description

Enable Microsoft Defender for APIs to provide security coverage for APIs managed through Azure API Management, detecting threats and vulnerabilities targeting API endpoints.

## Rationale

APIs are increasingly targeted by attackers as they expose business logic and sensitive data. Microsoft Defender for APIs provides security insights for APIs managed by Azure API Management, including detection of suspicious API usage patterns, data exfiltration attempts, and API-specific attacks (such as injection, authentication bypass, and excessive data exposure). It also provides visibility into the API attack surface, including unused or unauthenticated APIs, and helps identify sensitive data exposure through API responses.

## Impact

Enabling Microsoft Defender for APIs incurs additional costs based on the number of API calls processed. Organizations using Azure API Management should evaluate their API call volumes to estimate costs. The service requires APIs to be managed through Azure API Management to provide coverage. APIs not managed through API Management will not be monitored.

## Audit Procedure

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. Locate `APIs` in the list and ensure the `Status` is set to `On`.

**From Azure CLI:**
```
az security pricing show -n Api --query pricingTier
```
Ensure `"Standard"` is returned.

**From PowerShell:**
```
Get-AzSecurityPricing -Name Api | Select-Object PricingTier
```
Ensure `Standard` is returned.

## Expected Result

The pricing tier for Api (Defender for APIs) should be `Standard`.

## Remediation

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. In the row for `APIs`, set the `Status` toggle to `On`.
6. Click `Save`.

**From Azure CLI:**
```
az security pricing create -n Api --tier Standard
```

**From PowerShell:**
```
Set-AzSecurityPricing -Name Api -PricingTier Standard
```

## Default Value

Microsoft Defender for APIs is disabled (Free tier) by default.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-apis-introduction
2. https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-apis-deploy
3. https://azure.microsoft.com/en-us/pricing/details/defender-for-cloud/#pricing
4. https://learn.microsoft.com/en-us/cli/azure/security/pricing
5. https://learn.microsoft.com/en-us/powershell/module/az.security/set-azsecuritypricing

## Profile

- Level 2
