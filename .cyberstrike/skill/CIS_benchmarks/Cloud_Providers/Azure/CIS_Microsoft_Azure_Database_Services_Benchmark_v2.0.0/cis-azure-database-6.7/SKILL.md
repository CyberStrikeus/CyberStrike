---
name: cis-azure-database-6.7
description: "Ensure server parameter 'log_checkpoints' is set to 'ON' for PostgreSQL server"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, postgresql, database]
cis_id: "6.7"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.7 Ensure server parameter 'log_checkpoints' is set to 'ON' for PostgreSQL server (Automated)

## Profile Applicability

- Level 1

## Description

Enable `log_checkpoints` on `PostgreSQL flexible servers`.

## Rationale

Enabling `log_checkpoints` helps the PostgreSQL Database to log each checkpoint, which in turn generates query and error logs. However, access to transaction logs is not supported. Query and error logs can be used to identify, troubleshoot, and repair configuration errors and sub-optimal performance.

## Impact

None documented.

## Audit Procedure

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter bar, type `log_checkpoints`.
5. Ensure that `VALUE` for `log_checkpoints` is set to `ON`.

### Audit from Azure CLI

Ensure the below command returns a `value` of `on`:

```bash
az postgres flexible-server parameter show --resource-group <resourceGroup> --server-name <serverName> --name log_checkpoints
```

### Audit from PowerShell

Ensure the below command returns a `Value` of `on`:

```powershell
Get-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name log_checkpoints
```

### Audit from Azure Policy

Policy ID: `70be9e12-c935-49ac-9bd8-fd64b85c1f87`
Name: 'Log checkpoints should be enabled for PostgreSQL flexible servers'

## Expected Result

The `log_checkpoints` server parameter should be set to `ON`.

## Remediation

### Remediate from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter bar, type `log_checkpoints`.
5. Set the `VALUE` for `log_checkpoints` to `ON`.
6. Click `Save`.

### Remediate from Azure CLI

Use the below command to enable `log_checkpoints`:

```bash
az postgres flexible-server parameter set --resource-group <resourceGroup> --server-name <serverName> --name log_checkpoints --value on
```

### Remediate from PowerShell

```powershell
Update-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name log_checkpoints -Value on
```

## Default Value

By default, `log_checkpoints` is enabled (set to `on`).

## References

1. https://learn.microsoft.com/en-us/rest/api/postgresql/flexibleserver/configurations/list-by-server
2. https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/how-to-configure-server-parameters-using-portal
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation
4. https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-logging#configure-logging
5. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/get-azpostgresqlflexibleserverconfiguration
6. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/update-azpostgresqlflexibleserverconfiguration

## Profile

- Level 1
