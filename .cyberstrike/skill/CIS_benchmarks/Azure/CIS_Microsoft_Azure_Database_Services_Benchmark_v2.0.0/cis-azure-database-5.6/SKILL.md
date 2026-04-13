---
name: cis-azure-database-5.6
description: "Ensure server parameter 'audit_log_events' has 'CONNECTION' set for MySQL flexible server"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, mysql, database]
cis_id: "5.6"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.6 Ensure server parameter 'audit_log_events' has 'CONNECTION' set for MySQL flexible server (Automated)

## Profile Applicability

- Level 2

## Description

Set `audit_log_events` to include `CONNECTION` on `MySQL flexible servers`.

## Rationale

Enabling `CONNECTION` helps MySQL Database to log items such as successful and failed connection attempts to the server. Log data can be used to identify, troubleshoot, and repair configuration errors and suboptimal performance.

## Impact

There are further costs incurred for storage of logs. For high traffic databases these logs will be significant. Determine your organization's needs before enabling.

## Audit

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for MySQL flexible servers`.
3. For each database, under `Settings`, click `Server parameters`.
4. In the filter bar, type `audit_log`.
5. Ensure that the `VALUE` for `audit_log_enabled` is `ON`.
6. Ensure that the `VALUE` for `audit_log_events` includes `CONNECTION`.

### Audit from Azure CLI

Ensure the below command returns a `value` that includes `CONNECTION`:

```bash
az mysql flexible-server parameter show --resource-group <resourceGroup> --server-name <serverName> --name audit_log_events
```

### Audit from PowerShell

Ensure the below command returns a `Value` that includes `CONNECTION`:

```powershell
Get-AzMySqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name audit_log_events
```

## Expected Result

The `audit_log_events` server parameter should include `CONNECTION` in its value, and `audit_log_enabled` should be `ON`.

## Remediation

### Remediate from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for MySQL flexible servers`.
3. For each database, under `Settings`, click `Server parameters`.
4. In the filter bar, type `audit_log`.
5. Set `audit_log_enabled` to `ON`.
6. In the drop-down next to `audit_log_events`, check `CONNECTION`.
7. Click `Save`.
8. Under `Monitoring`, select `Diagnostic settings`.
9. Select `+ Add diagnostic setting`.
10. Provide a diagnostic setting name.
11. Under `Categories`, select `MySQL Audit Logs`.
12. Specify destination details.
13. Click `Save`.

It may take up to 10 minutes for the logs to appear in the configured destination.

### Remediate from Azure CLI

Use the below command to set `audit_log_events` to `CONNECTION`:

```bash
az mysql flexible-server parameter set --resource-group <resourceGroup> --server-name <serverName> --name audit_log_events --value CONNECTION
```

### Remediate from PowerShell

Use the below command to set `audit_log_events` to `CONNECTION`:

```powershell
Update-AzMySqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name audit_log_events -Value CONNECTION
```

## Default Value

By default `audit_log_events` is set to `CONNECTION`.

## References

1. https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-audit-logs
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation
3. https://learn.microsoft.com/en-us/azure/mysql/flexible-server/tutorial-configure-audit
4. https://learn.microsoft.com/en-us/azure/mysql/flexible-server/tutorial-configure-audit#configure-auditing-by-using-the-azure-cli

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | X | X | X |
| v7 | 6.2 Activate audit logging | X | X | X |
