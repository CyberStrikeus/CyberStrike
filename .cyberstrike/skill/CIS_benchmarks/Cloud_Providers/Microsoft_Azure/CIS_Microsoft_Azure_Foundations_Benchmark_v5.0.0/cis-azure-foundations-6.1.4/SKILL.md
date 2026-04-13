---
name: cis-azure-foundations-6.1.4
description: "Ensure that Azure Monitor Resource Logging is Enabled for All Services that Support it"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, resource-logging, diagnostic-settings]
cis_id: "6.1.4"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.1.1]
prerequisites: []
severity_boost: {}
---

# Ensure that Azure Monitor Resource Logging is Enabled for All Services that Support it

## Description

Resource Logs capture activity to the data access plane while the Activity log is a subscription-level log for the control plane. Resource-level diagnostic logs provide insight into operations that were performed within that resource itself; for example, reading or updating a secret from a Key Vault. Currently, 95 Azure resources support Azure Monitoring (See the more information section for a complete list), including Network Security Groups, Load Balancers, Key Vault, AD, Logic Apps, and CosmosDB. The content of these logs varies by resource type.

A number of back-end services were not configured to log and store Resource Logs for certain activities or for a sufficient length. It is crucial that monitoring is correctly configured to log all relevant activities and retain those logs for a sufficient length of time. Given that the mean time to detection in an enterprise is 240 days, a minimum retention period of two years is recommended.

While an automated assessment procedure exists for this recommendation, the assessment status remains manual. Determining whether resource logging should be enabled for specific resources depends on the context and requirements of each organization and environment.

## Rationale

A lack of monitoring reduces the visibility into the data plane, and therefore an organization's ability to detect reconnaissance, authorization attempts or other malicious activity. Unlike Activity Logs, Resource Logs are not enabled by default. Specifically, without monitoring it would be impossible to tell which entities had accessed a data store that was breached. In addition, alerts for failed attempts to access APIs for Web Services or Databases are only possible when logging is enabled.

This recommendation's Level 1 profile is dependent upon the free level of retention of 30 days. More than 30 days retention of resource logs will increase the cost of this recommendation.

## Impact

Costs for monitoring varies with Log Volume. Not every resource needs to have logging enabled. It is important to determine the security classification of the data being processed by the given resource and adjust the logging based on which events need to be tracked. This is typically determined by governance and compliance requirements.

## Audit Procedure

### Using Azure Portal

The specific steps for configuring resources within the Azure console vary depending on resource, but typically the steps are:

1. Go to the resource.
2. Click on Diagnostic settings.
3. In the blade that appears, click "Add diagnostic setting".
4. Configure the diagnostic settings.
5. Click on Save.

### Using Azure CLI

List all `resources` for a `subscription`:

```bash
az resource list --subscription <subscription id>
```

For each `resource` run the following:

```bash
az monitor diagnostic-settings list --resource <resource ID>
```

An empty result means a `diagnostic settings` is not configured for that resource. An error message means a `diagnostic settings` is not supported for that resource.

### Using PowerShell

Get a list of `resources` in a `subscription` context and store in a variable:

```powershell
$resources = Get-AzResource
```

Loop through each `resource` to determine if a diagnostic setting is configured or not:

```powershell
foreach ($resource in $resources) {$diagnosticSetting = Get-AzDiagnosticSetting -ResourceId $resource.id -ErrorAction "SilentlyContinue"; if ([string]::IsNullOrEmpty($diagnosticSetting)) {$message = "Diagnostic Settings not configured for resource: " + $resource.Name;Write-Output $message}else{$diagnosticSetting}}
```

A result of `Diagnostic Settings not configured for resource: <resource name>` means a `diagnostic settings` is not configured for that resource. Otherwise, the output of the above command will show configured `Diagnostic Settings` for a resource.

## Expected Result

All resources that support diagnostic settings should have resource logging enabled with appropriate retention periods configured.

## Remediation

### Remediate from Azure Portal

The specific steps for configuring resources within the Azure console vary depending on resource, but typically the steps are:

1. Go to the resource.
2. Click on Diagnostic settings.
3. In the blade that appears, click "Add diagnostic setting".
4. Configure the diagnostic settings.
5. Click on Save.

### Remediate from Azure CLI

For each `resource`, run the following making sure to use a `resource` appropriate JSON encoded `category` for the `--logs` option.

```bash
az monitor diagnostic-settings create --name <diagnostic settings name> --resource <resource ID> --logs "[{category:<resource specific category>,enabled:true,retention-policy:{enabled:true,days:180}}]" --metrics "[{category:AllMetrics,enabled:true,retention-policy:{enabled:true,days:180}}]" <[--event-hub <event hub ID> --event-hub-rule <event hub auth rule ID> | --storage-account <storage account ID> |--workspace <log analytics workspace ID> | --marketplace-partner-id <full resource ID of third-party solution>]>
```

### Remediate from PowerShell

Create the `log` settings object:

```powershell
$logSettings = @()
$logSettings += New-AzDiagnosticSettingLogSettingsObject -Enabled $true -RetentionPolicyDay 180 -RetentionPolicyEnabled $true -Category <resource specific category>
$logSettings += New-AzDiagnosticSettingLogSettingsObject -Enabled $true -RetentionPolicyDay 180 -RetentionPolicyEnabled $true -Category <resource specific category number 2>
```

Create the `metric` settings object:

```powershell
$metricSettings = @()
$metricSettings += New-AzDiagnosticSettingMetricSettingsObject -Enabled $true -RetentionPolicyDay 180 -RetentionPolicyEnabled $true -Category AllMetrics
```

Create the diagnostic setting for a specific resource:

```powershell
New-AzDiagnosticSetting -Name "<diagnostic settings name>" -ResourceId <resource ID> -Log $logSettings -Metric $metricSettings
```

## Default Value

By default, Azure Monitor Resource Logs are 'Disabled' for all resources.

## References

1. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-5-centralize-security-log-management-and-analysis
3. https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/monitor-azure-resource
4. Supported Log Categories: https://learn.microsoft.com/en-us/azure/azure-monitor/reference/logs-index
5. Logs and Audit - Fundamentals: https://learn.microsoft.com/en-us/azure/security/fundamentals/log-audit
6. Collecting Logs: https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/activity-log
7. Key Vault Logging: https://learn.microsoft.com/en-us/azure/key-vault/general/logging
8. Monitor Diagnostic Settings: https://learn.microsoft.com/en-us/cli/azure/monitor/diagnostic-settings
9. Overview of Diagnostic Logs: https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/data-sources
10. Supported Services for Diagnostic Logs: https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/resource-logs-schema
11. Diagnostic Logs for CDNs: https://learn.microsoft.com/en-us/azure/cdn/cdn-azure-diagnostic-logs

## Additional Information

For an up-to-date list of Azure resources which support Azure Monitor, refer to the "Supported Log Categories" reference.

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs |      | x    | x    |
| v8               | 8.9 Centralize Audit Logs       |      | x    | x    |
| v7               | 6.3 Enable Detailed Logging     |      | x    | x    |
| v7               | 6.5 Central Log Management      |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1485                       | TA0040  | M1053       |

## Profile

Level 1 | Manual
