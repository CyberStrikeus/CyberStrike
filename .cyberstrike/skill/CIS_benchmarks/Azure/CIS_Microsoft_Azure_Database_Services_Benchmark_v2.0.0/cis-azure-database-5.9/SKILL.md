---
name: cis-azure-database-5.9
description: "Ensure server parameter 'tls_version' is set to 'TLSv1.2' (or higher) for MySQL flexible server"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, mysql, database]
cis_id: "5.9"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.9 Ensure server parameter 'tls_version' is set to 'TLSv1.2' (or higher) for MySQL flexible server (Automated)

## Profile Applicability

- Level 1

## Description

Ensure `tls_version` on `MySQL flexible servers` is set to use TLS version 1.2 or higher.

## Rationale

The Secure Sockets Layer (SSL) protocol encrypts network traffic transiting between server and client.

Using only the most recent versions of SSL protocols (TLS version 1.2 and higher) eliminates susceptibility to known exploited vulnerabilities of outdated versions of TLS. If TLS 1.2 does not provide additional granular configuration options for supported cipher suites, there's a chance that default ciphers which employ Cipher Block Chaining (CBC) mode may be enabled which would introduce Padding Oracle types of vulnerabilities. TLS 1.3 does not support CBC mode ciphers by default and by default supports GCM ciphers which include an extra authentication step during the clear text to cipher text encryption process.

TLS version 1.3 is preferable where it is possible to implement.

Versions 1.0 and 1.1 of TLS are no longer considered secure. These versions should not be used or permitted where data integrity and confidentiality are required.

## Impact

None specified.

## Audit

### Audit from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for MySQL flexible servers`.
3. For each database, under `Settings`, click `Server parameters`.
4. In the filter bar, type `tls_version`.
5. Ensure `tls_version` is set to `TLSv1.2` (or higher).

### Audit from Azure CLI

Ensure the `value` of the below command contains `TLSv1.2` or higher, and does not contain anything lower than `TLSv1.2`:

```bash
az mysql flexible-server parameter show --resource-group <resourceGroup> --server-name <serverName> --name tls_version
```

Example output:

```json
{
  "allowedValues": "TLSv1,TLSv1.1,TLSv1.2",
  "dataType": "Set",
  "defaultValue": "TLSv1.2",
  "description": "Which protocols the server permits for encrypted connections. By default, TLS 1.2 is enforced",
  "id": "/subscriptions/<subscriptionId>/resourceGroups/<resourceGroupName>/providers/Microsoft.DBforMySQL/flexibleServers/<serverName>/configurations/tls_version",
  "isConfigPendingRestart": "False",
  "isDynamicConfig": "False",
  "isReadOnly": "False",
  "name": "tls_version",
  "resourceGroup": "<resourceGroupName>",
  "source": "system-default",
  "systemData": null,
  "type": "Microsoft.DBforMySQL/flexibleServers/configurations",
  "value": "TLSv1.2"
}
```

### Audit from PowerShell

Ensure the `Value` of the below command contains `TLSv1.2` or higher, and does not contain anything lower than `TLSv1.2`:

```powershell
Get-AzMySqlFlexibleServerConfiguration -ResourceGroupName <resourceGroup> -ServerName <ServerName> -Name tls_version
```

## Expected Result

The `tls_version` server parameter should be set to `TLSv1.2` or higher, with no versions lower than TLSv1.2 included.

## Remediation

### Remediate from Azure Portal

1. Login to Azure Portal using https://portal.azure.com.
2. Go to `Azure Database for MySQL flexible servers`.
3. For each database, under `Settings`, click `Server parameters`.
4. In the filter bar, type `tls_version`.
5. Click on the VALUE dropdown next to `tls_version`, and check `TLSv1.2` (or higher).
6. Uncheck anything lower than `TLSv1.2`.
7. Click `Save`.

### Remediate from Azure CLI

Use the below command to update MySQL flexible servers to use TLS version 1.2:

```bash
az mysql flexible-server parameter set --resource-group <resourceGroup> --server-name <serverName> --name tls_version --value TLSv1.2
```

## Default Value

By default, TLS 1.2 is enforced for MySQL flexible servers.

## References

1. https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-networking#tls-and-ssl
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-3-encrypt-sensitive-data-in-transit

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | X    | X    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1040                       | TA0006, TA0007 | M1041       |
