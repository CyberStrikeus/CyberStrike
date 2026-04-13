---
name: cis-azure-database-2.9
description: "Ensure 'Access Keys Authentication' is set to 'Disabled'"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, redis, cache]
cis_id: "2.9"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.9 Ensure 'Access Keys Authentication' is set to 'Disabled' (Automated)

## Profile Applicability

- Level 1

## Description

Ensure access key authentication is disabled for Azure Cache for Redis instances. Use Microsoft Entra for secure cache authentication.

## Rationale

Access keys introduce security risks and management challenges, as they are long-lived secrets vulnerable to expose or misuse. Microsoft Entra authentication provides centralized identity and access management, reducing risk and improving overall security.

## Impact

Disabling access key authentication terminates all existing client connections. Ensure retry mechanisms are in place for reconnection via Microsoft Entra.

Ensure Microsoft Entra authentication is enabled and configured before disabling access key authentication.

Refer to the recommendation in this section titled **"Ensure 'Microsoft Entra Authentication' is 'Enabled'"** for details.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Azure Cache for Redis`.
2. Select the name of a cache.
3. Under **Settings**, select **Authentication**.
4. Select **Access keys**.
5. Ensure `Disable Access Keys Authentication` is checked.
6. Repeat steps 1-5 for each cache.

### Audit from Azure CLI

Run the following command to list caches:

```bash
az redis list
```

For each cache, run the following command to get the `disableAccessKeyAuthentication` setting:

```bash
az redis show --resource-group <resource-group> --name <cache> --query disableAccessKeyAuthentication
```

Ensure `true` is returned.

### Audit from PowerShell

Run the following command to list caches:

```powershell
Get-AzRedisCache
```

Run the following command to get the cache in a resource group with a given name:

```powershell
$cache = Get-AzRedisCache -ResourceGroupName <resource-group> -Name <cache>
```

Run the following command to get the `DisableAccessKeyAuthentication` setting:

```powershell
$cache.DisableAccessKeyAuthentication
```

Ensure `True` is returned.

Repeat for each cache.

### Audit From Azure Policy

- **Policy ID:** `3827af20-8f80-4b15-8300-6db0873ec901` - **Name:** 'Azure Cache for Redis should not use access keys for authentication'

## Expected Result

The `Disable Access Keys Authentication` checkbox should be checked, or CLI/PowerShell should return `true`/`True`.

## Remediation

### Remediate from Azure Portal

1. Go to `Azure Cache for Redis`.
2. Select the name of a cache.
3. Under **Settings**, select **Authentication**.
4. Select **Access keys**.
5. Check `Disable Access Keys Authentication`.
6. Select **Save**.
7. Select **Yes** to confirm.
8. Repeat steps 1-7 for each cache.

### Remediate from Azure CLI

For each cache requiring remediation, run the following command to disable access key authentication:

```bash
az redis update --resource-group <resource-group> --name <cache> --set "disableAccessKeyAuthentication=true"
```

### Remediate from PowerShell

For each cache requiring remediation, run the following command to disable access key authentication:

```powershell
Set-AzRedisCache -ResourceGroupName <resource-group> -Name <cache> -DisableAccessKeyAuthentication $true
```

## Default Value

By default, access key authentication is disabled.

## References

1. [https://learn.microsoft.com/en-gb/azure/azure-cache-for-redis/cache-azure-active-directory-for-authentication](https://learn.microsoft.com/en-gb/azure/azure-cache-for-redis/cache-azure-active-directory-for-authentication)

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.6 Centralize Account Management                  |      | X    | X    |
| v7               | 16.2 Configure Centralized Point of Authentication |      | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1134                       | TA0004  | M1018       |
