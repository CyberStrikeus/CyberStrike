---
name: cis-azure-foundations-8.1.3.3
description: "Ensure 'Endpoint protection' component status is set to 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, servers, endpoint-protection]
cis_id: "8.1.3.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.3.3 Ensure that 'Endpoint protection' component status is set to 'On' (Automated)

## Description

The Endpoint protection component enables Microsoft Defender for Endpoint (formerly 'Advanced Threat Protection' or 'ATP' or 'WDATP') to communicate with Microsoft Defender for Cloud. When enabling integration between DfE & DfC it needs to be taken into account that this will have some side effects that may be undesirable.

## Rationale

Microsoft Defender for Endpoint integration brings comprehensive Endpoint Detection and Response (EDR) capabilities within Microsoft Defender for Cloud. This integration helps to spot abnormalities, as well as detect and respond to advanced attacks on endpoints monitored by Microsoft Defender for Cloud. MDE works only with Standard Tier subscriptions.

## Impact

Endpoint protection requires licensing and is included in Defender for Servers plan 1 and Defender for Servers plan 2.

## Audit Procedure

**From Azure Portal:**
1. From Azure Home select the Portal Menu.
2. Select `Microsoft Defender for Cloud`.
3. Under `Management`, select `Environment Settings`.
4. Click on the subscription name.
5. Click `Settings & monitoring`.
6. Ensure the `Status` for `Endpoint protection` is set to `On`.

**From PowerShell:**
```
Connect-AzAccount
Set-AzContext -Subscription <subscriptionID>
Get-AzSecuritySetting | Select-Object name,enabled | where-object {$_.name -eq "WDATP"}
```
Compliant output: `WDATP  True`

## Expected Result

The WDATP setting should show `Enabled: True`.

## Remediation

**From Azure Portal:**
1. From Azure Home select the Portal Menu.
2. Go to `Microsoft Defender for Cloud`.
3. Under `Management`, select `Environment Settings`.
4. Click on the subscription name.
5. Click `Settings & monitoring`.
6. Set the `Status` for `Endpoint protection` to `On`.
7. Click `Continue`.

## Default Value

By default, Endpoint protection is `off`.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/integration-defender-for-endpoint
2. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/settings/list
3. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/settings/update
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-endpoint-security#es-1-use-endpoint-detection-and-response-edr
5. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-endpoint-security#es-2-use-modern-anti-malware-software

## Profile

- Level 2
