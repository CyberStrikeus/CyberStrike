---
name: cis-azure-database-9.3
description: "Ensure no Azure SQL Database firewall rule is overly permissive"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, sql-database, sql-server]
cis_id: "9.3"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.3 Ensure no Azure SQL Database firewall rule is overly permissive (Automated)

## Profile Applicability

- Level 1

## Description

Ensure that no SQL Databases have overly permissive firewall rules (e.g. rule allowing traffic with start IP address of 0.0.0.0 and end IP address of 255.255.255.255, or other combinations allowing large swathes of IP addresses).

## Rationale

The preferred setting for Public Network Access is disabled. If Public Network Access is disabled, this recommendation is moot. In general, the use of well architected Private Endpoints for network traffic management is strongly preferred to allowing any public network access.

Where Public Network Access must be allowed as an exception, Azure SQL Server provides a firewall to explicitly define traffic allowance and denial. In order to reduce the potential attack surface for a SQL server, firewall rules should be reviewed from time to time to ensure that no rule is overly permissive, and all included rules are justified through association with known and trusted sources and destinations.

**NOTE:** For some Azure services to work with Azure SQL databases, the `Allow Azure services and resource to access this server` exception may need to be allowed. This exception creates a firewall rule named `AllowAllWindowsAzureIps` that may be considered overly permissive. It should be noted that this exception places implicit trust on a rule which is defined and managed by Microsoft.

## Impact

Managing firewall rules will require some consideration from a network architecture perspective to ensure appropriate traffic is allowed.

## Audit Procedure

### Audit from Azure Portal

1. Search for and open `SQL servers`.
2. For each SQL server listed, click on the server name to open the resource management window.
3. Expand the Security section, then click on `Networking`.
4. On the 'Public access' tab, if public network access is set to "Selected Networks," scroll down to review the `Firewall rules`.

Ensure that no firewall rule exists which allows traffic with a source of `0.0.0.0` or other combinations which permit access to/from wider public IP ranges.

### Audit from Azure CLI

List all SQL servers:

```bash
az sql server list
```

For each SQL server run the following command:

```bash
az sql server firewall-rule list --resource-group <resource group name> --server <sql server name>
```

Ensure the output does not contain any firewall `allow` rules with a source of `0.0.0.0` or other combinations which allows access to wider public IP ranges.

### Audit from PowerShell

Get the list of all SQL Servers:

```powershell
Get-AzSqlServer
```

For each Server:

```powershell
Get-AzSqlServerFirewallRule -ResourceGroupName <resource group name> -ServerName <server name>
```

Ensure that `StartIpAddress` is not set to `0.0.0.0`, `/0` or other combinations which allows access to wider public IP ranges including Azure IP ranges.

## Expected Result

No firewall rules should exist with overly permissive IP ranges (e.g., `0.0.0.0` to `255.255.255.255`).

## Remediation

### Remediate from Azure Portal

1. Search for and open `SQL servers`.
2. For each SQL server listed, click on the server name to open the resource management window.
3. Expand the Security section, then click on `Networking`.
4. On the 'Public access' tab, if public network access is set to "Selected Networks," scroll down to the Firewall Rules section.
5. Remove overly permissive firewall rules and ensure that any remaining rules contain only source and destination IPs which are trusted.

### Remediate from Azure CLI

Identify the resource group, server name, and firewall rule name which are overly permissive, then delete the identified rule with the following command:

```bash
az sql server firewall-rule delete --resource-group <resource_group> --server <sql_server_name> --name <firewall_rule_name>
```

For trusted IP addresses, use these commands to create or update rules as needed:

```bash
az sql server firewall-rule create --resource-group <resource_group> --server <sql_server_name> --name <firewall_rule_name> --start-ip-address "<IP Address other than 0.0.0.0>" --end-ip-address "<IP Address other than 0.0.0.0 or 255.255.255.255>"
```

### Remediate from PowerShell

Identify the resource group, server name, and firewall rule name which are overly permissive, then delete the identified rule with the following command:

```powershell
Remove-AzSqlServerFirewallRule -FirewallRuleName "<firewall_rule_name>" -ResourceGroupName <resource_group_name> -ServerName <server_name>
```

For trusted IP addresses, use these commands to create or update rules as needed:

```powershell
Set-AzSqlServerFirewallRule -ResourceGroupName <resource_group_name> -ServerName <server_name> -FirewallRuleName "<firewall_rule_name>" -StartIpAddress "<IP Address other than 0.0.0.0>" -EndIpAddress "<IP Address other than 0.0.0.0 or 255.255.255.255>"
```

## Default Value

By default, no firewall rules exist.

## References

1. https://docs.microsoft.com/en-us/sql/database-engine/configure-windows/configure-a-windows-firewall-for-database-engine-access?view=sql-server-2017
2. https://docs.microsoft.com/en-us/powershell/module/azurerm.sql/get-azurermsqlserverfirewallrule?view=azurermps-5.2.0
3. https://docs.microsoft.com/en-us/powershell/module/azurerm.sql/set-azurermsqlserverfirewallrule?view=azurermps-5.2.0
4. https://docs.microsoft.com/en-us/powershell/module/azurerm.sql/remove-azurermsqlserverfirewallrule?view=azurermps-5.2.0
5. https://learn.microsoft.com/en-us/azure/azure-sql/database/firewall-configure?view=azuresql#connections-from-inside-azure
6. https://docs.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-set-database-firewall-rule-azure-sql-database?view=azuresqldb-current
7. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls
8. https://learn.microsoft.com/en-us/azure/azure-sql/database/firewall-configure?view=azuresql

## Profile

- Level 1
