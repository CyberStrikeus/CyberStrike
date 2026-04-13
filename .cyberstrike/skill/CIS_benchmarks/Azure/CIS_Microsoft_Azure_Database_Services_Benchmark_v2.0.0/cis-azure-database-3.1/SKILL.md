---
name: cis-azure-database-3.1
description: "Ensure That 'Firewalls & Networks' Is Limited to Use Selected Networks Instead of All Networks"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, cosmos-db, nosql]
cis_id: "3.1"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1 Ensure That 'Firewalls & Networks' Is Limited to Use Selected Networks Instead of All Networks (Automated)

## Profile Applicability

- Level 2

## Description

Limiting your Cosmos DB to only communicate on whitelisted networks lowers its attack footprint.

## Rationale

Selecting certain networks for your Cosmos DB to communicate restricts the number of networks including the internet that can interact with what is stored within the database.

## Impact

**WARNING:** Failure to whitelist the correct networks will result in a connection loss. If using NoSQL / Table / Graph APIs for Cosmos DB Data Explorer end user IPs must be allowed. Other APIs are proxied and shouldn't require end user IPs.

**WARNING:** Changes to Cosmos DB firewalls may take up to 15 minutes to apply. Ensure that sufficient time is planned for remediation or changes to avoid disruption.

## Audit Procedure

### Audit From Azure Portal

1. Open the portal menu.
2. Select the Azure Cosmos DB blade
3. Select a Cosmos DB to audit.
4. Select **Networking**.
5. Under `Public network access`, ensure `Selected networks` is selected.
6. Under `Virtual networks`, ensure appropriate virtual networks are configured.

### Audit From Azure CLI

Retrieve a list of all CosmosDB database names:

```bash
az cosmosdb list
```

For each database listed, run the following command:

```bash
az cosmosdb show <database id>
```

For each database, ensure that `isVirtualNetworkFilterEnabled` is set to `true`.

### Audit From Azure Policy

- **Policy ID:** `862e97cf-49fc-4a5c-9de4-40d4e2e7c8eb` - **Name:** 'Azure Cosmos DB accounts should have firewall rules'

## Expected Result

`isVirtualNetworkFilterEnabled` should be set to `true` and `Public network access` should be set to `Selected networks` with appropriate virtual networks configured.

## Remediation

### Remediate From Azure Portal

1. Open the portal menu.
2. Select the Azure Cosmos DB blade.
3. Select a Cosmos DB account to audit.
4. Select **Networking**.
5. Under `Public network access`, select **Selected networks**.
6. Under `Virtual networks`, select `+ Add existing virtual network` or `+ Add a new virtual network`.
7. For existing networks, select subscription, virtual network, subnet and click **Add**. For new networks, provide a name, update the default values if required, and click **Create**.
8. Click **Save**.

## Default Value

By default, Cosmos DBs are set to have access all networks.

## References

1. [https://docs.microsoft.com/en-us/azure/cosmos-db/how-to-configure-private-endpoints](https://docs.microsoft.com/en-us/azure/cosmos-db/how-to-configure-private-endpoints)
2. [https://docs.microsoft.com/en-us/azure/cosmos-db/how-to-configure-vnet-service-endpoint](https://docs.microsoft.com/en-us/azure/cosmos-db/how-to-configure-vnet-service-endpoint)
3. [https://docs.microsoft.com/en-us/cli/azure/cosmosdb?view=azure-cli-latest#az-cosmosdb-show](https://docs.microsoft.com/en-us/cli/azure/cosmosdb?view=azure-cli-latest#az-cosmosdb-show)
4. [https://docs.microsoft.com/en-us/cli/azure/cosmosdb/database?view=azure-cli-latest#az-cosmosdb-database-list](https://docs.microsoft.com/en-us/cli/azure/cosmosdb/database?view=azure-cli-latest#az-cosmosdb-database-list)
5. [https://docs.microsoft.com/en-us/powershell/module/az.cosmosdb/?view=azps-8.1.0](https://docs.microsoft.com/en-us/powershell/module/az.cosmosdb/?view=azps-8.1.0)
6. [https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls](https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.4 Implement and Manage a Firewall on Servers | X | X | X |
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | X | X |
| v7 | 9.4 Apply Host-based Firewalls or Port Filtering | X | X | X |
| v7 | 14.1 Segment the Network Based on Sensitivity | | X | X |
