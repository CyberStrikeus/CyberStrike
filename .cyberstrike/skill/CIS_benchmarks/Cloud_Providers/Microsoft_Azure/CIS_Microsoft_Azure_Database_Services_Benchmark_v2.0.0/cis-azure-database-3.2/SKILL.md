---
name: cis-azure-database-3.2
description: "Ensure that Cosmos DB uses Private Endpoints where possible"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, cosmos-db, nosql]
cis_id: "3.2"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2 Ensure that Cosmos DB uses Private Endpoints where possible (Automated)

## Profile Applicability

- Level 2

## Description

Private endpoints limit network traffic to approved sources.

## Rationale

For sensitive data, private endpoints allow granular control of which services can communicate with Cosmos DB and ensure that this network traffic is private. This can be set this up on a case by case basis for each service to be connected.

## Impact

Only whitelisted services will have access to communicate with the Cosmos DB.

## Audit Procedure

### Audit From Azure Portal

1. Open the portal menu.
2. Select the Azure Cosmos DB blade.
3. Select the Azure Cosmos DB account.
4. Select **Networking**.
5. Ensure `Public network access` is set to `Selected networks`.
6. Ensure the listed networks are set appropriately.
7. Select **Private access**.
8. Ensure a private endpoint exists and `Connection state` is **Approved**.

### Audit From Azure Policy

- **Policy ID:** `58440f8a-10c5-4151-bdce-dfbaad4a20b7` - **Name:** 'CosmosDB accounts should use private link'

## Expected Result

A private endpoint should exist with `Connection state` set to **Approved**, and `Public network access` should be set to `Selected networks`.

## Remediation

### Remediate From Azure Portal

1. Open the portal menu.
2. Select the Azure Cosmos DB blade.
3. Select the Azure Cosmos DB account.
4. Select **Networking**.
5. Select **Private access**.
6. Click `+ Private Endpoint`.
7. Provide a Name.
8. Click **Next**.
9. From the Resource type drop down, select `Microsoft.AzureCosmosDB/databaseAccounts`.
10. From the Resource drop down, select the Cosmos DB account.
11. Click **Next**.
12. Provide appropriate Virtual Network details.
13. Click **Next**.
14. Provide appropriate DNS details.
15. Click **Next**.
16. Optionally provide Tags.
17. Click `Next : Review + create`.
18. Click **Create**.

## Default Value

By default Cosmos DB does not have private endpoints enabled and its traffic is public to the network.

## References

1. [https://docs.microsoft.com/en-us/azure/cosmos-db/how-to-configure-private-endpoints](https://docs.microsoft.com/en-us/azure/cosmos-db/how-to-configure-private-endpoints)
2. [https://docs.microsoft.com/en-us/azure/private-link/tutorial-private-endpoint-cosmosdb-portal](https://docs.microsoft.com/en-us/azure/private-link/tutorial-private-endpoint-cosmosdb-portal)
3. [https://docs.microsoft.com/en-us/cli/azure/cosmosdb/private-endpoint-connection?view=azure-cli-latest](https://docs.microsoft.com/en-us/cli/azure/cosmosdb/private-endpoint-connection?view=azure-cli-latest)
4. [https://docs.microsoft.com/en-us/cli/azure/network/private-endpoint?view=azure-cli-latest#az-network-private-endpoint-create](https://docs.microsoft.com/en-us/cli/azure/network/private-endpoint?view=azure-cli-latest#az-network-private-endpoint-create)
5. [https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls](https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls)

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture |      | X    | X    |
| v7               | 14.1 Segment the Network Based on Sensitivity             |      | X    | X    |
