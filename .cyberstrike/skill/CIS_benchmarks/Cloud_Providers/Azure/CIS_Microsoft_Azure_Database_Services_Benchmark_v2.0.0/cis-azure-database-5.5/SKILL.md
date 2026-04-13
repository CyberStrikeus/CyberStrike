---
name: cis-azure-database-5.5
description: "Ensure server parameter 'audit_log_enabled' is set to 'ON' for MySQL flexible server"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, mysql, database]
cis_id: "5.5"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5 Ensure server parameter 'audit_log_enabled' is set to 'ON' for MySQL flexible server (Automated)

## Profile Applicability

- Level 2

## Description

Enable `audit_log_enabled` on `MySQL flexible servers`.

## Rationale

Enabling `audit_log_enabled` helps MySQL Database to log items such as connection attempts to the server, DDL/DML access, and more. Log data can be used to identify, troubleshoot, and repair configuration errors and suboptimal performance.

## Impact

There are further costs incurred for storage of logs. For high traffic databases these logs will be significant. Determine your organization's needs before enabling.

## Audit

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for MySQL Servers`.
3. For each database, under `Settings`, click `Server parameters`.
4. In the filter bar, type `audit_log_enabled`.
5. Ensure that the `VALUE` for `audit_log_enabled` is `ON`.

### Audit from Azure CLI

Ensure the below command returns a `value` of `on`:

```bash
az mysql flexible-server parameter show --resource-group <resourceGroup> --server-name <serverName> --name audit_log_enabled
```

### Audit from PowerShell

Ensure the below command returns a `Value` of `on`:

```powershell
Get-AzMySqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name audit_log_enabled
```

## Expected Result

The `audit_log_enabled` server parameter should return a value of `ON`.

## Remediation

### Remediate from Azure Portal

**Part 1 - Turn on audit logs**

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for MySQL flexible servers`.
3. For each database, under `Settings`, click `Server parameters`.
4. Set `audit_log_enabled` to `ON`.
5. Click `Save`.

**Part 2 - Capture audit logs (diagnostic settings is for example only, send these logs to the appropriate data sink for your logging needs)**

1. Under Monitoring, select `Diagnostic settings`.
2. Select `+ Add diagnostic setting`.
3. Provide a diagnostic setting name.
4. Under Categories, select `MySQL Audit Logs`.
5. Specify destination details.
6. Click `Save`.

It may take up to 10 minutes for the logs to appear in the configured destination.

### Remediate from Azure CLI

Use the below command to enable `audit_log_enabled`:

```bash
az mysql flexible-server parameter set --resource-group <resourceGroup> --server-name <serverName> --name audit_log_enabled --value on
```

### Remediate from PowerShell

Use the below command to enable `audit_log_enabled`:

```powershell
Update-AzMySqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name audit_log_enabled -Value on
```

## Default Value

`audit_log_enabled` is set to `OFF` by default.

## References

1. https://learn.microsoft.com/en-us/azure/mysql/flexible-server/tutorial-configure-audit
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation
3. https://learn.microsoft.com/en-us/azure/mysql/flexible-server/tutorial-configure-audit#configure-auditing-by-using-the-azure-cli
4. https://www.azadvertizer.net/azpolicyadvertizer/4dc90661-5d91-41f1-be00-d243f6f3fe9c.html

## CIS Controls

| Controls Version | Control                    | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs     | X    | X    | X    |
| v7               | 6.2 Activate audit logging | X    | X    | X    |
