---
name: cis-azure-database-9.6
description: "Ensure that 'Data encryption' is set to 'On' on a SQL Database"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, sql-database, sql-server]
cis_id: "9.6"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.6 Ensure that 'Data encryption' is set to 'On' on a SQL Database (Automated)

## Profile Applicability

- Level 1

## Description

Enable Transparent Data Encryption on every SQL server.

## Rationale

Azure SQL Database transparent data encryption helps protect against the threat of malicious activity by performing real-time encryption and decryption of the database, associated backups, and transaction log files at rest without requiring changes to the application.

## Impact

None documented.

## Audit Procedure

### Audit from Azure Portal

1. Go to `SQL databases`.
2. For each DB instance.
3. Click on `Transparent data encryption`.
4. Ensure that `Data encryption` is set to `On`.

### Audit from Azure CLI

Ensure the output of the below command is `Enabled`:

```bash
az sql db tde show --resource-group <resourceGroup> --server <dbServerName> --database <dbName> --query status
```

### Audit from PowerShell

Get a list of SQL Servers:

```powershell
Get-AzSqlServer
```

For each server, list the databases:

```powershell
Get-AzSqlDatabase -ServerName <SQL Server Name> -ResourceGroupName <Resource Group Name>
```

For each database not listed as a `Master` database, check for Transparent Data Encryption:

```powershell
Get-AzSqlDatabaseTransparentDataEncryption -ResourceGroupName <Resource Group Name> -ServerName <SQL Server Name> -DatabaseName <Database Name>
```

Make sure `DataEncryption` is `Enabled` for each database except the `Master` database.

### Audit from Azure Policy

Policy ID: `17k78e20-9358-41c9-923c-fb736d382a12`
Name: 'Transparent Data Encryption on SQL databases should be enabled'

## Expected Result

`Data encryption` should be set to `On` for all SQL databases (except master).

## Remediation

### Remediate from Azure Portal

1. Go to `SQL databases`.
2. For each DB instance.
3. Click on `Transparent data encryption`.
4. Set `Data encryption` to `On`.

### Remediate from Azure CLI

Use the below command to enable `Transparent data encryption` for SQL DB instance:

```bash
az sql db tde set --resource-group <resourceGroup> --server <dbServerName> --database <dbName> --status Enabled
```

### Remediate from PowerShell

Use the below command to enable `Transparent data encryption` for SQL DB instance:

```powershell
Set-AzSqlDatabaseTransparentDataEncryption -ResourceGroupName <Resource Group Name> -ServerName <SQL Server Name> -DatabaseName <Database Name> -State 'Enabled'
```

**Note:**
- TDE cannot be used to encrypt the logical master database in SQL Database. The master database contains objects that are needed to perform the TDE operations on the user databases.
- Azure Portal does not show master databases per SQL server. However, CLI/API responses will show master databases.

## Default Value

By default, `Data encryption` is set to `On`.

## References

1. https://docs.microsoft.com/en-us/sql/relational-databases/security/encryption/transparent-data-encryption-with-azure-sql-database
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-4-enable-data-at-rest-encryption-by-default
3. https://learn.microsoft.com/en-us/powershell/module/az.sql/set-azsqldatabasetransparentdataencryption?view=azps-9.2.0

## Profile

- Level 1
