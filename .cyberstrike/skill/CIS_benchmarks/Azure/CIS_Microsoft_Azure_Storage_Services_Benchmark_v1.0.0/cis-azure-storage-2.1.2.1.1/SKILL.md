---
name: cis-azure-storage-2.1.2.1.1
description: "Ensure Critical Data is Encrypted with Microsoft Managed Keys (MMK)"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, sas, encryption, keys]
cis_id: "2.1.2.1.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.2.1.1 Ensure Critical Data is Encrypted with Microsoft Managed Keys (MMK) (Manual)

## Description

Microsoft Managed Keys (MMK) [also known as Platform-managed keys (PMK)] provides a very low overhead method of encrypting data at rest and implementing encryption key management. Keys maintained in an MMK implementation are automatically managed by Azure and require no customer interaction.

## Rationale

The encryption of data at rest is a foundational component of data security. Data at rest without encryption is easily compromised through loss or theft. Encrypting data at rest introduces confidentiality to the data by obfuscating the data contents with a cipher algorithm and provides an authentication requirement through the use of cryptographic keys. MMK makes the encryption of data at rest very easy to implement and maintain.

## Impact

Not explicitly stated in the benchmark. MMK provides the lowest overhead approach to encryption at rest with no additional cost or management burden.

## Audit Procedure

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies.

## Expected Result

The encryption type for the storage account should be set to Microsoft Managed Keys (MMK).

## Remediation

This is a Common Reference Recommendation. Audit and remediation procedures with full details will be found in the section dedicated to each specific service where this recommendation applies.

## Default Value

By default, Encryption type is set to Microsoft Managed Keys.

## References

1. https://docs.microsoft.com/en-us/azure/security/fundamentals/data-encryption-best-practices#protect-data-at-rest
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-5-use-customer-managed-key-option-in-data-at-rest-encryption-when-required
3. https://learn.microsoft.com/en-us/azure/security/fundamentals/key-management

## Additional Information

This recommendation falls under section 2.1.2 Encryption Key Management, which describes three options for Encryption Key Management in Azure Services:

1. **Microsoft Managed Keys ('MMK')** [Also known as Platform Managed Keys or PMK]: The storage, creation, and maintenance of encryption keys is performed automatically by Microsoft. This option uses the Microsoft key store and automates the control and rotation of keys. Where the security and compliance frameworks implemented by your organization do not specify otherwise, Microsoft Managed Keys is generally preferred, but it should be understood that there is an implied trust that your organization must assume.

2. **Customer Managed Keys ('CMK')**: The creation and maintenance of encryption keys is the responsibility of the customer but stored in a Microsoft provided vault. This option stores keys in Azure Key Vault or Key Vault HSM, but the control and rotation of keys is performed by the customer.

3. **Customer Provided Keys ('CPK')**: The storage, control, and rotation of encryption keys is the responsibility of the customer. Your organization must have an independent key storage facility, maintain control and perform rotation of keys.

The use of each of these methods of managing encryption keys requires careful consideration, and the scope of application should be determined prior to implementation.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest - Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system, in order to access the information. | | | x |

## Profile

Level 1 | Manual
