---
name: cis-azure-database-6.5
description: "Ensure server parameter 'connection_throttle.enable' is set to 'ON' for PostgreSQL server"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, postgresql, database]
cis_id: "6.5"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.5 Ensure server parameter 'connection_throttle.enable' is set to 'ON' for PostgreSQL server (Automated)

## Profile Applicability

- Level 1

## Description

Enable `connection_throttling` on `PostgreSQL flexible servers`.

## Rationale

Enabling `connection_throttling` helps the PostgreSQL Database to set the verbosity of logged messages. This in turn generates query and error logs with respect to concurrent connections that could lead to a successful Denial of Service (DoS) attack by exhausting connection resources. A system can also fail or be degraded by an overload of legitimate users. Query and error logs can be used to identify, troubleshoot, and repair configuration errors and sub-optimal performance.

## Impact

None documented.

## Audit Procedure

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter bar, type `connection_throttle.enable`.
5. Ensure that `VALUE` for `connection_throttle.enable` is set to `ON`.

### Audit from Azure CLI

Ensure the below command returns a `value` of `on`:

```bash
az postgres flexible-server parameter show --resource-group <resourceGroup> --server-name <serverName> --name connection_throttle.enable
```

### Audit from PowerShell

Ensure the below command returns a `Value` of `on`:

```powershell
Get-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name connection_throttle.enable
```

### Audit from Azure Policy

Policy ID: `dacf07fa-0eea-4486-80bc-b93fae88ac40`
Name: 'Connection throttling should be enabled for PostgreSQL flexible servers'

## Expected Result

The `connection_throttle.enable` server parameter should be set to `ON`.

## Remediation

### Remediate from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter bar, type `connection_throttle.enable`.
5. Set `connection_throttle.enable` to `ON`.
6. Click `Save`.

### Remediate from Azure CLI

Use the below command to enable `connection_throttle.enable`:

```bash
az postgres flexible-server parameter set --resource-group <resourceGroup> --server-name <serverName> --name connection_throttle.enable --value on
```

### Remediate from PowerShell

Use the below command to update `connection_throttling` configuration:

```powershell
Update-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name connection_throttle.enable -Value on
```

## Default Value

By default, `connection_throttle.enable` is disabled (set to `off`).

## References

1. https://learn.microsoft.com/en-us/rest/api/postgresql/flexibleserver/configurations/list-by-server
2. https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/how-to-configure-server-parameters-using-portal
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation
4. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/get-azpostgresqlflexibleserverconfiguration
5. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/update-azpostgresqlflexibleserverconfiguration

## Profile

- Level 1
