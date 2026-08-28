---
name: cis-azure-foundations-8.1.3.2
description: "Ensure 'Vulnerability assessment for machines' component status is set to 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, servers, vulnerability-assessment]
cis_id: "8.1.3.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.3.2 Ensure that 'Vulnerability assessment for machines' component status is set to 'On' (Manual)

## Description

Enable vulnerability assessment for machines on both Azure and hybrid (Arc enabled) machines.

## Rationale

Vulnerability assessment for machines scans for various security-related configurations and events such as system updates, OS vulnerabilities, and endpoint protection, then produces alerts on threat and vulnerability findings.

## Impact

Microsoft Defender for Servers plan 2 licensing is required, and configuration of Azure Arc introduces complexity beyond this recommendation.

## Audit Procedure

**From Azure Portal:**

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Defender for Cloud`.
3. Under `Management`, select `Environment Settings`.
4. Select a subscription.
5. Click on `Settings & monitoring`.
6. Ensure that `Vulnerability assessment for machines` is set to `On`.

Repeat the above for any additional subscriptions.

**From Azure Policy:**

- Policy ID: `501541f7-f7e7-4cd6-868c-4190fdad3ac9` - Name: 'A vulnerability assessment solution should be enabled on your virtual machines'

## Expected Result

Vulnerability assessment for machines should be set to `On`.

## Remediation

**From Azure Portal:**

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Defender for Cloud`.
3. Under `Management`, select `Environment Settings`.
4. Select a subscription.
5. Click on `Settings & Monitoring`.
6. Set the `Status` of `Vulnerability assessment for machines` to `On`.
7. Click `Continue`.

Repeat the above for any additional subscriptions.

## Default Value

By default, `Automatic provisioning of monitoring agent` is set to `Off`.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/monitoring-components
2. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/auto-provisioning-settings/list
3. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/auto-provisioning-settings/create
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-posture-vulnerability-management#pv-5-perform-vulnerability-assessments

## Profile

- Level 2
