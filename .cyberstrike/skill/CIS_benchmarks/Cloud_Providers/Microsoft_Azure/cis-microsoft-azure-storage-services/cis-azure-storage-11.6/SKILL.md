---
name: cis-azure-storage-11.6
description: "Ensure locked immutability policies are used for containers storing business-critical blob data"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, blob-storage, immutability]
cis_id: "11.6"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 11.6 Ensure locked immutability policies are used for containers storing business-critical blob data (Automated)

## Description

Require locked immutability policies for all containers that store business-critical blob data. This measure protects the data from modifications or deletions, ensuring that critical information remains intact and unaltered, regardless of user actions or access permissions.

## Rationale

Implementing a locked immutability policy creates a Write Once, Read Many (WORM) storage model that safeguards critical data from accidental or malicious changes and deletions. Enforcing immutability minimizes data loss and tampering risks, enhancing data security and supporting regulatory requirements for data retention and integrity.

## Impact

Enforcing locked immutability policies for blob storage may increase long-term retention costs and require additional administrative effort for policy management.

Once the policy is locked, the container cannot be deleted or edited, and the storage account cannot be deleted until the retention period has elapsed.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage accounts`.
2. Click the name of a storage account.
3. Under `Data storage`, click `Containers`.
4. Click the three dots next to a container.
5. Click `Access policy`.
6. Ensure a locked policy is listed under `Immutable blob storage`.
7. Repeat steps 1-6 for each blob container with business-critical blob data.

### Audit from Azure CLI

Run the following command to list storage accounts:

```bash
az storage account list
```

Run the following command to determine if a storage account has containers:

```bash
az storage container list --account-name <storage-account>
```

For each container, run the following command to view immutability policies:

```bash
az storage container immutability-policy show --account-name <storage-account> --container <blob-container>
```

Ensure that an immutability policy is listed with `"state": "Locked"` for each blob container with business-critical blob data.

## Expected Result

An immutability policy with `"state": "Locked"` exists for each blob container storing business-critical data.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage accounts`.
2. Click the name of a storage account.
3. Under `Data storage`, click `Containers`.
4. Click the three dots next to a container.
5. Click `Access policy`.
6. Under `Immutable blob storage`, click `+ Add policy`.
7. From the `Policy type` drop-down, select `Legal hold` or `Time-based retention`.
8. If selecting legal hold:
   1. Provide at least one tag for the policy.
   2. Under `Allow protected append writes to`, select `None` or `Block and append blobs`.
9. If selecting time-based retention:
   1. Under `Set retention period for`, enter a number of days for retention.
   2. Check the box next to `Enable version-level immutability` if appropriate. Versioning must be enabled for this option to be available.
   3. Under `Allow protected append writes to`, select `None`, `Append blobs`, or `Block and append blobs`.
10. Click `Save`.
11. Click the three dots next to the policy.
12. Click `Lock policy`.
13. Enter `yes` to confirm.
14. Click `OK`.
15. Repeat steps 1-14 for each blob container requiring remediation.

## Default Value

By default, no immutability policies are configured on blob containers.

## References

1. https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview
2. https://learn.microsoft.com/en-us/cli/azure/storage/container/immutability-policy

## Profile

Level 2 | Automated
