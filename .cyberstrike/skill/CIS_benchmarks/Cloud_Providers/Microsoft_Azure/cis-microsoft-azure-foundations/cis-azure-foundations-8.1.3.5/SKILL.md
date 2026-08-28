---
name: cis-azure-foundations-8.1.3.5
description: "Ensure 'File Integrity Monitoring' component status is set to 'On'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, servers, file-integrity-monitoring]
cis_id: "8.1.3.5"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.3.5 Ensure that 'File Integrity Monitoring' component status is set to 'On' (Manual)

## Description

File Integrity Monitoring (FIM) is a feature that monitors critical system files in Windows or Linux for potential signs of attack or compromise.

## Rationale

FIM provides a detection mechanism for compromised files. When FIM is enabled, critical system files are monitored for changes that might indicate a threat actor is attempting to modify system files for lateral compromise within a host operating system.

## Impact

File Integrity Monitoring requires licensing and is included in Defender for Servers plan 2.

## Audit Procedure

**From Azure Portal:**

1. From the Azure Portal `Home` page, select `Microsoft Defender for Cloud`.
2. Under `Management` select `Environment Settings`.
3. Select a subscription.
4. Under `Settings` > `Defender Plans`, click `Settings & monitoring`.
5. Under the Component column, locate the row for `File Integrity Monitoring`.
6. Ensure that `On` is selected.

Repeat the above for any additional subscriptions.

## Expected Result

File Integrity Monitoring should be set to `On`.

## Remediation

**From Azure Portal:**

1. From the Azure Portal `Home` page, select `Microsoft Defender for Cloud`.
2. Under `Management` select `Environment Settings`.
3. Select a subscription.
4. Under `Settings` > `Defender Plans`, click `Settings & monitoring`.
5. Under the Component column, locate the row for `File Integrity Monitoring`.
6. Select `On`.
7. Click `Continue` in the top left.

Repeat the above for any additional subscriptions.

## Default Value

By default, File Integrity Monitoring is `Off`.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/file-integrity-monitoring-overview
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-incident-response#ir-2-preparation---setup-incident-notification
3. https://learn.microsoft.com/en-us/azure/defender-for-cloud/file-integrity-monitoring-enable-defender-endpoint

## Profile

- Level 2
