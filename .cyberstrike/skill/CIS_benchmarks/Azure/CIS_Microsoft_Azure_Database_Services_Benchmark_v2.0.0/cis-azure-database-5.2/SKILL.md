---
name: cis-azure-database-5.2
description: "Ensure Azure Database for MySQL uses only Microsoft Entra Authentication"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, mysql, database]
cis_id: "5.2"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2 Ensure Azure Database for MySQL uses only Microsoft Entra Authentication (Automated)

## Profile Applicability

- Level 1

## Description

Ensuring that Microsoft Entra Authentication is the only authentication method prevents the local MySQL authentication from being used.

## Rationale

The use of a centralized Identity and Access Management (IAM) solution such as Microsoft Entra ID is highly recommended for all activity related to Identity, Authentication, Authorization, and Accountability.

Decentralized IAM -- such as local authentication methods -- may present additional vulnerability and introduce avoidable administrative complexity.

## Impact

None specified.

## Audit

### Audit from Azure Portal

1. From `Azure Database for MySQL` select a server to audit.
2. Under the Security section, click `Authentication`.
3. In the main window, under the Authentication header, ensure that "Assign Access to:" reflects the selection of `Microsoft Entra authentication only`.

### Audit From Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.

If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- **Policy ID:** `40e85574-ef33-47e8-a854-7a65c7500560` - **Name:** 'Azure MySQL flexible server should have Microsoft Entra Only Authentication enabled'

## Expected Result

The Authentication setting should show `Microsoft Entra authentication only` as the selected access method.

## Remediation

### Remediate from Azure Portal

1. From `Azure Database for MySQL` select a server to remediate.
2. Under the Security section, click `Authentication`.
3. In the main window, under the Authentication header where "Assign Access to:" provides three options, select `Microsoft Entra authentication only`.

## Default Value

By default, Azure Database for MySQL uses `MySQL authentication only`.

## References

1. https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-azure-ad
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 5.6 Centralize Account Management | | X | X |
| v7 | 16.2 Configure Centralized Point of Authentication | | X | X |
