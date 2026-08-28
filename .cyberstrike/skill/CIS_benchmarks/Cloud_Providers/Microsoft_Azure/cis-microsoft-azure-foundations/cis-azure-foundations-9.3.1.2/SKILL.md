---
name: cis-azure-foundations-9.3.1.2
description: "Ensure Storage Account access keys are periodically regenerated"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, storage-accounts, access-keys, key-rotation, secrets]
cis_id: "9.3.1.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Storage Account access keys are periodically regenerated

## Description

For increased security, regenerate storage account access keys periodically.

## Rationale

When a storage account is created, Azure generates two 512-bit storage access keys which are used for authentication when the storage account is accessed. Rotating these keys periodically ensures that any inadvertent access or exposure does not result from the compromise of these keys.

Cryptographic key rotation periods will vary depending on your organization's security requirements and the type of data which is being stored in the Storage Account. For example, PCI DSS mandates that cryptographic keys be replaced or rotated 'regularly,' and advises that keys for static data stores be rotated every 'few months.'

For the purposes of this recommendation, 90 days will be prescribed for the reminder. Review and adjustment of the 90 day period is recommended, and may even be necessary. Your organization's security requirements should dictate the appropriate setting.

## Impact

Regenerating access keys can affect services in Azure as well as the organization's applications that are dependent on the storage account. All clients who use the access key to access the storage account must be updated to use the new key.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each Storage Account, under `Security + networking`, go to `Access keys`.
3. Review the date and days in the `Last rotated` field for **each** key.

If the `Last rotated` field indicates a number or days greater than 90 [or greater than your organization's period of validity], the key should be rotated.

### Audit from Azure CLI

1. Get a list of storage accounts:

```bash
az storage account list --subscription <subscription-id>
```

Make a note of `id`, `name` and `resourceGroup`.

2. For every storage account make sure that key is regenerated in the past 90 days:

```bash
az monitor activity-log list --namespace Microsoft.Storage --offset 90d --query "[?contains(authorization.action, 'regenerateKey')]" --resource-id <resource id>
```

The output should contain:

```
"authorization"/"scope": <your_storage_account> AND "authorization"/"action": "Microsoft.Storage/storageAccounts/regeneratekey/action" AND "status"/"localizedValue": "Succeeded" "status"/"Value": "Succeeded"
```

## Expected Result

Both access keys should have been rotated within the last 90 days (or within your organization's required rotation period).

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each Storage Account with outdated keys, under `Security + networking`, go to `Access keys`.
3. Click `Rotate key` next to the outdated key, then click `Yes` to the prompt confirming that you want to regenerate the access key.

After Azure regenerates the Access Key, you can confirm that `Access keys` reflects a `Last rotated` date of `(0 days ago)`.

## Default Value

By default, access keys are not regenerated periodically.

## References

1. https://learn.microsoft.com/en-us/azure/storage/common/storage-account-keys-manage
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-1-separate-and-limit-highly-privilegedadministrative-users
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-2-protect-identity-and-authentication-systems
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy
5. https://www.pcidssguide.com/pci-dss-key-rotation-requirements/
6. https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-57pt1r5.pdf

## Profile

Level 1
