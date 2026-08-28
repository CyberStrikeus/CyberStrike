---
name: cis-azure-foundations-8.1.9.1
description: "Ensure That Microsoft Defender for DNS Is Set To 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, dns]
cis_id: "8.1.9.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.9.1 Ensure That Microsoft Defender for DNS Is Set To 'On' (Automated)

## Description

Enable Microsoft Defender for DNS to provide an additional layer of protection for DNS queries, detecting suspicious activities and threats targeting the DNS layer of Azure resources.

## Rationale

Microsoft Defender for DNS provides protection by continuously monitoring all DNS queries from Azure resources. It detects suspicious activities such as DNS tunneling, communication with known malicious domains, and DNS attacks. This helps organizations identify compromised resources and potential data exfiltration attempts through DNS channels.

## Impact

Enabling Microsoft Defender for DNS incurs additional costs per million DNS queries. Organizations with high volumes of DNS queries should evaluate costs before enabling. Note that Microsoft has announced deprecation plans for this standalone plan as DNS protection is being integrated into Defender for Servers.

## Audit Procedure

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. Locate `DNS` in the list and ensure the `Status` is set to `On`.

**From Azure CLI:**

```
az security pricing show -n Dns --query pricingTier
```

Ensure `"Standard"` is returned.

**From PowerShell:**

```
Get-AzSecurityPricing -Name Dns | Select-Object PricingTier
```

Ensure `Standard` is returned.

## Expected Result

The pricing tier for Dns should be `Standard`.

## Remediation

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. In the row for `DNS`, set the `Status` toggle to `On`.
6. Click `Save`.

**From Azure CLI:**

```
az security pricing create -n Dns --tier Standard
```

**From PowerShell:**

```
Set-AzSecurityPricing -Name Dns -PricingTier Standard
```

## Default Value

Microsoft Defender for DNS is disabled (Free tier) by default.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-dns-introduction
2. https://learn.microsoft.com/en-us/azure/defender-for-cloud/enable-enhanced-security
3. https://azure.microsoft.com/en-us/pricing/details/defender-for-cloud/#pricing
4. https://learn.microsoft.com/en-us/cli/azure/security/pricing
5. https://learn.microsoft.com/en-us/powershell/module/az.security/set-azsecuritypricing

## Profile

- Level 2
