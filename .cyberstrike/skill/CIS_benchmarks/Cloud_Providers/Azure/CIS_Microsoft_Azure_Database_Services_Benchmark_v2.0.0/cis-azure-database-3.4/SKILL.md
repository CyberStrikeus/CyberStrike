---
name: cis-azure-database-3.4
description: "Ensure 'Public Network Access' is 'Disabled'"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, cosmos-db, nosql]
cis_id: "3.4"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.4 Ensure 'Public Network Access' is 'Disabled' (Manual)

## Profile Applicability

- Level 2

## Description

Setting public networks to disabled prevents requests from the public internet.

## Rationale

Allowlisting secures Azure Cosmos DB from the public internet and prevents unauthorized access requests.

## Impact

If improperly configured, network communication to the Azure Cosmos DB Account will be interrupted, including Azure web portal access potentially. Be certain to check the additional resources linked here and allowlist appropriate IPs for your environment before selecting apply.

Disabling 'Public Network Access' forces the requirement of the use of Private Endpoints for network connectivity which will require some additional consideration from a network architecture perspective and will introduce cost based on the inbound/outbound data being processed by the Private Endpoint.

## Audit Procedure

### Audit from Azure Portal

1. Select or search for `Azure CosmosDB`.
2. Select your Azure CosmosDB Account.
3. In the left column expand `> Settings`.
4. Select **Networking**.
5. Determine in the second row if Public Network Access is set to `All Networks`.

### Audit from PowerShell

1. Run the following PowerShell command with identifying information for your environment.

```powershell
Get-AzCosmosDBAccount -Name <cosmosdbaccountname> -ResourceGroupName <resourcegroupname> | Select-Object -Property "PublicNetworkAccess", "IpRules", "IpRangeFilter"
```

2. Determine from left to right, if public network access is enabled, which IpRules are set, and which IP Ranges are allowlisted. All must be accurate for your environment for proper functionality.

### Audit From Azure Policy

- **Policy ID:** `797b37f7-06b8-444c-b1ad-fc62867f335a` - **Name:** 'Azure Cosmos DB should disable public network access'

## Expected Result

Public Network Access should be set to **Disabled**, or if set to `Selected networks`, only appropriate IP addresses should be allowlisted.

## Remediation

### Remediate from Azure Portal

1. Select or search for `Azure CosmosDB`.
2. Select your Azure CosmosDB Account.
3. In the left column expand `> Settings`.
4. Select **Networking**.
5. Under `Public Access` select the radial button **Disabled**.
6. Select **Save**

### Remediate from PowerShell

1. Run the following PowerShell as many times as you need with the public network information for your environment to allowlist your ip addresses with CIDR notation, e.g. `0.0.0.0/0`. These must also not be private IP addresses.

```powershell
Update-AzCosmosDBAccount -name <cosmosdbaccountname> -ResourceGroupName <resourcegroupname> -IPRule <IPRange>
```

2. Once all your IP addresses are allowlisted, run the following PowerShell command with identifying information for your environment.

```powershell
Update-AzCosmosDBAccount -name <cosmosdbaccountname> -ResourceGroupName <resourcegroupname> -PublicNetworkAccess 'Disabled'
```

## Default Value

Unless specified at resource creation, Azure CosmosDB by default allows public network access, but authenticates requests.

## References

1. [https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-configure-firewall](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-configure-firewall)
2. [https://learn.microsoft.com/en-us/powershell/module/az.cosmosdb/update-azcosmosdbaccount?view=azps-15.0.0#-publicnetworkaccess](https://learn.microsoft.com/en-us/powershell/module/az.cosmosdb/update-azcosmosdbaccount?view=azps-15.0.0#-publicnetworkaccess)

## CIS Controls

| Controls Version | Control                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers   | X    | X    | X    |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering | X    | X    | X    |
