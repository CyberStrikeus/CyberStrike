---
name: cis-azure-foundations-7.7
description: "Ensure Public IP addresses are Evaluated on a Periodic Basis"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, nsg]
cis_id: "7.7"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-7.1, cis-azure-foundations-7.2, cis-azure-foundations-7.11]
prerequisites: []
severity_boost: {}
---

# Ensure Public IP addresses are Evaluated on a Periodic Basis

## Description

Public IP Addresses provide tenant accounts with Internet connectivity for resources contained within the tenant. During the creation of certain resources in Azure, a Public IP Address may be created. All Public IP Addresses within the tenant should be periodically reviewed for accuracy and necessity.

While an automated assessment procedure exists for this recommendation, the assessment status remains manual. Evaluating the appropriateness of public IP addresses requires a manual review, as it depends on the specific needs and context of each organization and environment.

## Rationale

Public IP Addresses allocated to the tenant should be periodically reviewed for necessity. Public IP Addresses that are not intentionally assigned and controlled present a publicly facing vector for threat actors and significant risk to the tenant.

## Impact

None documented. This is a review-based control that requires periodic manual assessment.

## Audit Procedure

### Using Azure Portal

1. Open the `All Resources` blade.
2. Click on `Add Filter`.
3. In the Add Filter window, select the following: Filter: `Type` Operator: `Equals` Value: `Public IP address`.
4. Click the `Apply` button.
5. For each Public IP address in the list, use Overview (or Properties) to review the `"Associated to:"` field and determine if the associated resource is still relevant to your tenant environment. If the associated resource is relevant, ensure that additional controls exist to mitigate risk (e.g. Firewalls, VPNs, Traffic Filtering, Virtual Gateway Appliances, Web Application Firewalls, etc.) on all subsequently attached resources.

### Using Azure CLI

List all Public IP addresses:

```bash
az network public-ip list
```

For each Public IP address in the output, review the `"name"` property and determine if the associated resource is still relevant to your tenant environment. If the associated resource is relevant, ensure that additional controls exist to mitigate risk (e.g. Firewalls, VPNs, Traffic Filtering, Virtual Gateway Appliances, Web Application Firewalls, etc.) on all subsequently attached resources.

## Expected Result

All Public IP addresses should be associated with relevant, active resources and have appropriate compensating controls in place. Any unneeded or orphaned Public IP addresses should be identified for removal.

## Remediation

Remediation will vary significantly depending on your organization's security requirements for the resources attached to each individual Public IP address.

## Default Value

During Virtual Machine and Application creation, a setting may create and attach a public IP.

## References

1. https://learn.microsoft.com/en-us/cli/azure/network/public-ip
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security

## CIS Controls

| Controls Version | Control                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------ | ---- | ---- | ---- |
| v8               | 12.1 Ensure Network Infrastructure is Up-to-Date | x    | x    | x    |
| v7               | 12.1 Maintain an Inventory of Network Boundaries | x    | x    | x    |

## Profile

Level 1 | Manual
