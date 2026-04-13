---
name: cis-azure-storage-2.1.2.2.1
description: "Ensure Critical Data is Encrypted with Customer Managed Keys (CMK)"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, sas, encryption, keys]
cis_id: "2.1.2.2.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.2.2.1 Ensure Critical Data is Encrypted with Customer Managed Keys (CMK) (Manual)

## Description

Customer Managed Keys introduce additional depth to security by providing a means to manage access control for encryption keys. Where compliance and security frameworks indicate the need, and organizational capacity allows, sensitive data at rest can be encrypted using Customer Managed Keys (CMK) rather than Microsoft Managed keys.

## Rationale

By default in Azure, data at rest tends to be encrypted using Microsoft Managed Keys. If your organization want to control and manage encryption keys for compliance and defense-in-depth, Customer Managed Keys can be established.

While it is possible to automate the assessment of this recommendation, the assessment status for this recommendation remains 'Manual' due to ideally limited scope. The scope of application - which workloads CMK is applied to - should be carefully considered to account for organizational capacity and targeted to workloads with specific need for CMK.

## Impact

If the key expires due to setting the 'activation date' and 'expiration date', the key must be rotated manually.

Using Customer Managed Keys may also incur additional man-hour requirements to create, store, manage, and protect the keys as needed.

## Audit Procedure

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies.

## Expected Result

The encryption type for the storage account should be set to Customer Managed Keys (CMK), with the key stored in Azure Key Vault or Key Vault HSM.

## Remediation

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies.

## Default Value

By default, Encryption type is set to Microsoft Managed Keys.

## References

1. https://docs.microsoft.com/en-us/azure/security/fundamentals/data-encryption-best-practices#protect-data-at-rest
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-5-use-customer-managed-key-option-in-data-at-rest-encryption-when-required

## Additional Information

This recommendation falls under section 2.1.2 Encryption Key Management. Customer Managed Keys ('CMK') provide the creation and maintenance of encryption keys as the responsibility of the customer but stored in a Microsoft provided vault. This option stores keys in Azure Key Vault or Key Vault HSM, but the control and rotation of keys is performed by the customer. Encryption Key management introduces some complexity and technical debt to an environment because the creation and maintenance of keys requires technical capacity for maintaining key infrastructure in addition to scripting for automation. For environments that have specific compliance requirements for the control and rotation of keys, this option may be required.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest - Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system, in order to access the information. | | | x |

## Profile

Level 2 | Manual
