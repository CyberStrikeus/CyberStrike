---
name: cis-azure-storage-2.2.1.1
description: "Ensure public network access is Disabled"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, networking, private-endpoints, vnet]
cis_id: "2.2.1.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.1.1 Ensure public network access is Disabled (Automated)

## Description

Disable public network access to prevent exposure to the internet and reduce the risk of unauthorized access. Use private endpoints and Azure Role-Based Access Control (RBAC) to securely manage access within trusted networks.

## Rationale

Disabling public network access improves security by ensuring that a service is not exposed on the public internet.

## Impact

Disabling public network access restricts access to the service. This enhances security but may require the configuration of private endpoints for any services or users needing access within trusted networks.

## Audit Procedure

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies:

- Storage Services > Storage Accounts > Networking > "Ensure that 'Public Network Access' is 'Disabled' for storage accounts"
- Storage Services > Azure Elastic SAN > "Ensure 'Public network access' is set to 'Disabled' on Azure Elastic SAN"
- Storage Services > Azure Backup > Recovery Services Vaults > "Ensure public network access on Recovery Services vaults is Disabled"

## Expected Result

The `Public network access` setting should be set to `Disabled` for the service.

## Remediation

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies:

- Storage Services > Storage Accounts > Networking > "Ensure that 'Public Network Access' is 'Disabled' for storage accounts"
- Storage Services > Azure Elastic SAN > "Ensure 'Public network access' is set to 'Disabled' on Azure Elastic SAN"
- Storage Services > Azure Backup > Recovery Services Vaults > "Ensure public network access on Recovery Services vaults is Disabled"

## Default Value

Not explicitly stated in the benchmark.

## References

Not explicitly listed in the Common Reference section. See service-specific recommendations for detailed references.

## Additional Information

This Common Reference Recommendation is referenced in the following Service Recommendations:

- Storage Services > Storage Accounts > Networking > "Ensure that 'Public Network Access' is 'Disabled' for storage accounts"
- Storage Services > Azure Elastic SAN > "Ensure 'Public network access' is set to 'Disabled' on Azure Elastic SAN"
- Storage Services > Azure Backup > Recovery Services Vaults > "Ensure public network access on Recovery Services vaults is Disabled"

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | x | x | x |

## Profile

Level 1 | Automated
