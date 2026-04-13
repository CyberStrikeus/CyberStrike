---
name: cis-azure-database-4.1
description: "Ensure Data Factory is encrypted using Customer Managed Keys"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, data-factory, adf]
cis_id: "4.1"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1 Ensure Data Factory is encrypted using Customer Managed Keys (Manual)

## Profile Applicability

- Level 2

## Description

Customer-managed keys introduce additional depth to security by providing a means to manage access control for encryption keys. Where compliance and security frameworks indicate the need, and organizational capacity allows, sensitive data at rest can be encrypted using customer-managed keys (CMK) rather than Microsoft-managed keys.

## Rationale

By default in Azure, data at rest tends to be encrypted using Microsoft-managed keys. If your organization wants to control and manage encryption keys for compliance and defense-in-depth, customer-managed keys can be established.

Configuring the storage account with the activity log export container to use CMKs provides additional confidentiality controls on log data, as a given user must have read permission on the corresponding storage account and must be granted decrypt permission by the CMK.

While it is possible to automate the assessment of this recommendation, the assessment status for this recommendation remains 'Manual' due to ideally limited scope. The scope of application -- which workloads CMK is applied to -- should be carefully considered to account for organizational capacity and targeted to workloads with specific need for CMK.

## Impact

If the key expires due to setting the 'activation date' and 'expiration date', the key must be rotated manually.

Using customer-managed keys may also incur additional man-hour requirements to create, store, manage, and protect the keys as needed.

## Audit

### Audit from Azure Portal

1. From `Azure Data Factory` select the Data Factory to audit.
2. From the `Overview` selection scroll down and select `Launch Studio`.
3. Select the `wrench and briefcase` icon named `Manage`.
4. In the left column scroll down to under `Security` and select `Customer managed key`.
5. Audit the keys listed here.

### Audit From Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.

If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- **Policy ID:** `4ec52d6d-beb7-40c4-9a9e-fe753254690e` - **Name:** 'Azure data factories should be encrypted with a customer-managed key'

## Expected Result

A customer-managed key should be configured and listed under the Security > Customer managed key section in Azure Data Factory Studio.

## Remediation

### Remediate from Azure Portal

1. Retrieve the key identifier for a key in a Key Vault located in the same subscription and region as your Azure Data Factory.
2. From the `Azure Data Factory` service, select the Data Factory to audit.
3. From the `Overview` selection scroll down and select `Launch Studio`.
4. Select the `wrench and briefcase` icon named `Manage`.
5. In the left column scroll down to under `Security` and select `Customer managed key`.
6. Select `Add key`.
7. Under `Azure Key Vault key URL` enter in the key identifier of the key to be used.
8. Select `Save`.

## Default Value

By default in Azure, data at rest tends to be encrypted using Microsoft-managed keys.

## References

1. https://learn.microsoft.com/en-us/azure/data-factory/enable-customer-managed-key

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | X    | X    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1530                       | TA0009  | M1041       |
