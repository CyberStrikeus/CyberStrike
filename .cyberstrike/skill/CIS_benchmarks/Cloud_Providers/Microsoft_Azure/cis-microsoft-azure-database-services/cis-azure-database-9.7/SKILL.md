---
name: cis-azure-database-9.7
description: "Ensure that 'Auditing' Retention is 'greater than 90 days'"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, sql-database, sql-server]
cis_id: "9.7"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.7 Ensure that 'Auditing' Retention is 'greater than 90 days' (Automated)

## Profile Applicability

- Level 1

## Description

SQL Server Audit Retention should be configured to be greater than 90 days.

## Rationale

Audit Logs can be used to check for anomalies and give insight into suspected breaches or misuse of information and access.

## Impact

None documented.

## Audit Procedure

### Audit from Azure Portal

1. Go to `SQL servers`.
2. For each server instance.
3. Click on `Auditing`.
4. If storage is selected, expand `Advanced properties`.
5. Ensure `Retention (days)` setting is greater than `90` days or `0` for unlimited retention.

### Audit from PowerShell

Get the list of all SQL Servers:

```powershell
Get-AzSqlServer
```

For each Server:

```powershell
Get-AzSqlServerAudit -ResourceGroupName <resource group name> -ServerName <server name>
```

Ensure that `RetentionInDays` is set to `more than 90`.

**Note:** If the SQL server is set with `LogAnalyticsTargetState` setting set to `Enabled`, run the following additional command:

```powershell
Get-AzOperationalInsightsWorkspace | Where-Object {$_.ResourceId -eq <SQL Server WorkSpaceResourceId>}
```

Ensure that `RetentionInDays` is set to `more than 90`.

### Audit from Azure Policy

Policy ID: `89099bee-89e0-4b26-a5f4-165451757743`
Name: 'SQL servers with auditing to storage account destination should be configured with 90 days retention or higher'

## Expected Result

`Retention (days)` should be greater than `90` days or `0` for unlimited retention.

## Remediation

### Remediate from Azure Portal

1. Go to `SQL servers`.
2. For each server instance.
3. Click on `Auditing`.
4. If storage is selected, expand `Advanced properties`.
5. Set the `Retention (days)` setting greater than `90` days or `0` for unlimited retention.
6. Select `Save`.

### Remediate from PowerShell

For each Server, set retention policy to more than 90 days.

**Log Analytics Example:**

```powershell
Set-AzSqlServerAudit -ResourceGroupName <resource group name> -ServerName <SQL Server name> -RetentionInDays <Number of Days to retain the audit logs, should be more than 90 days> -LogAnalyticsTargetState Enabled -WorkspaceResourceId "/subscriptions/<subscription ID>/resourceGroups/insights-integration/providers/Microsoft.OperationalInsights/workspaces/<workspace name>"
```

**Event Hub Example:**

```powershell
Set-AzSqlServerAudit -ResourceGroupName "<resource group name>" -ServerName "<SQL Server name>" -EventHubTargetState Enabled -EventHubName "<Event Hub name>" -EventHubAuthorizationRuleResourceId "<Event Hub Authorization Rule Resource ID>"
```

**Blob Storage Example:**

```powershell
Set-AzSqlServerAudit -ResourceGroupName "<resource group name>" -ServerName "<SQL Server name>" -BlobStorageTargetState Enabled -StorageAccountResourceId "/subscriptions/<subscription_ID>/resourceGroups/<Resource_Group>/providers/Microsoft.Storage/storageAccounts/<Storage Account name>"
```

## Default Value

By default, SQL Server audit storage is `disabled`.

## References

1. https://docs.microsoft.com/en-us/azure/sql-database/sql-database-auditing
2. https://docs.microsoft.com/en-us/powershell/module/azurerm.sql/get-azurermsqlserverauditing?view=azurermps-5.2.0
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-6-configure-log-storage-retention

## Profile

- Level 1
