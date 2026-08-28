---
name: cis-azure-database-6.3
description: "Ensure 'Public Network Access' is 'Disabled' for Azure Database for PostgreSQL"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, postgresql, database]
cis_id: "6.3"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3 Ensure 'Public Network Access' is 'Disabled' for Azure Database for PostgreSQL (Automated)

## Profile Applicability

- Level 2

## Description

Setting public networks to disabled prevents requests from the public internet.

## Rationale

Disabling public network access prevents Azure Database for PostgreSQL servers from communicating with the public internet and requires the use of Private endpoints for granular network control and segmentation.

## Impact

Disabling 'Public Network Access' forces the requirement of the use of Private Endpoints for network connectivity which will require some additional consideration from a network architecture perspective and will introduce cost based on the inbound/outbound data being processed by the Private Endpoint.

## Audit Procedure

### Audit from Azure Portal

1. From `Azure Database for PostgreSQL` select the database you wish to audit.
2. In the left column expand `> Settings`.
3. Select `Networking`.
4. Ensure that Public network access is `not selected`.

### Audit from PowerShell

Run the following command with the identifying details for your subscription:

```powershell
Get-AzPostgreSqlFlexibleServer -name <servername> -ResourceGroupName <resourcegroupname> | Select-Object -property NetworkPublicNetworkAccess
```

Ensure that Public network access is `Disabled`.

### Audit from Azure Policy

Policy ID: `b52376f7-9612-48a1-81cd-1f0e2bc4b3e5`
Name: 'Public network access should be disabled for PostgreSQL flexible servers'

## Expected Result

Public network access should be `Disabled`.

## Remediation

### Remediate from Azure Portal

1. From `Azure Database for PostgreSQL` select the database you wish to audit.
2. In the left column expand `> Settings`.
3. Select `Networking`.
4. Uncheck/deselect the `Public network access` option.
5. Click `Save`.

### Remediate from PowerShell

```powershell
Update-AzPostgreSqlFlexibleServer -name <servername> -ResourceGroupName <resourcegroupname> -PublicNetworkAccess "Disabled"
```

## Default Value

By default, Public network access is enabled for Azure Database for PostgreSQL.

## References

1. https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-networking

## Profile

- Level 2
