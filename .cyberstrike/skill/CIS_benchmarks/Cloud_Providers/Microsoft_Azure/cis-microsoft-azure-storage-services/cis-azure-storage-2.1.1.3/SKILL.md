---
name: cis-azure-storage-2.1.1.3
description: "Ensure stored access policies (SAP) are used when generating shared access signature (SAS) tokens"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, sas, encryption, keys]
cis_id: "2.1.1.3"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1.3 Ensure stored access policies (SAP) are used when generating shared access signature (SAS) tokens (Manual)

## Description

Use stored access policies (SAP) when generating shared access signature (SAS) tokens in Azure to centrally manage permissions, expiration, and revocation settings for resource access. Stored access policies can be applied to blob containers, file shares, queues, and tables.

## Rationale

Stored access policies provide centralized control over SAS token access, allowing administrators to update permissions or revoke access. This approach strengthens security by reducing the risk of unauthorized access to storage resources.

## Impact

There is no cost for creating stored access policies, however there is some administrative overhead involved in managing these policies.

## Audit Procedure

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies:

- Azure Blob Storage
- Queue Storage
- Storage Explorer

## Expected Result

SAS tokens should be associated with a stored access policy (SAP) rather than being created with ad-hoc permissions.

## Remediation

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies:

- Azure Blob Storage
- Queue Storage
- Storage Explorer

## Default Value

By default, stored access policies are not associated with SAS. To use a stored access policy, it must be explicitly created and linked to the SAS at the time of creation.

## References

1. https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview#best-practices-when-using-sas
2. https://learn.microsoft.com/en-us/rest/api/storageservices/define-stored-access-policy

## Additional Information

This recommendation forms the basis for the recommendations with the same title in the following sections:

- Azure Blob Storage
- Queue Storage
- Storage Explorer

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 6.2 Establish an Access Revoking Process - Establish and follow a process, preferably automated, for revoking access to enterprise assets, through disabling accounts immediately upon termination, rights revocation, or role change of a user. Disabling accounts, instead of deleting accounts, may be necessary to preserve audit trails.                                                          | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | x    | x    | x    |

## Profile

Level 1 | Manual
