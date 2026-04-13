---
name: cis-azure-foundations-6.1.1.8
description: "Ensure Microsoft Entra diagnostic setting exists to send Microsoft Graph activity logs"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, entra-id, microsoft-graph]
cis_id: "6.1.1.8"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.1.9]
prerequisites: []
severity_boost: {}
---

# Ensure that a Microsoft Entra diagnostic setting exists to send Microsoft Graph activity logs to an appropriate destination

## Description

Ensure that a Microsoft Entra diagnostic setting is configured to send Microsoft Graph activity logs to a suitable destination, such as a Log Analytics workspace, storage account, or event hub. This enables centralized monitoring and analysis of all HTTP requests that the Microsoft Graph service receives and processes for a tenant.

## Rationale

Microsoft Graph activity logs provide visibility into HTTP requests made to the Microsoft Graph service, helping detect unauthorized access, suspicious activity, and security threats. Configuring diagnostic settings in Microsoft Entra ensures these logs are collected and sent to an appropriate destination for monitoring, analysis, and retention.

## Impact

A Microsoft Entra ID P1 or P2 tenant license is required to access the Microsoft Graph activity logs. The amount of data logged and, thus, the cost incurred can vary significantly depending on the tenant size and the applications in your tenant that interact with the Microsoft Graph APIs.

## Audit Procedure

### Using Azure Portal

1. Go to `Microsoft Entra ID`.
2. Under `Monitoring`, click `Diagnostic settings`.
3. Next to each diagnostic setting, click `Edit setting`, and review the selected log categories and destination details.
4. Ensure that at least one diagnostic setting is configured to send `MicrosoftGraphActivityLogs` to an appropriate destination.

## Expected Result

At least one Microsoft Entra diagnostic setting should exist that sends MicrosoftGraphActivityLogs to an appropriate destination (Log Analytics workspace, storage account, or event hub).

## Remediation

### Remediate from Azure Portal

1. Go to `Microsoft Entra ID`.
2. Under `Monitoring`, click `Diagnostic settings`.
3. Click `+ Add diagnostic setting`.
4. Provide a `Diagnostic setting name`.
5. Under `Logs > Categories`, check the box next to `MicrosoftGraphActivityLogs`.
6. Configure an appropriate destination for the logs.
7. Click `Save`.

## Default Value

By default, Microsoft Entra diagnostic settings do not exist.

## References

1. https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-configure-diagnostic-settings
2. https://learn.microsoft.com/en-us/graph/microsoft-graph-activity-logs-overview
3. https://learn.microsoft.com/en-us/azure/azure-monitor/logs/cost-logs#pricing-model
4. https://azure.microsoft.com/en-us/pricing/details/storage/blobs/
5. https://azure.microsoft.com/en-us/pricing/details/event-hubs/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 8.2 Collect Audit Logs | x | x | x |
| v7 | 6.2 Activate audit logging | x | x | x |

## MITRE ATT&CK Mappings

| Techniques | Tactics | Mitigations |
| ---------- | ------- | ----------- |
| | | M1047 |

## Profile

Level 2 | Manual
