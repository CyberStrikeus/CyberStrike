---
name: cis-azure-database-9.8
description: "Ensure 'Minimum TLS Version' is set to 'TLS 1.2' or higher"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, sql-database, sql-server]
cis_id: "9.8"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.8 Ensure 'Minimum TLS Version' is set to 'TLS 1.2' or higher (Automated)

## Profile Applicability

- Level 1

## Description

**Note:** It is no longer possible to set the minimal TLS version of SQL server to lower than 1.2. Azure ended support for TLS 1.0 and 1.1 in August 2025.

Setting the 'Minimum TLS version' to 'TLS 1.2' or higher reduces TLS protocol vulnerabilities by preventing the use of significantly outdated versions of TLS.

## Rationale

The Secure Sockets Layer (SSL) protocol encrypts network traffic transiting between server and client.

Using only the most recent versions of SSL protocols (TLS version 1.2 and higher) eliminates susceptibility to known exploited vulnerabilities of outdated versions of TLS. If TLS 1.2 does not provide additional granular configuration options for supported cipher suites, there's a chance that default ciphers which employ Cipher Block Chaining (CBC) mode may be enabled which would introduce Padding Oracle types of vulnerabilities. TLS 1.3 does not support CBC mode ciphers by default and by default supports GCM ciphers which include an extra authentication step during the clear text to cipher text encryption process.

TLS version 1.3 is preferable where it is possible to implement.

Versions 1.0 and 1.1 of TLS are no longer considered secure. These versions should not be used or permitted where data integrity and confidentiality are required.

## Impact

No impact to cost or performance.

## Audit Procedure

### Audit from Azure Portal

1. Go to `SQL servers`.
2. Select the name of a SQL server.
3. Under `Security`, select `Networking`.
4. Select `Connectivity`.
5. Under `Encryption in transit`, ensure `Minimum TLS version` is set to `TLS 1.2` or higher.
6. Repeat steps 1-5 for each SQL server.

### Audit from Azure CLI

Run the following command to list SQL servers:

```bash
az sql server list
```

For each SQL server, run the following command to get the `minimalTlsVersion` setting:

```bash
az sql server show --resource-group <resource-group> --name <sql-server> --query minimalTlsVersion
```

Ensure `"1.2"` or higher is returned.

### Audit from PowerShell

Run the following command to list SQL servers:

```powershell
Get-AzSqlServer
```

Run the following command to get the server in a resource group with a given name:

```powershell
$server = Get-AzSqlServer -ResourceGroupName <resource-group> -ServerName <sql-server>
```

Run the following command to get the `MinimalTlsVersion`:

```powershell
$server.MinimalTlsVersion
```

Ensure `1.2` or higher is returned. Repeat for each SQL server.

### Audit from Azure Policy

Policy ID: `32e6bbec-16b6-44c2-be37-c5b672d103cf`
Name: 'Azure SQL Database should be running TLS version 1.2 or newer'

## Expected Result

`Minimum TLS version` should be set to `TLS 1.2` or higher.

## Remediation

### Remediate from Azure Portal

1. Go to `SQL servers`.
2. Select the name of a SQL server.
3. Under `Security`, select `Networking`.
4. Select `Connectivity`.
5. Under `Encryption in transit`, select `TLS 1.2` or higher from the dropdown menu next to `Minimum TLS version`.
6. Select `Save`.
7. Repeat steps 1-6 for each SQL server requiring remediation.

### Remediate from Azure CLI

For each SQL server requiring remediation, run the following command:

```bash
az sql server update --resource-group <resource-group> --name <sql-server> --minimal-tls-version 1.2
```

### Remediate from PowerShell

For each SQL server requiring remediation, run the following command:

```powershell
Set-AzSqlServer -ResourceGroupName <resource-group> -ServerName <sql-server> -MinimalTlsVersion "1.2"
```

## Default Value

By default, the Minimum TLS version is set to `TLS 1.2`.

## References

1. https://learn.microsoft.com/en-us/azure/azure-sql/database/connectivity-settings?view=azuresql
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-3-encrypt-sensitive-data-in-transit

## Profile

- Level 1
