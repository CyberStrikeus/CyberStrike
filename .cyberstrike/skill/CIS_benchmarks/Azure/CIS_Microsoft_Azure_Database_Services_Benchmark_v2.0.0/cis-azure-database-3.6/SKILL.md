---
name: cis-azure-database-3.6
description: "Ensure the firewall does not allow all network traffic"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, cosmos-db, nosql]
cis_id: "3.6"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.6 Ensure the firewall does not allow all network traffic (Automated)

## Profile Applicability

- Level 1

## Description

Do not allow all network traffic. Restrict access to specific IP addresses or ranges.

## Rationale

Allowing all network traffic limits the effectiveness of a firewall.

## Impact

Administrative effort to identify and maintain the list of IP addresses and ranges requiring access to the account.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Azure Cosmos DB`.
2. Select the name of an Azure Cosmos DB account.
3. Under **Settings**, select **Networking**.
4. Under `Public access`, if `Public network access` is set to `Selected networks`, ensure `0.0.0.0` is not listed under `Firewall` > `IPs`.
5. Repeat steps 1-4 for each account.

### Audit from Azure CLI

Run the following command to list Azure Cosmos DB accounts:

```bash
az cosmosdb list
```

For each account, run the following command to get the list of allowed IP addresses:

```bash
az cosmosdb show --resource-group <resource-group> --name <cosmos-db> --query ipRules
```

Ensure that the response does not contain `"0.0.0.0"`.

### Audit from PowerShell

Run the following command to get Azure Cosmos DB accounts for a given resource group:

```powershell
Get-AzCosmosDBAccount -ResourceGroupName <resource-group>
```

Run the following command to get the account with a given name:

```powershell
$cosmosdb = Get-AzCosmosDBAccount -ResourceGroupName <resource-group> -Name <cosmos-db>
```

Run the following command to get the list of allowed IP addresses:

```powershell
$cosmosdb.IpRules
```

Ensure that the response does not contain `0.0.0.0`.

Repeat for each account.

### Audit from Azure Policy

- **Policy ID:** `12339a85-a25c-4f17-9f82-4766f13f5c4c` - **Name:** 'Azure Cosmos DB accounts should not allow traffic from all Azure data centers'

## Expected Result

The IP rules should not contain `0.0.0.0`, which would allow all network traffic.

## Remediation

### Remediate from Azure Portal

1. Go to `Azure Cosmos DB`.
2. Select the name of an Azure Cosmos DB account.
3. Under **Settings**, select **Networking**.
4. Under `Public access`, `Firewall` > `IPs`, select the **Delete** icon next to `0.0.0.0`.
5. Select **Save**.
6. Repeat steps 1-5 for each account requiring remediation.

### Remediate from Azure CLI

For each account requiring remediation, run the following command to update the list of allowed IP addresses, excluding `0.0.0.0`:

```bash
az cosmosdb update --resource-group <resource-group> --name <cosmos-db-account> --ip-range-filter <comma-separated-list-of-allowed-ip-addresses>
```

### Remediate from PowerShell

For each account requiring remediation, run the following command to update the list of allowed IP addresses, excluding `0.0.0.0`:

```powershell
Update-AzCosmosDBAccount -ResourceGroupName <resource-group> -Name <cosmos-db-account> -IpRule <comma-separated-list-of-allowed-ip-addresses>
```

## Default Value

By default, the firewall does not allow all network traffic.

## Additional Information

Setting `publicNetworkAccess` to `Disabled` takes precedence over `Accept connections from within public Azure datacenters`.

## References

1. [https://learn.microsoft.com/en-gb/azure/cosmos-db/how-to-configure-firewall#allow-requests-from-global-azure-datacenters-or-other-sources-within-azure](https://learn.microsoft.com/en-gb/azure/cosmos-db/how-to-configure-firewall#allow-requests-from-global-azure-datacenters-or-other-sources-within-azure)

## CIS Controls

| Controls Version | Control                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers   | X    | X    | X    |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering | X    | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1530                       | TA0009  | M1037       |
