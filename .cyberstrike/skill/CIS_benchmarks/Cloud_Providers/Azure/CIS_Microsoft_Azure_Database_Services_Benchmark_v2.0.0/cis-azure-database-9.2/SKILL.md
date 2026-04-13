---
name: cis-azure-database-9.2
description: "Ensure that 'Public Network Access' is set to 'Disable'"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, sql-database, sql-server]
cis_id: "9.2"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.2 Ensure that 'Public Network Access' is set to 'Disable' (Automated)

## Profile Applicability

- Level 2

## Description

Disabling public network access restricts the service from accessing public networks.

## Rationale

A secure network architecture requires carefully constructed network segmentation. Public network access is overly permissive and introduces unintended vectors for threat activity.

## Impact

Disabling 'Public Network Access' forces the requirement of the use of Private Endpoints for network connectivity which will require some additional consideration from a network architecture perspective and will introduce cost based on the inbound/outbound data being processed by the Private Endpoint.

## Audit Procedure

### Audit from Azure Portal

1. Go to `SQL servers`.
2. For each SQL server, under `Security`, click `Networking`.
3. Ensure that `Public network access` is set to `Disable`.

### Audit from Azure CLI

List all SQL Servers and ensure `publicNetworkAccess` is not `Enabled`:

```bash
az sql server list --query "[].{name:name, resourceGroup:resourceGroup, publicNetworkAccess:publicNetworkAccess}"
```

### Audit from PowerShell

List all SQL Servers and ensure `PublicNetworkAccess` is not `Enabled`:

```powershell
Get-AzSqlServer | Select-Object -Property ServerName, ResourceGroupName, PublicNetworkAccess
```

### Audit from Azure Policy

Policy ID: `1b8ca024-1d5c-4dec-8995-b1a932b41780`
Name: 'Public network access on Azure SQL Database should be disabled'

## Expected Result

`Public network access` should be set to `Disable`.

## Remediation

### Remediate from Azure Portal

1. Go to `SQL servers`.
2. For each SQL server, under `Security`, click `Networking`.
3. Set `Public network access` to `Disable`.
4. Click `Save`.

### Remediate from Azure CLI

For each SQL server with `publicNetworkAccess` `Enabled`, set it to `Disabled`:

```bash
az sql server update -n <sqlServerName> -g <resourceGroup> --set publicNetworkAccess="Disabled"
```

### Remediate from PowerShell

For each SQL server with `PublicNetworkAccess` `Enabled`, set it to `Disabled`:

```powershell
Set-AzSqlServer -ServerName <sqlServerName> -ResourceGroupName <resourceGroup> -PublicNetworkAccess "Disabled"
```

## Default Value

By default, Azure SQL Server's public network access is set to `Disable`.

## References

1. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-network-security#ns-2-secure-cloud-services-with-network-controls
2. https://learn.microsoft.com/en-us/azure/azure-sql/database/connectivity-settings?view=azuresql&tabs=azure-portal#deny-public-network-access

## Profile

- Level 2
