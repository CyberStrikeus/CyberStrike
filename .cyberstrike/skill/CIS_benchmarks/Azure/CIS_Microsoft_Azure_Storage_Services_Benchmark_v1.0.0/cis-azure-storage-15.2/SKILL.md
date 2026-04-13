---
name: cis-azure-storage-15.2
description: "Ensure customer-managed keys (CMK) are used to encrypt data at rest on Azure Elastic SAN volume groups"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, elastic-san, encryption, cmk]
cis_id: "15.2"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 15.2 Ensure customer-managed keys (CMK) are used to encrypt data at rest on Azure Elastic SAN volume groups (Automated)

## Description

Azure Elastic SAN volume groups offer two encryption options: Microsoft-managed keys, which provide automatic encryption without user intervention, and customer-managed keys (CMK), which allow organizations to retain full control over their encryption keys for enhanced security and compliance.

## Rationale

Using customer-managed keys (CMKs) to encrypt Azure Elastic SAN volume groups enhances security by granting organizations complete control over their encryption keys.

## Impact

There are costs and configuration overhead associated with setting up and managing customer-managed keys.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Elastic SANs`.
2. Click the name of an Elastic SAN.
3. Under `SAN Management`, click `Volume groups`.
4. For each volume group, ensure that the value in the `Encryption type` column is not `Platform-managed key`.

### Audit from Azure CLI

Run the following command to list Elastic SANs:

```bash
az elastic-san list
```

For each Elastic SAN with a `volumeGroupCount` greater than 0, run the following command to list volume groups:

```bash
az elastic-san volume-group list --resource-group <resource-group> --elastic-san <elastic-san>
```

Ensure that for each volume group, `encryption` is set to `EncryptionAtRestWithCustomerManagedKey`.

### Audit from PowerShell

Run the following command to list Elastic SANs:

```powershell
Get-AzElasticSan
```

For each Elastic SAN with a `VolumeGroupCount` greater than 0, run the following command to list volume groups:

```powershell
Get-AzElasticSanVolumeGroup -ResourceGroupName <resource-group> -ElasticSanName <elastic-san>
```

Ensure that for each volume group, `Encryption` is set to `EncryptionAtRestWithCustomerManagedKey`.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.
If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `7698f4ed-80ce-4e13-b408-ee135fa400a5`
- Name: 'ElasticSan Volume Group should use customer-managed keys to encrypt data at rest'

## Expected Result

For each volume group in every Elastic SAN, the `encryption` (CLI) or `Encryption` (PowerShell) property should be set to `EncryptionAtRestWithCustomerManagedKey`. In the Azure Portal, the `Encryption type` column should not show `Platform-managed key`.

## Remediation

### Remediate from Azure Portal

It is not currently possible to remediate from Azure Portal. Refer to the Remediate from Azure CLI and Remediate from PowerShell sections for remediation options.

### Remediate from Azure CLI

For each volume group requiring remediation, run the following command to assign an identity:

```bash
az elastic-san volume-group update --resource-group <resource-group> --elastic-san <elastic-san> --volume-group <volume-group> --identity "{type:SystemAssigned}"
```

Note: Use `--identity '{type:UserAssigned,user-assigned-identity:"<user-assigned-identity-id>"}'` with the above command to provide a UserAssigned Identity Id.

For each volume group requiring remediation, run the following command to assign a customer-managed encryption key:

```bash
az elastic-san volume-group update --resource-group <resource-group> --elastic-san <elastic-san> --volume-group <volume-group> --encryption EncryptionAtRestWithCustomerManagedKey --encryption-properties "{key-vault-properties:{key-name:'<key>',key-vault-uri:'<key-vault-uri>'}}"
```

### Remediate from PowerShell

For each volume group requiring remediation, run the following command to assign an identity:

```powershell
Update-AzElasticSanVolumeGroup -ResourceGroupName <resource-group> -ElasticSanName <elastic-san> -VolumeGroupName <volume-group> -IdentityType SystemAssigned
```

Note: Use `-IdentityType UserAssigned -IdentityUserAssignedIdentityId <user-assigned-identity-id>` with the above command to provide a UserAssigned Identity Id.

For each volume group requiring remediation, run the following command to assign a customer-managed encryption key:

```powershell
Update-AzElasticSanVolumeGroup -ResourceGroupName <resource-group> -ElasticSanName <elastic-san> -VolumeGroupName <volume-group> -Encryption EncryptionAtRestWithCustomerManagedKey -KeyName <key> -KeyVaultUri <key-vault-uri>
```

## Default Value

By default, Azure Elastic SAN volume groups are encrypted using Microsoft-managed keys.

## References

1. https://learn.microsoft.com/en-us/azure/storage/elastic-san/elastic-san-configure-customer-managed-keys
2. https://learn.microsoft.com/en-us/cli/azure/elastic-san/volume-group
3. https://learn.microsoft.com/en-us/powershell/module/az.elasticsan/get-azelasticsanvolumegroup
4. https://learn.microsoft.com/en-us/powershell/module/az.elasticsan/update-azelasticsanvolumegroup
5. https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/how-manage-user-assigned-managed-identities

## Additional Information

- To enable encryption, it is necessary to grant the volume group the appropriate permissions to access the encryption key in the key vault. The key can be modified as needed. Refer to the following guide for details: https://learn.microsoft.com/en-us/azure/storage/elastic-san/elastic-san-configure-customer-managed-keys?#configure-the-key-vault.
- Azure Elastic SAN uses system-assigned managed identities and user-assigned managed identities to authenticate the volume groups to access encryption keys stored in Azure Key Vault. Refer to the following guide for details: https://learn.microsoft.com/en-us/azure/storage/elastic-san/elastic-san-configure-customer-managed-keys#choose-a-managed-identity-to-authorize-access-to-the-key-vault.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | **3.11 Encrypt Sensitive Data at Rest** - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. | | X | X |
| v7 | **14.8 Encrypt Sensitive Information at Rest** - Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system, in order to access the information. | | | X |

## Profile

Level 2 | Automated
