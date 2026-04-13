---
name: cis-azure-storage-17.1.2
description: "Ensure 'Allowed Protocols' for shared access signature (SAS) tokens is set to 'HTTPS Only'"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, sas, encryption]
cis_id: "17.1.2"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.1.2 Ensure 'Allowed Protocols' for shared access signature (SAS) tokens is set to 'HTTPS Only' (Manual)

## Description

Shared access signatures (SAS) can be used to grant limited access to Azure Storage resources. When generating a SAS, it is possible to specify the allowed protocols for a request made with the SAS. It is recommended to allow requests over HTTPS only.

## Rationale

If a SAS is passed over HTTP and intercepted, an attacker performing a man-in-the-middle attack can read the SAS. Then, they can use that SAS just as the intended user could have. This can potentially compromise sensitive data or allow for data corruption by the malicious user.

## Impact

SAS can pose security risks if they are not managed carefully.

## Audit Procedure

It is not possible to audit generated SAS tokens, but Azure Policy can be used to generally audit the existence of configured SAS policy.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure. If referencing a printed copy, you can search Policy IDs from this URL: https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `bc1b984e-ddae-40cc-801a-050a030e4fbe`
- Name: 'Storage accounts should have shared access signature (SAS) policies configured'

## Expected Result

All SAS tokens are generated with `Allowed protocols` set to `HTTPS only`. The Azure Policy 'Storage accounts should have shared access signature (SAS) policies configured' shows compliant for all storage accounts.

## Remediation

### Remediate from Azure Portal

If SAS have been created to allow HTTP and were created with a stored access policy (SAP), the SAS can be revoked by deleting the SAP or updating the SAP expiration time to a time in the past:

1. Go to `Storage accounts`
2. Click on a storage account.
3. Under `Data storage`, click `Containers`, `File shares`, `Queues`, or `Tables`.
4. Click the three dots next to a listed item.
5. Click `Access policy`.
6. Click the three dots next to an access policy.
7. Click `Delete`.
8. Click `Save`.
9. Repeat steps 1-8 as needed to revoke SAS created with SAP.

If SAS have been created to allow HTTP and were not created with a SAP, the SAS can be revoked by regenerating the storage account access keys:

Note: Regenerating access keys can affect any applications or Azure services that are dependent on the storage account key.

1. Go to `Storage accounts`.
2. Click on a storage account.
3. Under `Security + networking`, click `Access keys`.
4. Next to each key, click `Rotate key`.
5. Click `Yes` to confirm.
6. Repeat steps 1-5 as needed to revoke SAS.

## Default Value

When generating a SAS, the default selection for `Allowed protocols` is `HTTPS only`.

## References

1. https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview
2. https://learn.microsoft.com/en-us/azure/storage/common/storage-account-keys-manage

## Additional Information

This recommendation is based on the recommendation `Ensure 'Allowed Protocols' for shared access signature (SAS) tokens is set to 'HTTPS Only'`, from the `Common Reference Recommendations > Secrets and Keys > Shared Access Signatures` section.

## Profile

Level 1 | Manual
