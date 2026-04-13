---
name: cis-azure-foundations-6.1.1.9
description: "Ensure Microsoft Entra diagnostic setting exists to send Microsoft Entra activity logs"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, entra-id, activity-logs, sign-in]
cis_id: "6.1.1.9"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.1.8]
prerequisites: []
severity_boost: {}
---

# Ensure that a Microsoft Entra diagnostic setting exists to send Microsoft Entra activity logs to an appropriate destination

## Description

Ensure that a Microsoft Entra diagnostic setting is configured to send Microsoft Entra activity logs to a suitable destination, such as a Log Analytics workspace, storage account, or event hub. This enables centralized monitoring and analysis of Microsoft Entra activity logs.

## Rationale

Microsoft Entra activity logs enables you to assess many aspects of your Microsoft Entra tenant. Configuring diagnostic settings in Microsoft Entra ensures these logs are collected and sent to an appropriate destination for monitoring, analysis, and retention.

## Impact

To export sign-in data, your organization needs an Azure AD P1 or P2 license. The amount of data logged and, thus, the cost incurred can vary significantly depending on the tenant size.

## Audit Procedure

### Using Azure Portal

1. Go to `Microsoft Entra ID`.
2. Under `Monitoring`, click `Diagnostic settings`.
3. Next to each diagnostic setting, click `Edit setting`, and review the selected log categories and destination details.
4. Ensure that at least one diagnostic setting is configured to send the following logs to an appropriate destination:
   - `AuditLogs`
   - `SignInLogs`
   - `NonInteractiveUserSignInLogs`
   - `ServicePrincipalSignInLogs`
   - `ManagedIdentitySignInLogs`
   - `ProvisioningLogs`
   - `ADFSSignInLogs`
   - `RiskyUsers`
   - `UserRiskEvents`
   - `NetworkAccessTrafficLogs`
   - `RiskyServicePrincipals`
   - `ServicePrincipalRiskEvents`
   - `EnrichedOffice365AuditLogs`
   - `MicrosoftGraphActivityLogs`
   - `RemoteNetworkHealthLogs`
   - `NetworkAccessAlerts`

## Expected Result

At least one Microsoft Entra diagnostic setting should exist that sends all applicable activity log categories to an appropriate destination.

## Remediation

### Remediate from Azure Portal

1. Go to `Microsoft Entra ID`.
2. Under `Monitoring`, click `Diagnostic settings`.
3. Click `+ Add diagnostic setting`.
4. Provide a `Diagnostic setting name`.
5. Under `Logs > Categories`, check the box next to each of the following logs:
   - `AuditLogs`
   - `SignInLogs`
   - `NonInteractiveUserSignInLogs`
   - `ServicePrincipalSignInLogs`
   - `ManagedIdentitySignInLogs`
   - `ProvisioningLogs`
   - `ADFSSignInLogs`
   - `RiskyUsers`
   - `UserRiskEvents`
   - `NetworkAccessTrafficLogs`
   - `RiskyServicePrincipals`
   - `ServicePrincipalRiskEvents`
   - `EnrichedOffice365AuditLogs`
   - `MicrosoftGraphActivityLogs`
   - `RemoteNetworkHealthLogs`
   - `NetworkAccessAlerts`
6. Configure an appropriate destination for the logs.
7. Click `Save`.

## Default Value

By default, Microsoft Entra diagnostic settings do not exist.

## References

1. https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-configure-diagnostic-settings
2. https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-access-activity-logs

## CIS Controls

| Controls Version | Control                     | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs      | x    | x    | x    |
| v7               | 6.2 Activate audit logging  | x    | x    | x    |
| v7               | 6.3 Enable Detailed Logging |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques | Tactics | Mitigations |
| ---------- | ------- | ----------- |
|            |         | M1047       |

## Profile

Level 2 | Manual
