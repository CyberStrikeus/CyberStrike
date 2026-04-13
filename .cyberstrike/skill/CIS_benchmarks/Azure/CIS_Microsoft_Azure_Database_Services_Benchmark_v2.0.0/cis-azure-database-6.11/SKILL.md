---
name: cis-azure-database-6.11
description: "Ensure server parameter 'ssl_min_protocol_version' is set to 'TLSv1.2' or higher for PostgreSQL server"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, postgresql, database]
cis_id: "6.11"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.11 Ensure server parameter 'ssl_min_protocol_version' is set to 'TLSv1.2' or higher for PostgreSQL server (Automated)

## Profile Applicability

- Level 1

## Description

**Note:** It is not possible to set the minimal TLS version on PostgreSQL flexible server to lower than 1.2. Incoming connections which try to encrypt the traffic using TLS 1.0 and TLS 1.1 are denied.

Setting 'ssl_min_protocol_version' to 'TLSv1.2' or higher reduces TLS protocol vulnerabilities by preventing the use of significantly outdated versions of TLS.

## Rationale

The Secure Sockets Layer (SSL) protocol encrypts network traffic transiting between server and client.

Using only the most recent versions of SSL protocols (TLS version 1.2 and higher) eliminates susceptibility to known exploited vulnerabilities of outdated versions of TLS. If TLS 1.2 does not provide additional granular configuration options for supported cipher suites, there's a chance that default ciphers which employ Cipher Block Chaining (CBC) mode may be enabled which would introduce Padding Oracle types of vulnerabilities. TLS 1.3 does not support CBC mode ciphers by default and by default supports GCM ciphers which include an extra authentication step during the clear text to cipher text encryption process.

TLS version 1.3 is preferable where it is possible to implement.

Versions 1.0 and 1.1 of TLS are no longer considered secure. These versions should not be used or permitted where data integrity and confidentiality are required.

## Impact

TLS 1.3 is not compatible with older versions, so must be supported by all clients to be implemented.

Cipher suites may be able to be specified for TLS 1.2 if a premium SKU is in use.

## Audit Procedure

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter box, type `ssl_min_protocol_version`.
5. Ensure `ssl_min_protocol_version` is set to `TLSV1.2` or higher.
6. Repeat steps 1-5 for each server.

### Audit from Azure CLI

Run the following command to list PostgreSQL flexible servers:

```bash
az postgres flexible-server list
```

For each server, run the following command to get the `ssl_min_protocol_version` parameter value:

```bash
az postgres flexible-server parameter show --resource-group <resource-group> --server-name <server> --name ssl_min_protocol_version --query value
```

Ensure `"TLSv1.2"` or higher is returned.

### Audit from PowerShell

Run the following command to list PostgreSQL flexible servers:

```powershell
Get-AzPostgreSqlFlexibleServer
```

For each server, run the following command to get the `ssl_min_protocol_version` parameter value:

```powershell
Get-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <resource-group> -ServerName <server> -Name ssl_min_protocol_version | Select -p Value
```

Ensure `TLSv1.2` or higher is returned.

### Audit from Azure Policy

Policy ID: `a43d5475-c569-45ce-a268-28fa79f4e87a`
Name: 'PostgreSQL flexible servers should be running TLS version 1.2 or newer'

## Expected Result

The `ssl_min_protocol_version` should be set to `TLSv1.2` or higher.

## Remediation

### Remediate from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for PostgreSQL servers`.
3. For each server, under `Settings`, click `Server parameters`.
4. In the filter box, type `ssl_min_protocol_version`.
5. Set `ssl_min_protocol_version` to `TLSV1.2` or higher.
6. Select `Save`.
7. Repeat steps 1-6 for each server requiring remediation.

### Remediate from Azure CLI

For each server requiring remediation, run the following command to set `ssl_min_protocol_version` to `TLSv1.2` or higher:

```bash
az postgres flexible-server parameter set --resource-group <resource-group> --server-name <server> --name ssl_min_protocol_version --value TLSv1.2
```

### Remediate from PowerShell

For each server requiring remediation, run the following command to set `ssl_min_protocol_version` to `TLSv1.2` or higher:

```powershell
Update-AzPostgreSqlFlexibleServerConfiguration -ResourceGroupName <resource-group> -ServerName <server> -Name ssl_min_protocol_version -Value TLSv1.2
```

## Default Value

By default, `ssl_min_protocol_version` is set to `TLSv1.2`.

## References

1. https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/security-connect-tls
2. https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls

## Profile

- Level 1
