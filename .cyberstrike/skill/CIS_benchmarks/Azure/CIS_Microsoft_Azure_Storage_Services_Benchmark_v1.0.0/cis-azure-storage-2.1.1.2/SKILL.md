---
name: cis-azure-storage-2.1.1.2
description: "Ensure that shared access signature (SAS) tokens expire within an hour"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, sas, encryption, keys]
cis_id: "2.1.1.2"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1.2 Ensure that shared access signature (SAS) tokens expire within an hour (Manual)

## Description

Shared access signature (SAS) tokens provide restricted access to Azure Storage resources (such as blobs, files, queues, or tables) for a defined time period with specific permissions. It enables users to interact with the resources without exposing account keys, offering precise control over the permitted actions (e.g., read, write) and the duration of access. To minimize security risks, SAS tokens should be configured with the shortest possible lifespan, ideally lasting no longer than an hour.

## Rationale

A short lifespan for SAS tokens is recommended to minimize the risk of unauthorized access. SAS tokens grant time-limited access to resources, and a longer duration increases the opportunity for misuse if the token is compromised. By setting a shorter lifespan, the potential for security breaches is reduced.

## Impact

SAS can pose security risks if they are not managed carefully.

## Audit Procedure

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies:

- Azure Blob Storage
- Queue Storage
- Storage Accounts > Secrets and Keys
- Storage Explorer

## Expected Result

SAS tokens should have an expiration time of no more than 1 hour from creation.

## Remediation

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies:

- Azure Blob Storage
- Queue Storage
- Storage Accounts > Secrets and Keys
- Storage Explorer

## Default Value

By default, expiration for shared access signature is set to 8 hours.

## References

1. https://docs.microsoft.com/en-us/azure/storage/common/storage-sas-overview
2. https://docs.microsoft.com/en-us/rest/api/storageservices/delegating-access-with-a-shared-access-signature

## Additional Information

This recommendation forms the basis for the recommendations with the same title in the following sections:

- Azure Blob Storage
- Queue Storage
- Storage Accounts > Secrets and Keys
- Storage Explorer

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.2 Establish an Access Revoking Process - Establish and follow a process, preferably automated, for revoking access to enterprise assets, through disabling accounts immediately upon termination, rights revocation, or role change of a user. Disabling accounts, instead of deleting accounts, may be necessary to preserve audit trails. | x | x | x |
| v7 | 16.7 Establish Process for Revoking Access - Establish and follow an automated process for revoking system access by disabling accounts immediately upon termination or change of responsibilities of an employee or contractor. Disabling these accounts, instead of deleting accounts, allows preservation of audit trails. | | x | x |

## Profile

Level 1 | Manual
