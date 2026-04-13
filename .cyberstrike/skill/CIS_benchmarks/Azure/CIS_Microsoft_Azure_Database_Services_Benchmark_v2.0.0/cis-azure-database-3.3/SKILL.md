---
name: cis-azure-database-3.3
description: "Ensure that 'disableLocalAuth' is set to 'true'"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, cosmos-db, nosql]
cis_id: "3.3"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3 Ensure that 'disableLocalAuth' is set to 'true' (Automated)

## Profile Applicability

- Level 1

## Description

Ensure that key-based authentication (including resource owner password credential authentication) is disabled for Azure Cosmos DB accounts by setting `disableLocalAuth` to `true`. Instead, use Microsoft Entra ID for authentication, as it provides stronger security through managed credentials, multi-factor authentication (MFA), centralized access control, and seamless integration with Azure RBAC.

## Rationale

Disabling key-based authorization ensures that access to your Azure Cosmos DB account relies on the more secure Microsoft Entra ID authentication, reducing the risk of credential misuse and unauthorized access.

## Impact

Administrative overhead in configuring, managing, and monitoring Entra ID authentication and role-based access.

## Audit Procedure

### Audit from Azure CLI

Run the following command to get the `disableLocalAuth` setting for each Cosmos DB account:

```bash
az cosmosdb list --query "[].{name:name, resourceGroup:resourceGroup, disableLocalAuth:disableLocalAuth}"
```

Ensure that `disableLocalAuth` is set to `true` for each Cosmos DB account.

### Audit from PowerShell

Run the following command to list Cosmos DB accounts in a resource group:

```powershell
Get-AzCosmosDBAccount -ResourceGroupName <resource-group>
```

Run the following command to get the Cosmos DB account in a resource group with a given name:

```powershell
$cosmosdb = Get-AzResource -ResourceType Microsoft.DocumentDB/databaseAccounts -ResourceGroupName <resource-group> -ResourceName <cosmosdb-account>
```

Run the following command to get the `disableLocalAuth` setting for the Cosmos DB account:

```powershell
$cosmosdb.Properties.disableLocalAuth
```

Ensure that the command returns `True`.

Repeat for each Cosmos DB account.

### Audit from Azure Policy

- **Policy ID:** `5450f5bd-9c72-4390-a9c4-a7aba4edfdd2` - **Name:** 'Cosmos DB database accounts should have local authentication methods disabled'

## Expected Result

`disableLocalAuth` should be set to `true` for each Cosmos DB account.

## Remediation

Map all the resources that currently have access to the Azure Cosmos DB account with keys or access tokens.

Create an Entra ID identity for each of these resources:

- For Azure resources, you can create a managed identity. You may choose between system-assigned and user-assigned managed identities.
- For non-Azure resources, create Entra ID service principals. Grant each Entra ID service principal the minimum permissions it requires. We recommend using one of the two built-in role definitions: Cosmos DB Built-in Data Reader or Cosmos DB Built-in Data Contributor. Validate that the new resource is functioning correctly. After new permissions are granted to identities, it may take a few hours for them to propagate.

When all resources work correctly with the new identities, continue to the next step.

### Remediate from Azure CLI

For each Cosmos DB account requiring remediation, run the following command to set `disableLocalAuth` to `true`:

```bash
az resource update --resource-group <resource-group> --name <cosmosdb-account> --resource-type Microsoft.DocumentDB/databaseAccounts --set properties.disableLocalAuth=true
```

### Remediate from PowerShell

For each Cosmos DB account requiring remediation, run the following commands to set `disableLocalAuth` to `True`:

```powershell
$cosmosdb = Get-AzResource -ResourceType Microsoft.DocumentDB/databaseAccounts -ResourceGroupName <resource-group> -ResourceName <cosmosdb-account>
$cosmosdb.Properties.disableLocalAuth = "True"
$cosmosdb | Set-AzResource -Force
```

## Default Value

By default, `disableLocalAuth` is set to `false`.

## References

1. [https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/security/how-to-disable-key-based-authentication](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/security/how-to-disable-key-based-authentication)
2. [https://learn.microsoft.com/en-us/azure/cosmos-db/role-based-access-control](https://learn.microsoft.com/en-us/azure/cosmos-db/role-based-access-control)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.7 Centralize Access Control | | X | X |
| v7 | 16.2 Configure Centralized Point of Authentication | | X | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1190 | | |
