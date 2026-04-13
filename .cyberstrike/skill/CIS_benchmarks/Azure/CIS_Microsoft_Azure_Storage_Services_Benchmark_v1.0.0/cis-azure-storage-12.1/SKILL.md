---
name: cis-azure-storage-12.1
description: "Ensure double encryption is used for Azure Data Box in high-security environments"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, data-box, encryption]
cis_id: "12.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 12.1 Ensure double encryption is used for Azure Data Box in high-security environments (Manual)

## Description

Enabling double encryption on Azure Data Box applies an additional layer of encryption to safeguard data during physical transfer. This approach enhances confidentiality and integrity, ensuring that sensitive information remains secure against unauthorized access if the device is lost, stolen, or intercepted.

## Rationale

Double encryption ensures strong security for high-risk or regulated environments where data protection is critical. It enhances defense-in-depth and minimizes the risk of exposure, even during physical compromise in transit.

## Impact

Double encryption with Azure Data Box is available at no additional cost; however, enabling it may increase order processing and data copy times.

## Audit Procedure

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.
If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `c349d81b-9985-44ae-a8da-ff98d108ede8`
- Name: 'Azure Data Box jobs should enable double encryption for data at rest on the device'

## Expected Result

The Azure Policy for double encryption on Azure Data Box should be compliant, confirming that all Data Box orders have double encryption enabled for data at rest on the device.

## Remediation

### Remediate from Azure Portal

When creating a new Azure Data Box order, on the **Security** page, under **Double encryption**, check the box next to `Enable double encryption for the order`.

## Default Value

Double encryption is disabled by default on Azure Data Box orders.

## References

1. https://learn.microsoft.com/en-us/azure/security/fundamentals/double-encryption
2. https://learn.microsoft.com/en-us/azure/databox/data-box-security
3. https://learn.microsoft.com/en-us/azure/databox/data-box-deploy-ordered
4. https://learn.microsoft.com/en-us/powershell/module/az.databox/update-azdataboxjob

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | **3.11 Encrypt Sensitive Data at Rest** - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. | | X | X |
| v7 | **14.8 Encrypt Sensitive Information at Rest** - Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system, in order to access the information. | | | X |

## Profile

Level 2 | Manual
