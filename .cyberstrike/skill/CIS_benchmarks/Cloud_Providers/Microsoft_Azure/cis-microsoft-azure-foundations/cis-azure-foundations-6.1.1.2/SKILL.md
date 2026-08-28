---
name: cis-azure-foundations-6.1.1.2
description: "Ensure Diagnostic Setting captures appropriate categories"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, diagnostic-settings, activity-logs]
cis_id: "6.1.1.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.1.1]
prerequisites: [cis-azure-foundations-6.1.1.1]
severity_boost: {}
---

# Ensure Diagnostic Setting captures appropriate categories

## Description

**Prerequisite**: A Diagnostic Setting must exist. If a Diagnostic Setting does not exist, the navigation and options within this recommendation will not be available.

The diagnostic setting should be configured to log the appropriate activities from the control/management plane.

## Rationale

A diagnostic setting controls how the diagnostic log is exported. Capturing the diagnostic setting categories for appropriate control/management plane activities allows proper alerting.

## Impact

None identified.

## Audit Procedure

### Using Azure Portal

1. Go to `Monitor`.
2. Click `Activity log`.
3. Click on `Export Activity Logs`.
4. Select the appropriate `Subscription`.
5. Click `Edit setting` next to a diagnostic setting.
6. Ensure that the following categories are checked: `Administrative`, `Alert`, `Policy`, and `Security`.

### Using Azure CLI

Ensure the categories `'Administrative'`, `'Alert'`, `'Policy'`, and `'Security'` set to: 'enabled: true'

```bash
az monitor diagnostic-settings subscription list --subscription <subscription ID>
```

### Using PowerShell

Ensure the categories Administrative, Alert, Policy, and Security are set to Enabled:True

```powershell
Get-AzSubscriptionDiagnosticSetting -Subscription <subscriptionID>
```

## Expected Result

The Diagnostic Setting should have the categories Administrative, Alert, Policy, and Security all enabled.

## Remediation

### Remediate from Azure Portal

1. Go to `Monitor`.
2. Click `Activity log`.
3. Click on `Export Activity Logs`.
4. Select the `Subscription` from the drop down menu.
5. Click `Edit setting` next to a diagnostic setting.
6. Check the following categories: `Administrative`, `Alert`, `Policy`, and `Security`.
7. Choose the destination details according to your organization's needs.
8. Click `Save`.

### Remediate from Azure CLI

```bash
az monitor diagnostic-settings subscription create --subscription <subscription id> --name <diagnostic settings name> --location <location> <[--event-hub <event hub ID> --event-hub-auth-rule <event hub auth rule ID>] [--storage-account <storage account ID>] [--workspace <log analytics workspace ID>]> --logs "[{category:Security,enabled:true},{category:Administrative,enabled:true},{category:Alert,enabled:true},{category:Policy,enabled:true}]"
```

### Remediate from PowerShell

```powershell
$logCategories = @();
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category Administrative -Enabled $true
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category Security -Enabled $true
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category Alert -Enabled $true
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category Policy -Enabled $true

New-AzSubscriptionDiagnosticSetting -SubscriptionId <subscription ID> -Name <Diagnostic settings name> <[-EventHubAuthorizationRule <event hub auth rule ID> -EventHubName <event hub name>] [-StorageAccountId <storage account ID>] [-WorkSpaceId <log analytics workspace ID>] [-MarketplacePartner ID <full ARM Marketplace resource ID>]> -Log $logCategories
```

## Default Value

When the diagnostic setting is created using Azure Portal, by default no categories are selected.

## References

1. https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/diagnostic-settings
2. https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/resource-manager-diagnostic-settings
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation
4. https://learn.microsoft.com/en-us/cli/azure/monitor/diagnostic-settings?view=azure-cli-latest
5. https://learn.microsoft.com/en-us/powershell/module/az.monitor/new-azsubscriptiondiagnosticsetting?view=azps-13.4.0

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs |      | x    | x    |
| v7               | 6.3 Enable Detailed Logging     |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques | Tactics | Mitigations |
| ---------- | ------- | ----------- |
| T1485      | TA0040  | M1053       |

## Profile

Level 1 | Automated
