---
name: cis-azure-database-5.7
description: "Ensure server parameter 'error_server_log_file' is Enabled for MySQL Database Server"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, mysql, database]
cis_id: "5.7"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.7 Ensure server parameter 'error_server_log_file' is Enabled for MySQL Database Server (Manual)

## Profile Applicability

- Level 2

## Description

Enable error logs on MySQL flexible servers.

## Rationale

With `error_server_log_file` enabled, MySQL Database will log database errors to a logging solution. These logs assist in producing a forensic trail that can be used for investigation or for detection when paired with a SIEM.

## Impact

There are further costs incurred for storage of logs. For high traffic databases these logs will be significant. Determine your organization's needs before enabling.

## Audit

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for MySQL Servers`.
3. For each database, under `Settings`, click `Server parameters`.
4. In the row under `Save`, select `All`.
5. In the filter bar, type `error_server_log_file`.
6. Ensure that the `VALUE` for `error_server_log_file` is `ON`.

### Audit from PowerShell

Ensure the below command returns a `Value` of `on`:

```powershell
Get-AzMySqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name error_server_log_file
```

## Expected Result

The `error_server_log_file` server parameter should return a value of `ON`.

## Remediation

### Remediate from Azure Portal

**Part 1 - Turn on audit logs**

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for MySQL flexible servers`.
3. For each database, under `Settings`, click `Server parameters`.
4. Set `error_server_log_file` to `ON`.
5. Click `Save`.

**Part 2 - Capture audit logs (diagnostic settings is for example only, send these logs to the appropriate data sink for your logging needs)**

1. Under Monitoring, select `Diagnostic settings`.
2. Select `+ Add diagnostic setting`.
3. Provide a diagnostic setting name.
4. Under Categories, select `MySQL Audit Logs`.
5. Specify destination details.
6. Click `Save`.

It may take up to 10 minutes for the logs to appear in the configured destination.

### Remediate from PowerShell

Use the below command to enable `error_server_log_file`:

```powershell
Update-AzMySqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name error_server_log_file -Value on
```

## Default Value

`error_server_log_file` is set to `OFF` by default.

## References

1. https://learn.microsoft.com/en-us/azure/mysql/flexible-server/tutorial-configure-audit
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation
3. https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-error-logs

## CIS Controls

| Controls Version | Control                    | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs     | X    | X    | X    |
| v7               | 6.2 Activate audit logging | X    | X    | X    |
