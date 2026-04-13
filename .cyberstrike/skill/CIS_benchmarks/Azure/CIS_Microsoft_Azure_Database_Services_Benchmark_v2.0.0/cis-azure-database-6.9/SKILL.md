---
name: cis-azure-database-6.9
description: "Ensure server parameter 'log_connections' is set to 'ON' for PostgreSQL servers"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, postgresql, database]
cis_id: "6.9"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.9 Ensure server parameter 'log_connections' is set to 'ON' for PostgreSQL servers (Automated)

## Profile Applicability

- Level 1

## Description

Enable `log_connections` on PostgreSQL servers.

## Rationale

Enabling `log_connections` helps PostgreSQL Database to log attempted connection to the server, as well as successful completion of client authentication. Log data can be used to identify, troubleshoot, and repair configuration errors and suboptimal performance.

## Impact

None documented.

## Audit Procedure

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter bar, type `log_connections`.
5. Ensure that `log_connections` is set to `ON`.

### Audit from Azure CLI

Ensure the below command returns a `Value` of `on`:

```bash
az postgres flexible-server parameter show --resource-group <resourceGroup> --server-name <serverName> --name log_connections
```

### Audit from PowerShell

Ensure the below command returns a `Value` of `on`:

```powershell
Get-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name log_connections
```

### Audit from Azure Policy

Policy ID: `086709ac-11b5-478d-a893-9567a16d2ae3`
Name: 'Log connections should be enabled for PostgreSQL flexible servers'

## Expected Result

The `log_connections` server parameter should be set to `ON`.

## Remediation

### Remediate from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter bar, type `log_connections`.
5. Set `log_connections` to `ON`.
6. Click `Save`.

### Remediate from Azure CLI

Use the below command to update `log_connections` configuration:

```bash
az postgres flexible-server parameter set --resource-group <resourceGroupName> --server-name <serverName> --name log_connections --value on
```

### Remediate from PowerShell

Use the below command to update `log_connections` configuration:

```powershell
Update-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <ResourceGroupName> -ServerName <ServerName> -Name log_connections -Value on
```

## Default Value

By default, `log_connections` is disabled (set to `off`).

## References

1. https://docs.microsoft.com/en-us/rest/api/postgresql/configurations/listbyserver
2. https://docs.microsoft.com/en-us/azure/postgresql/howto-configure-server-parameters-using-portal
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation
4. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/get-azpostgresqlconfiguration
5. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/update-azpostgresqlconfiguration

## Profile

- Level 1
