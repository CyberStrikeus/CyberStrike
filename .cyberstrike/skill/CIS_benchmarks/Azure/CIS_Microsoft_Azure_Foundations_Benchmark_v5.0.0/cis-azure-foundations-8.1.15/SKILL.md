---
name: cis-azure-foundations-8.1.15
description: "Ensure that Microsoft Defender External Attack Surface Monitoring (EASM) is enabled"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, easm, attack-surface]
cis_id: "8.1.15"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.15 Ensure that Microsoft Defender External Attack Surface Monitoring (EASM) is enabled (Manual)

## Description

Enable Microsoft Defender External Attack Surface Monitoring (EASM) to continuously discover and map the organization's external-facing digital attack surface, providing visibility into internet-exposed assets that may be unknown or unmanaged.

## Rationale

Organizations often have internet-facing assets they are unaware of, including shadow IT, forgotten infrastructure, and assets from mergers and acquisitions. Microsoft Defender EASM discovers and monitors these assets by scanning the internet for resources associated with the organization's known infrastructure. This provides critical visibility into the external attack surface, helping identify exposed services, misconfigurations, and vulnerabilities before adversaries can exploit them.

## Impact

Enabling EASM incurs additional costs based on the number of monitored assets. The initial discovery process may reveal a significant number of previously unknown assets that require investigation and remediation. Organizations should plan for the operational effort needed to triage and manage newly discovered assets.

## Audit Procedure

**From Azure Portal:**
1. Go to `Microsoft Defender External Attack Surface Management`.
2. Verify that an EASM workspace has been created.
3. Verify that discovery groups have been configured with appropriate seeds (domains, IP ranges, ASNs).
4. Verify that the workspace is actively discovering and monitoring assets.

**Note:** There is currently no Azure CLI or PowerShell command to directly query EASM status. This is a manual verification.

**Using Azure REST API:**
```
az rest --method get --url "https://management.azure.com/subscriptions/{subscriptionId}/providers/Microsoft.Easm/workspaces?api-version=2023-04-01-preview"
```
Verify that at least one EASM workspace exists.

## Expected Result

At least one EASM workspace should be created and actively monitoring the organization's external attack surface with configured discovery groups.

## Remediation

**From Azure Portal:**
1. Go to `Microsoft Defender External Attack Surface Management`.
2. Click `Create a workspace`.
3. Select the appropriate subscription and resource group.
4. Enter a name for the workspace and select the region.
5. Click `Review + Create`, then `Create`.
6. Once the workspace is created, configure discovery groups with the organization's known seeds (domains, IP blocks, ASNs, etc.).
7. Start the discovery process.

## Default Value

Microsoft Defender EASM is not enabled by default. An EASM workspace must be explicitly created and configured.

## References

1. https://learn.microsoft.com/en-us/azure/external-attack-surface-management/overview
2. https://learn.microsoft.com/en-us/azure/external-attack-surface-management/deploying-the-defender-easm-azure-resource
3. https://learn.microsoft.com/en-us/azure/external-attack-surface-management/using-and-managing-discovery
4. https://azure.microsoft.com/en-us/pricing/details/defender-external-attack-surface-management/

## Profile

- Level 2
