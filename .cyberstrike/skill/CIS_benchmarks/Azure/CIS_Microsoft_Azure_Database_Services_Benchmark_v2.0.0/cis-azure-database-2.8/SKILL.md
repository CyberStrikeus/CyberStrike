---
name: cis-azure-database-2.8
description: "Ensure that Azure Cache for Redis is Using Customer-Managed Keys"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, redis, cache]
cis_id: "2.8"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.8 Ensure that Azure Cache for Redis is Using Customer-Managed Keys (Manual)

## Profile Applicability

- Level 2

## Description

Customer Managed Keys allow you more granular control over the encryption of your information.

## Rationale

Customer Managed Keys increase security of your disk encryption by offering features like custom managed expiration dates, allowing you to set your own key lifecycle.

## Impact

This comes with an increased cost, as only Enterprise tier Azure Cache for Redis supports customer managed keys.

## Audit Procedure

### Audit From Azure Portal

1. Select your Redis Cache.
2. In the left column select **Encryption**.
3. View the keys listed, and determine if the checkbox for 'Customer Managed Key' is selected.

### Audit From PowerShell

1. Run the following command to determine if your Azure Cache for Redis is using a Customer Managed Key.

```powershell
Get-AzRedisEnterpriseCache -ResourceGroupName "<resourcegroupname>" -Name
"<azurecacheforredisname>" | Select-Object -ExpandProperty
EnableCustomerManagedKey
```

2. If the command returns true, you are using a customer managed key.

### Audit From Azure Policy

- **Policy ID:** `09aa11bb-87ec-409f-bf0b-49b7c1561a87` - **Name:** 'Azure Cache for Redis Enterprise should use customer-managed keys for encrypting disk data'

## Expected Result

The 'Customer Managed Key' checkbox should be selected, or the PowerShell command should return `true`.

## Remediation

### Remediate From Azure Portal

1. Select your Redis Cache.
2. In the left column select **Encryption**.
3. Select the checkbox to enable Customer Managed keys.
4. Select **Add** to assign a user managed identity with permissions to access your Azure key vault.
5. Select your subscription and Azure Key vault that contains your customer managed key. Ensure this is in the same region as your Azure Cache for Redis.
6. Select your customer managed key.
7. Click **Save**.

### Remediate From PowerShell

1. In Azure Key Vault find the full URL for a key you have created. Then run the following command with the information for your environment.

```powershell
Update-AzRedisEnterpriseCache -ClusterName "<yourclustername>"
-ResourceGroupName "<yourresourcegroupname>" -
CustomerManagedKeyEncryptionKeyUrl "<thekeyinazurekeyvaultURL>"
```

## Default Value

By default Azure Cache for Redis uses Microsoft Managed Keys for all Redis services.

## Additional Information

Be certain to set your expiration dates and other settings for the Customer Managed Key within your Azure Key Vault for optimal security.

## References

1. [https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-how-to-encryption](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-how-to-encryption)
2. [https://learn.microsoft.com/en-us/powershell/module/az.redisenterprisecache/get-azredisenterprisecache](https://learn.microsoft.com/en-us/powershell/module/az.redisenterprisecache/get-azredisenterprisecache)
3. [https://learn.microsoft.com/en-us/powershell/module/az.redisenterprisecache/update-azredisenterprisecache](https://learn.microsoft.com/en-us/powershell/module/az.redisenterprisecache/update-azredisenterprisecache)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | X | X |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | X |
