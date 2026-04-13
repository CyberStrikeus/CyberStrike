---
name: cis-azure-database-5.8
description: "Ensure server parameter 'require_secure_transport' is set to 'ON' for MySQL Server"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, mysql, database]
cis_id: "5.8"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.8 Ensure server parameter 'require_secure_transport' is set to 'ON' for MySQL Server (Automated)

## Profile Applicability

- Level 1

## Description

Enable `require_secure_transport` on `MySQL flexible servers`.

## Rationale

The Secure Sockets Layer (SSL) protocol encrypts network traffic transiting between server and client. Enforcing SSL connections between database server and client applications helps protect against "man in the middle" attacks by encrypting the data stream between the server and application.

## Impact

None specified.

## Audit

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for MySQL flexible servers`.
3. For each database, under `Settings`, click `Server parameters`.
4. In the filter bar, type `require_secure_transport`.
5. Ensure that the value for `require_secure_transport` is `ON`.

### Audit from Azure CLI

Ensure the below command returns a `value` of `on`:

```bash
az mysql flexible-server parameter show --resource-group <resourceGroup> --server-name <serverName> --name require_secure_transport
```

### Audit from PowerShell

Ensure the below command returns a `Value` of `on`:

```powershell
Get-AzMySqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name require_secure_transport
```

## Expected Result

The `require_secure_transport` server parameter should return a value of `ON`.

## Remediation

### Remediate from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for MySQL flexible servers`.
3. For each database, under `Settings`, click `Server parameters`.
4. In the filter bar, type `require_secure_transport`.
5. Set the `VALUE` for `require_secure_transport` to `ON`.
6. Click `Save`.

### Remediate from Azure CLI

Use the below command to enable `require_secure_transport`:

```bash
az mysql flexible-server parameter set --resource-group <resourceGroup> --server-name <serverName> --name require_secure_transport --value on
```

### Remediate from PowerShell

Use the below command to enable `require_secure_transport`:

```powershell
Update-AzMySqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <serverName> -Name require_secure_transport -Value on
```

## Default Value

Azure Database for MySQL when provisioned through the Azure portal or CLI will require SSL connections by default.

## References

1. https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-networking#tls-and-ssl
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-3-encrypt-sensitive-data-in-transit

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | X | X |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | X | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1040 | TA0006, TA0007 | M1041 |
