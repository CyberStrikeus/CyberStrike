---
name: cis-azure-database-2.10
description: "Ensure 'Update Channel' is set to 'Stable'"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, redis, cache]
cis_id: "2.10"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.10 Ensure 'Update Channel' is set to 'Stable' (Automated)

## Profile Applicability

- Level 1

## Description

Ensure all Azure Cache for Redis instances are configured to use the stable update channel.

## Rationale

By using the stable update channel, organizations minimize the risk of introducing issues that may exist in preview update streams. The stable update channel improves security posture and reduces exposure to vulnerabilities.

## Impact

Updates and new features will take longer to arrive when using the stable update channel.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Azure Cache for Redis`.
2. Select the name of a cache.
3. Under **Settings**, select **Schedule updates**.
4. Ensure `Update Channel` is set to **Stable**.
5. Repeat steps 1-4 for each cache.

### Audit from Azure CLI

Run the following command to list caches:

```bash
az redis list
```

For each cache, run the following command to get the `updateChannel` setting:

```bash
az redis show --resource-group <resource-group> --name <cache> --query updateChannel
```

Ensure `"Stable"` is returned.

### Audit from PowerShell

Run the following command to list caches:

```powershell
Get-AzRedisCache
```

Run the following command to get the cache in a resource group with a given name:

```powershell
$cache = Get-AzRedisCache -ResourceGroupName <resource-group> -Name <cache>
```

Run the following command to get the `UpdateChannel` setting:

```powershell
$cache.UpdateChannel
```

Ensure `Stable` is returned.

Repeat for each cache.

## Expected Result

The `Update Channel` should be set to **Stable** for each Azure Cache for Redis instance.

## Remediation

### Remediate from Azure Portal

1. Go to `Azure Cache for Redis`.
2. Select the name of a cache.
3. Under **Settings**, select **Schedule updates**.
4. Set `Update Channel` to **Stable**.
5. Select **Save**.
6. Repeat steps 1-5 for each cache requiring remediation.

### Remediate from Azure CLI

For each cache requiring remediation, run the following command to set `updateChannel` to `Stable`:

```bash
az redis update --resource-group <resource-group> --name <cache> --set "updateChannel=Stable"
```

### Remediate from PowerShell

For each cache requiring remediation, run the following command to set `UpdateChannel` to `Stable`:

```powershell
Set-AzRedisCache -ResourceGroupName <resource-group> -Name <cache> -UpdateChannel Stable
```

## Default Value

By default, 'Update Channel' is set to 'Stable'.

## References

1. [https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-administration#update-channel-and-schedule-updates](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-administration#update-channel-and-schedule-updates)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 2.2 Ensure Authorized Software is Currently Supported | X | X | X |
| v7 | 2.2 Ensure Software is Supported by Vendor | X | X | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1190 | TA0001 | M1051 |
