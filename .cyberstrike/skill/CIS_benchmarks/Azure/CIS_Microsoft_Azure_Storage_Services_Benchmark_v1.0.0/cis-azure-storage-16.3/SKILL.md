---
name: cis-azure-storage-16.3
description: "Ensure stored access policies (SAP) are used when generating shared access signature (SAS) tokens"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, queue-storage, sas]
cis_id: "16.3"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 16.3 Ensure stored access policies (SAP) are used when generating shared access signature (SAS) tokens (Manual)

## Description

Use stored access policies (SAP) when generating shared access signature (SAS) tokens in Azure to centrally manage permissions, expiration, and revocation settings for resource access. Stored access policies can be applied to blob containers, file shares, queues, and tables.

## Rationale

Stored access policies provide centralized control over SAS token access, allowing administrators to update permissions or revoke access. This approach strengthens security by reducing the risk of unauthorized access to storage resources.

## Impact

There is no cost for creating stored access policies, however there is some administrative overhead involved in managing these policies.

## Audit Procedure

It is not currently possible to retrieve a list of all generated SAS tokens to check if they were associated with a SAP during creation.

An SAS token that has been created with a SAP will contain an `si` parameter that references the stored access policy identifier associated with the SAS, e.g. `si=<stored-access-policy-identifier>`.

The `si` parameter will be absent from an SAS token created without a SAP.

## Expected Result

All shared access signature (SAS) tokens should contain the `si` parameter referencing a stored access policy identifier. SAS tokens without the `si` parameter indicate they were created without a stored access policy, which is non-compliant.

## Remediation

### Remediate from Azure Portal

To create a SAP for a queue:

1. Go to `Storage accounts`.
2. Click on a storage account.
3. Under `Data storage`, click `Queues`.
4. Click the name of a queue.
5. Under `Settings`, click `Access policy`.
6. Under `Stored access policies`, click `+ Add policy`.
7. Enter an `Identifier`.
8. From the `Permissions` drop-down, select appropriate permissions for the policy.
9. Set an appropriate `Start time` for the policy.
10. Set an appropriate `Expiry time` for the policy.
11. Click `OK`.
12. Click `Save`.
13. Repeat steps 1-12 as needed to create SAP.

When generating SAS, select a SAP from the `Stored access policy` drop-down.

If SAS have been created without a SAP, the SAS can be revoked by regenerating the storage account access keys:

Note: Regenerating access keys can affect any applications or Azure services that are dependent on the storage account key.

1. Go to `Storage accounts`.
2. Click on a storage account.
3. Under `Security + networking`, click `Access keys`.
4. Next to each key, click `Rotate key`.
5. Click `Yes` to confirm.
6. Repeat steps 1-5 as needed to revoke SAS.

## Default Value

By default, stored access policies are not associated with SAS. To use a stored access policy, it must be explicitly created and linked to the SAS at the time of creation.

## References

1. https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview#best-practices-when-using-sas
2. https://learn.microsoft.com/en-us/rest/api/storageservices/define-stored-access-policy

## Additional Information

This recommendation is based on the recommendation `Ensure stored access policies (SAP) are used when generating shared access signature (SAS) tokens`, from the `Common Reference Recommendations > Secrets and Keys > Shared Access Signatures` section.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | **3.3 Configure Data Access Control Lists** - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | X | X | X |
| v7 | **14.6 Protect Information through Access Control Lists** - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | X | X | X |

## Profile

Level 1 | Manual
