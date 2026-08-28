---
name: cis-azure-database-6.8
description: "Ensure server parameter 'log_disconnections' is set to 'ON' for PostgreSQL servers"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, postgresql, database]
cis_id: "6.8"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.8 Ensure server parameter 'log_disconnections' is set to 'ON' for PostgreSQL servers (Automated)

## Profile Applicability

- Level 1

## Description

Enable `log_disconnections` on PostgreSQL servers.

## Rationale

Enabling `log_disconnections` helps PostgreSQL Database to logs end of a session, including duration, which in turn generates query and error logs. Query and error logs can be used to identify, troubleshoot, and repair configuration errors and sub-optimal performance.

## Impact

Enabling this setting will enable a log of all disconnections. If this is enabled for a high traffic server, the log may grow exponentially.

## Audit Procedure

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. Search for `log_disconnections`.
5. Ensure that `log_disconnections` is set to `ON`.

### Audit from Azure CLI

Ensure `log_disconnections` value is set to `ON`:

```bash
az postgres flexible-server parameter show --resource-group <resourceGroupName> --server-name <serverName> --name log_disconnections
```

### Audit from PowerShell

Ensure `log_disconnections` value is set to `ON`:

```powershell
Get-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <ResourceGroupName> -ServerName <ServerName> -Name log_disconnections
```

### Audit from Azure Policy

Policy ID: `1d14b021-1bae-4f93-b36b-69695e14984a`
Name: 'Disconnections should be logged for PostgreSQL flexible servers'

## Expected Result

The `log_disconnections` server parameter should be set to `ON`.

## Remediation

### Remediate from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. Search for `log_disconnections`.
5. Set `log_disconnections` to `ON`.
6. Click `Save`.

### Remediate from Azure CLI

Use the below command to update `log_disconnections` configuration:

```bash
az postgres flexible-server parameter set --resource-group <resourceGroupName> --server-name <serverName> --name log_disconnections --value on
```

### Remediate from PowerShell

Use the below command to update `log_disconnections` configuration:

```powershell
Update-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <ResourceGroupName> -ServerName <ServerName> -Name log_disconnections -Value on
```

## Default Value

By default, `log_disconnections` is disabled (set to `off`).

## References

1. https://docs.microsoft.com/en-us/rest/api/postgresql
2. https://docs.microsoft.com/en-us/azure/postgresql/howto-configure-server-parameters-using-portal
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation
4. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/get-azpostgresqlconfiguration
5. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/update-azpostgresqlconfiguration

## Profile

- Level 1
