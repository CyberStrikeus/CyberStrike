---
name: cis-azure-database-6.1
description: "Ensure Azure Database for PostgreSQL uses Customer Managed Keys for Encryption at Rest"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, postgresql, database]
cis_id: "6.1"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1 Ensure Azure Database for PostgreSQL uses Customer Managed Keys for Encryption at Rest (Manual)

## Profile Applicability

- Level 2

## Description

Enable sensitive data encryption at rest using Customer Managed Keys (CMK) rather than Microsoft Managed keys (MMK).

## Rationale

By default, data in Azure Database for PostgreSQL is encrypted using Microsoft Service Managed Keys ('SMK' or 'MMK') which constitutes an implied trust. If an organization wishes to control and manage encryption keys, however, customer-managed keys (CMK) can be supplied. The provided key is used to protect and control access to the key that encrypts the data. You can also choose to automatically update the key version used for Azure Database for MySQL encryption whenever a new version is available in the associated Key Vault.

**NOTE:** This is primarily recommended where control of encryption keys is specified by compliance or security framework requirements. In many circumstances, Microsoft Managed Key encryption is an acceptable method of accomplishing encryption at rest.

## Impact

If the key expires by setting the 'activation date' and 'expiration date', the user must rotate the key manually.

Using Customer Managed Keys may also incur additional man-hour requirements to create, store, manage, and protect the keys as needed.

## Audit Procedure

### Audit from Azure Portal

1. From `Azure Database for PostgreSQL` select the server you wish to audit.
2. In the left column expand `> Security`.
3. Select `Data Encryption`.
4. Determine if `Customer-managed key` is selected.

### Audit from Azure Policy

Policy ID: `12c74c95-0efd-48da-b8d9-2a7d68470c92`
Name: 'PostgreSQL flexible servers should use customer-managed keys to encrypt data at rest'

## Expected Result

`Customer-managed key` should be selected for data encryption.

## Remediation

### Remediate from Azure Portal

1. From `Azure Database for PostgreSQL` select the server you wish to audit.
2. In the left column expand `> Security`.
3. Select `Data Encryption`.
4. Select `Customer-managed key`.
5. In the window that opens, use a `User assigned managed identity` by either creating or selecting one.
6. Choose a key selection method. For `Enter a key identifier`, enter the URL for the key in Azure Key vault. For `Select a key`, navigate through the menu and choose the location of your key store by subscription, and whether it is a key vault or managed HSM.
7. Once a key is chosen, select `Save`. Verify on the next window that your changes have taken effect.

## Default Value

Unless selected at resource creation, by default Azure Database for PostgreSQL uses Microsoft Managed Keys.

## References

1. https://learn.microsoft.com/en-us/azure/postgresql/security/security-data-encryption

## Profile

- Level 2
