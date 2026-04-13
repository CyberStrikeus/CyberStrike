---
name: cis-azure-foundations-8.1.8.1
description: "Ensure That Microsoft Defender for Key Vault Is Set To 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, key-vault]
cis_id: "8.1.8.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.8.1 Ensure That Microsoft Defender for Key Vault Is Set To 'On' (Automated)

## Description

Enable Microsoft Defender for Key Vault to provide an additional layer of protection and security intelligence for detecting unusual and potentially harmful attempts to access or exploit Key Vault accounts.

## Rationale

Microsoft Defender for Key Vault detects anomalous and potentially harmful access attempts or exploitation of Azure Key Vault. It uses advanced threat detection capabilities and Microsoft Threat Intelligence data to surface contextual security alerts, enabling organizations to identify and respond to threats targeting their secrets, keys, and certificates stored in Key Vault.

## Impact

Enabling Microsoft Defender for Key Vault incurs additional costs based on the pricing tier. Organizations should evaluate the number of Key Vault transactions in their environment to estimate costs before enabling the service.

## Audit Procedure

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. Locate `Key Vault` in the list and ensure the `Status` is set to `On`.

**From Azure CLI:**

```
az security pricing show -n KeyVaults --query pricingTier
```

Ensure `"Standard"` is returned.

**From PowerShell:**

```
Get-AzSecurityPricing -Name KeyVaults | Select-Object PricingTier
```

Ensure `Standard` is returned.

## Expected Result

The pricing tier for KeyVaults should be `Standard`.

## Remediation

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Defender plans` blade.
5. In the row for `Key Vault`, set the `Status` toggle to `On`.
6. Click `Save`.

**From Azure CLI:**

```
az security pricing create -n KeyVaults --tier Standard
```

**From PowerShell:**

```
Set-AzSecurityPricing -Name KeyVaults -PricingTier Standard
```

## Default Value

Microsoft Defender for Key Vault is disabled (Free tier) by default.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-key-vault-introduction
2. https://learn.microsoft.com/en-us/azure/defender-for-cloud/enable-enhanced-security
3. https://azure.microsoft.com/en-us/pricing/details/defender-for-cloud/#pricing
4. https://learn.microsoft.com/en-us/cli/azure/security/pricing
5. https://learn.microsoft.com/en-us/powershell/module/az.security/set-azsecuritypricing

## Profile

- Level 2
