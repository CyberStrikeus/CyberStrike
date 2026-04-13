---
name: cis-azure-database-6.6
description: "Ensure server parameter 'logfiles.retention_days' is greater than 3 days for PostgreSQL server"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, postgresql, database]
cis_id: "6.6"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.6 Ensure server parameter 'logfiles.retention_days' is greater than 3 days for PostgreSQL server (Automated)

## Profile Applicability

- Level 1

## Description

Ensure `logfiles.retention_days` on `PostgreSQL flexible servers` is set to an appropriate value.

## Rationale

Configuring `logfiles.retention_days` determines the duration in days that Azure Database for PostgreSQL retains log files. Query and error logs can be used to identify, troubleshoot, and repair configuration errors and sub-optimal performance.

## Impact

Configuring this setting will result in logs being retained for the specified number of days. If this is configured on a high traffic server, the log may grow quickly to occupy a large amount of disk space. In this case you may want to set this to a lower number.

## Audit Procedure

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter bar, type `logfiles.retention_days`.
5. Ensure that the `VALUE` is between 4 and 7 (inclusive).

### Audit from Azure CLI

Ensure `logfiles.retention_days` value is greater than 3:

```bash
az postgres flexible-server parameter show --resource-group <resourceGroup> --server-name <serverName> --name logfiles.retention_days
```

### Audit from PowerShell

Ensure `logfiles.retention_days` value is greater than 3:

```powershell
Get-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name logfiles.retention_days
```

## Expected Result

The `logfiles.retention_days` value should be between 4 and 7 (inclusive).

## Remediation

### Remediate from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter bar, type `logfiles.retention_days`.
5. Input a value between 4 and 7 (inclusive).
6. Click `Save`.

### Remediate from Azure CLI

Use the below command to update `logfiles.retention_days` configuration:

```bash
az postgres flexible-server parameter set --resource-group <resourceGroup> --server-name <serverName> --name logfiles.retention_days --value <4-7>
```

### Remediate from PowerShell

Use the below command to update `logfiles.retention_days` configuration:

```powershell
Update-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name logfiles.retention_days -Value <4-7>
```

## Default Value

By default `logfiles.retention_days` is set to `3`.

## References

1. https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/how-to-configure-server-parameters-using-portal
2. https://learn.microsoft.com/en-us/rest/api/postgresql/flexibleserver/configurations/list-by-server
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-6-configure-log-storage-retention
4. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/get-azpostgresqlflexibleserverconfiguration
5. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/update-azpostgresqlflexibleserverconfiguration

## Profile

- Level 1
