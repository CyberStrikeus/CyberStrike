---
name: cis-azure-database-9.1
description: "Ensure that 'Auditing' is set to 'On'"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, sql-database, sql-server]
cis_id: "9.1"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.1 Ensure that 'Auditing' is set to 'On' (Automated)

## Profile Applicability

- Level 1

## Description

Enable auditing on SQL Servers.

## Rationale

The Azure platform allows a SQL server to be created as a service. Enabling auditing at the server level ensures that all existing and newly created databases on the SQL server instance are audited. Auditing policy applied on the SQL database does not override auditing policy and settings applied on the particular SQL server where the database is hosted.

Auditing tracks database events and writes them to an audit log in the Azure storage account. It also helps to maintain regulatory compliance, understand database activity, and gain insight into discrepancies and anomalies that could indicate business concerns or suspected security violations.

## Impact

None documented.

## Audit Procedure

### Audit from Azure Portal

1. Go to `SQL servers`.
2. For each server instance.
3. Click on `Auditing`.
4. Ensure that `Enable Azure SQL Auditing` is set to `On`.

### Audit from PowerShell

Get the list of all SQL Servers:

```powershell
Get-AzSqlServer
```

For each Server:

```powershell
Get-AzSqlServerAudit -ResourceGroupName <ResourceGroupName> -ServerName <SQLServerName>
```

Ensure that `BlobStorageTargetState`, `EventHubTargetState`, or `LogAnalyticsTargetState` is set to `Enabled`.

### Audit from Azure Policy

Policy ID: `a6fb4358-5bf4-4ad7-ba82-2cd2f41ce5e9`
Name: 'Auditing on SQL server should be enabled'

## Expected Result

`Enable Azure SQL Auditing` should be set to `On`. At least one of `BlobStorageTargetState`, `EventHubTargetState`, or `LogAnalyticsTargetState` should be `Enabled`.

## Remediation

### Remediate from Azure Portal

1. Go to `SQL servers`.
2. Select the SQL server instance.
3. Under `Security`, click `Auditing`.
4. Click the toggle next to `Enable Azure SQL Auditing`.
5. Select an Audit log destination.
6. Click `Save`.

### Remediate from PowerShell

Get the list of all SQL Servers:

```powershell
Get-AzSqlServer
```

For each Server, enable auditing and set the retention for at least 90 days.

**Log Analytics Example:**

```powershell
Set-AzSqlServerAudit -ResourceGroupName <resource group name> -ServerName <SQL Server name> -RetentionInDays <Number of Days to retain the audit logs, should be 90days minimum> -LogAnalyticsTargetState Enabled -WorkspaceResourceId "/subscriptions/<subscription ID>/resourceGroups/insights-integration/providers/Microsoft.OperationalInsights/workspaces/<workspace name>"
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

By default, `Enable Azure SQL Auditing` is set to `Off`.

## References

1. https://docs.microsoft.com/en-us/azure/security-center/security-center-enable-auditing-on-sql-servers
2. https://docs.microsoft.com/en-us/powershell/module/azurerm.sql/get-azurermsqlserverauditing?view=azurermps-5.2.0
3. https://docs.microsoft.com/en-us/powershell/module/azurerm.sql/set-azurermsqlserverauditingpolicy?view=azurermps-5.2.0
4. https://docs.microsoft.com/en-us/azure/sql-database/sql-database-auditing
5. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation

## Profile

- Level 1
