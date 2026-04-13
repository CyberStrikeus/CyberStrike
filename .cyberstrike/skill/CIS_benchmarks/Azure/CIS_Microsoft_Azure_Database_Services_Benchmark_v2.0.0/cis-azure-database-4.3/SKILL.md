---
name: cis-azure-database-4.3
description: "Ensure that Data Factory is using Azure Key Vault to store Credentials and Secrets"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, data-factory, adf]
cis_id: "4.3"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.3 Ensure that Data Factory is using Azure Key Vault to store Credentials and Secrets (Manual)

## Profile Applicability

- Level 2

## Description

Azure Key Vault is a way to securely store secrets and keys, and create role based access control permissions to services and users to access them.

## Rationale

Use of Azure Key Vault is greatly recommended over less secure options like hard coding credentials into code.

## Impact

This will create technical overhead as your organization will need to manage the lifecycle, expiration, and rotation of secrets and keys to fit your security baseline.

## Audit

### Audit from Azure Portal

1. From `Data Factories` select a factory to audit.
2. Under the `Overview` selection scroll down in the right pane and select `Launch studio` under `Azure Data Factory Studio`.
3. In the left column select the briefcase and wrench for `Manage`.
4. In the left column select `Linked Services` under `Connections`.
5. Browse the linked services to determine if there is a connection to an Azure key vault. It has a circle icon with a key in it.

### Audit From Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.

If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- **Policy ID:** `127ef6d7-242f-43b3-9eef-947faf1725d0` - **Name:** 'Azure Data Factory linked services should use Key Vault for storing secrets'

## Expected Result

A linked service connection to an Azure Key Vault should be present under Manage > Linked Services > Connections in Azure Data Factory Studio.

## Remediation

### Remediate from Azure Portal

#### Retrieve Managed Identity Object ID

1. From `Azure Data Factories` select a factory to link to an Azure Key Vault.
2. In the left column, expand `> Settings` and select `Properties`.
3. Select `Managed Identity Object ID` and save this code for later.

#### Set Permissions for Key Vault

*Note* this presumes the use of RBAC Access control, not Access policies.

1. From `Key vaults` select a key vault to grant access to.
2. Select `+ Add`, and select `Add role assignment` from the dropdown.
3. For the `Role`, search for `key vault`. Listed are various permissions to be assigned. Determine your organization's permission need, but `Key Vault Reader` is satisfactory for basic key and secrets access.
4. Select `Next`.
5. In the new screen, next to `Assign access to`, select Managed identity.
6. Next to Members select `+ Select members`.
7. Choose your subscription, and either under `Managed identity` scroll to `Data Factory` and select it, or search by your Data Factory's name.
8. Select your Data Factory.
9. Choose `Select`.
10. Select `Review + assign`.

#### Create Connection Between Key Vault and Data Factory

1. From `Data Factories` select your data factory.
2. Under the `Overview` selection scroll down in the right pane and select `Launch studio` under `Azure Data Factory Studio`.
3. In the left column select the briefcase and wrench for `Manage`.
4. In the left column select `Linked Services` under `Connections`.
5. Select `+ New`.
6. Search for `Azure Key Vault` and select it.
7. In the new window, name your connection and enter a desired description.
8. Under `Azure key vault selection method`, choose `From Azure Subscription`.
9. Select your Azure Subscription.
10. Select your key vault by name.
11. Under `Authentication Method` select `System-assigned managed identity` or `User-assigned managed identity` depending on what managed identity is in use on your data factory.
12. Select `Create`.

## Default Value

By default Azure Data Factories do not use Azure Key Vault to store credentials or secrets.

## References

1. https://learn.microsoft.com/en-us/azure/data-factory/store-credentials-in-key-vault
2. https://learn.microsoft.com/en-us/azure/data-factory/data-factory-service-identity#retrieve-managed-identity
