---
name: cis-azure-database-6.10
description: "Ensure server parameter 'require_secure_transport' is set to 'ON' for PostgreSQL server"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, postgresql, database]
cis_id: "6.10"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.10 Ensure server parameter 'require_secure_transport' is set to 'ON' for PostgreSQL server (Automated)

## Profile Applicability

- Level 1

## Description

Enable `require_secure_transport` on `PostgreSQL flexible servers`.

## Rationale

SSL connectivity helps to provide a new layer of security by connecting database server to client applications using Secure Sockets Layer (SSL). Enforcing SSL connections between database server and client applications helps protect against "man in the middle" attacks by encrypting the data stream between the server and application.

## Impact

None documented.

## Audit Procedure

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter bar, type `require_secure_transport`.
5. Ensure that the `VALUE` for `require_secure_transport` is set to `ON`.

### Audit from Azure CLI

Ensure the below command returns a `value` of `on`:

```bash
az postgres flexible-server parameter show --resource-group <resourceGroup> --server-name <serverName> --name require_secure_transport
```

### Audit from PowerShell

Ensure the below command returns a `Value` of `on`:

```powershell
Get-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name require_secure_transport
```

### Audit from Azure Policy

Policy ID: `c29c38cb-74a7-4505-9a06-e588ab86620a`
Name: 'Enforce SSL connection should be enabled for PostgreSQL flexible servers'

## Expected Result

The `require_secure_transport` server parameter should be set to `ON`.

## Remediation

### Remediate from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter bar, type `require_secure_transport`.
5. Set `VALUE` for `require_secure_transport` to `ON`.
6. Click `Save`.

### Remediate from Azure CLI

Use the below command to enable `require_secure_transport`:

```bash
az postgres flexible-server parameter set --resource-group <resourceGroup> --server-name <serverName> --name require_secure_transport --value on
```

### Remediate from PowerShell

```powershell
Update-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name require_secure_transport -Value on
```

## Default Value

By default, secure connectivity is enforced, but some application frameworks may not enable it during deployment.

## References

1. https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-networking-ssl-tls
2. https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/how-to-connect-tls-ssl
3. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/get-azpostgresqlflexibleserverconfiguration
4. https://learn.microsoft.com/en-us/powershell/module/az.postgresql/update-azpostgresqlflexibleserverconfiguration
5. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-3-encrypt-sensitive-data-in-transit

## Profile

- Level 1
