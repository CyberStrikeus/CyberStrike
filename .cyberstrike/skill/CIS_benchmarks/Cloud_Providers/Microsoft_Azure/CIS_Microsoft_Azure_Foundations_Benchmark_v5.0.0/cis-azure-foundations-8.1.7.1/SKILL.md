---
name: cis-azure-foundations-8.1.7.1
description: "Ensure That Microsoft Defender for Azure Cosmos DB Is Set To 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, databases, cosmos-db]
cis_id: "8.1.7.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.7.1 Ensure That Microsoft Defender for Azure Cosmos DB Is Set To 'On' (Automated)

## Description

Microsoft Defender for Azure Cosmos DB scans all incoming network requests for threats to your Azure Cosmos DB resources.

## Rationale

In scanning Azure Cosmos DB requests within a subscription, requests are compared to a heuristic list of potential security threats. These threats could be a result of a security breach within your services, thus scanning for them could prevent a potential security threat from being introduced.

## Impact

Enabling Microsoft Defender for Azure Cosmos DB requires enabling Microsoft Defender for your subscription. Both will incur additional charges.

## Audit Procedure

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment Settings`.
3. Click on the subscription name.
4. Select the `Defender plans` blade.
5. On the `Database` row click on `Select types >`.
6. Ensure the toggle switch next to `Azure Cosmos DB` is set to `On`.

**From Azure CLI:**

```
az security pricing show -n CosmosDbs --query pricingTier
```

**From PowerShell:**

```
Get-AzSecurityPricing -Name 'CosmosDbs' | Select-Object Name,PricingTier
```

Ensure output of `-PricingTier` is `Standard`.

**From Azure Policy:**

- Policy ID: `adbe85b5-83e6-4350-ab58-bf3a4f736e5e` - Name: 'Microsoft Defender for Azure Cosmos DB should be enabled'

## Expected Result

The pricing tier for CosmosDbs should be `Standard`.

## Remediation

**From Azure Portal:**

1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, select `Environment Settings`.
3. Click on the subscription name.
4. Select the `Defender plans` blade.
5. On the `Database` row click on `Select types >`.
6. Set the toggle switch next to `Azure Cosmos DB` to `On`.
7. Click `Continue`.
8. Click `Save`.

**From Azure CLI:**

```
az security pricing create -n 'CosmosDbs' --tier 'standard'
```

**From PowerShell:**

```
Set-AzSecurityPricing -Name 'CosmosDbs' -PricingTier 'Standard'
```

## Default Value

By default, Microsoft Defender for Azure Cosmos DB is not enabled.

## References

1. https://azure.microsoft.com/en-us/pricing/details/defender-for-cloud/
2. https://learn.microsoft.com/en-us/azure/defender-for-cloud/connect-azure-subscription
3. https://learn.microsoft.com/en-us/azure/defender-for-cloud/alerts-overview
4. https://learn.microsoft.com/en-us/security/benchmark/azure/baselines/azure-cosmos-db-security-baseline
5. https://learn.microsoft.com/en-us/azure/defender-for-cloud/tutorial-enable-databases-plan

## Profile

- Level 2
