---
name: cis-azure-foundations-6.1.1.1
description: "Ensure that a 'Diagnostic Setting' exists for Subscription Activity Logs"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, diagnostic-settings, activity-logs]
cis_id: "6.1.1.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.1.2, cis-azure-foundations-6.1.1.3]
prerequisites: []
severity_boost: {}
---

# Ensure that a 'Diagnostic Setting' exists for Subscription Activity Logs

## Description

Enable Diagnostic settings for exporting activity logs. Diagnostic settings are available for each individual resource within a subscription. Settings should be configured for all appropriate resources for your environment.

## Rationale

A diagnostic setting controls how a diagnostic log is exported. By default, logs are retained only for 90 days. Diagnostic settings should be defined so that logs can be exported and stored for a longer duration to analyze security activities within an Azure subscription.

## Impact

None identified.

## Audit Procedure

### Using Azure Portal

To identify Diagnostic Settings on a subscription:

1. Go to `Monitor`.
2. Click `Activity Log`.
3. Click `Export Activity Logs`.
4. Select a `Subscription`.
5. Ensure a `Diagnostic setting` exists for the selected Subscription.

To identify Diagnostic Settings on specific resources:

1. Go to `Monitoring`.
2. Click `Diagnostic settings`.
3. Ensure a `Diagnostic setting` exists for all appropriate resources.

### Using Azure CLI

To identify Diagnostic Settings on a subscription:

```bash
az monitor diagnostic-settings subscription list --subscription <subscription-id>
```

To identify Diagnostic Settings on a resource:

```bash
az monitor diagnostic-settings list --resource <resource-id>
```

### Using PowerShell

To identify Diagnostic Settings on a Subscription:

```powershell
Get-AzSubscriptionDiagnosticSetting -SubscriptionId <subscription-id>
```

To identify Diagnostic Settings on a specific resource:

```powershell
Get-AzDiagnosticSetting -ResourceId <resource-id>
```

## Expected Result

At least one Diagnostic Setting should exist for each subscription, exporting activity logs to a destination such as Log Analytics workspace, Storage Account, or Event Hub.

## Remediation

### Remediate from Azure Portal

To enable Diagnostic Settings on a Subscription:

1. Go to `Monitor`.
2. Click on `Activity log`.
3. Click on `Export Activity Logs`.
4. Click `+ Add diagnostic setting`.
5. Enter a `Diagnostic setting name`.
6. Select `Categories` for the diagnostic setting.
7. Select the appropriate `Destination details` (Log Analytics, Storage Account, Event Hub, or Partner solution).
8. Click `Save`.

### Remediate from Azure CLI

```bash
az monitor diagnostic-settings subscription create --subscription <subscription id> --name <diagnostic settings name> --location <location> <[--event-hub <event hub ID> --event-hub-auth-rule <event hub auth rule ID>] [--storage-account <storage account ID>] [--workspace <log analytics workspace ID>]> --logs "<JSON encoded categories>" (e.g. [{category:Security,enabled:true},{category:Administrative,enabled:true},{category:Alert,enabled:true},{category:Policy,enabled:true}])
```

### Remediate from PowerShell

```powershell
$logCategories = @();
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category Administrative -Enabled $true
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category Security -Enabled $true
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category ServiceHealth -Enabled $true
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category Alert -Enabled $true
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category Recommendation -Enabled $true
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category Policy -Enabled $true
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category Autoscale -Enabled $true
$logCategories += New-AzDiagnosticSettingSubscriptionLogSettingsObject -Category ResourceHealth -Enabled $true

New-AzSubscriptionDiagnosticSetting -SubscriptionId <subscription ID> -Name <Diagnostic settings name> <[-EventHubAuthorizationRule <event hub auth rule ID> -EventHubName <event hub name>] [-StorageAccountId <storage account ID>] [-WorkSpaceId <log analytics workspace ID>] [-MarketplacePartner ID <full ARM Marketplace resource ID>]> -Log $logCategories
```

## Default Value

No Diagnostic Settings are configured by default.

## References

1. https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/diagnostic-settings
2. https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/resource-manager-diagnostic-settings
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation
4. https://learn.microsoft.com/en-us/cli/azure/monitor/diagnostic-settings?view=azure-cli-latest
5. https://learn.microsoft.com/en-us/powershell/module/az.monitor/new-azsubscriptiondiagnosticsetting?view=azps-13.4.0

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 8.5 Collect Detailed Audit Logs | | x | x |
| v7 | 6.3 Enable Detailed Logging | | x | x |

## MITRE ATT&CK Mappings

| Techniques | Tactics | Mitigations |
| ---------- | ------- | ----------- |
| T1485 | TA0040 | M1053 |

## Profile

Level 1 | Automated
