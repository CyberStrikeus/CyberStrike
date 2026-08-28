---
name: cis-azure-storage-2.1.1.1
description: "Ensure 'Allowed Protocols' for shared access signature (SAS) tokens is set to 'HTTPS Only'"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, sas, encryption, keys]
cis_id: "2.1.1.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1.1 Ensure 'Allowed Protocols' for shared access signature (SAS) tokens is set to 'HTTPS Only' (Manual)

## Description

Shared access signatures (SAS) can be used to grant limited access to Azure Storage resources. When generating a SAS, it is possible to specify the allowed protocols for a request made with the SAS. It is recommended to allow requests over HTTPS only.

## Rationale

If a SAS is passed over HTTP and intercepted, an attacker performing a man-in-the-middle attack can read the SAS. Then, they can use that SAS just as the intended user could have. This can potentially compromise sensitive data or allow for data corruption by the malicious user.

## Impact

SAS can pose security risks if they are not managed carefully.

## Audit Procedure

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies:

- Azure Blob Storage
- Queue Storage
- Storage Accounts > Secrets and Keys

## Expected Result

When generating a SAS token, the `Allowed protocols` field should be set to `HTTPS only`.

## Remediation

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies:

- Azure Blob Storage
- Queue Storage
- Storage Accounts > Secrets and Keys

## Default Value

When generating a SAS, the default selection for `Allowed protocols` is `HTTPS only`.

## References

1. https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview
2. https://learn.microsoft.com/en-us/azure/storage/common/storage-account-keys-manage

## Additional Information

This recommendation forms the basis for the recommendations with the same title in the following sections:

- Azure Blob Storage
- Queue Storage
- Storage Accounts > Secrets and Keys
- Storage Explorer

## CIS Controls

| Controls Version | Control                                                                                                                                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit - Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH). |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit - Encrypt all sensitive information in transit.                                                                                |      | x    | x    |

## Profile

Level 1 | Manual
