---
name: cis-azure-foundations-6.1.1.10
description: "Ensure Intune logs are captured and sent to Log Analytics"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, intune, endpoint-management]
cis_id: "6.1.1.10"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.1.9]
prerequisites: []
severity_boost: {}
---

# Ensure that Intune logs are captured and sent to Log Analytics

## Description

Ensure that Intune logs are captured and fed into a central log analytics workspace.

## Rationale

Intune includes built-in logs that provide information about your environments. Sending logs to a Log Analytics workspace enables centralized analysis, correlation, and alerting for faster threat detection and response.

## Impact

A Microsoft Intune plan is required to access Intune. The amount of data logged and, thus, the cost incurred can vary significantly depending on the tenant size.

## Audit Procedure

### Using Azure Portal

1. Go to `Intune`.
2. Click `Reports`.
3. Under `Azure monitor`, click `Diagnostic settings`.
4. Next to each diagnostic setting, click `Edit setting`, and review the selected log categories and destination details.
5. Ensure that at least one diagnostic setting is configured to send the following logs to a Log Analytics workspace:
   - `AuditLogs`
   - `OperationalLogs`
   - `DeviceComplianceOrg`
   - `Devices`
   - `Windows365AuditLogs`

## Expected Result

At least one Intune diagnostic setting should exist that sends AuditLogs, OperationalLogs, DeviceComplianceOrg, Devices, and Windows365AuditLogs to a Log Analytics workspace.

## Remediation

### Remediate from Azure Portal

1. Go to `Intune`.
2. Click `Reports`.
3. Under `Azure monitor`, click `Diagnostic settings`.
4. Click `+ Add diagnostic setting`.
5. Provide a `Diagnostic setting name`.
6. Under `Logs > Categories`, check the box next to each of the following logs:
   - `AuditLogs`
   - `OperationalLogs`
   - `DeviceComplianceOrg`
   - `Devices`
   - `Windows365AuditLogs`
7. Under `Destination details`, check the box next to `Send to Log Analytics workspace`.
8. Select a `Subscription`.
9. Select a `Log Analytics workspace`.
10. Click `Save`.

## Default Value

By default, Intune diagnostic settings do not exist.

## References

1. https://learn.microsoft.com/en-us/intune/intune-service/fundamentals/review-logs-using-azure-monitor
2. https://www.microsoft.com/en-us/security/business/microsoft-intune-pricing
3. https://learn.microsoft.com/en-us/azure/azure-monitor/logs/cost-logs

## CIS Controls

| Controls Version | Control                    | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs     | x    | x    | x    |
| v7               | 6.2 Activate audit logging | x    | x    | x    |

## Profile

Level 2 | Manual
