---
name: cis-azure-foundations-6.1.3.1
description: "Ensure Application Insights are Configured"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, application-insights, app-monitoring]
cis_id: "6.1.3.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Application Insights are Configured

## Description

Application Insights within Azure act as an Application Performance Monitoring solution providing valuable data into how well an application performs and additional information when performing incident response. The types of log data collected include application metrics, telemetry data, and application trace logging data providing organizations with detailed information about application activity and application transactions. Both data sets help organizations adopt a proactive and retroactive means to handle security and performance related metrics within their modern applications.

## Rationale

Configuring Application Insights provides additional data not found elsewhere within Azure as part of a much larger logging and monitoring program within an organization's Information Security practice. The types and contents of these logs will act as both a potential cost saving measure (application performance) and a means to potentially confirm the source of a potential incident (trace logging). Metrics and Telemetry data provide organizations with a proactive approach to cost savings by monitoring an application's performance, while the trace logging data provides necessary details in a reactive incident response scenario by helping organizations identify the potential source of an incident within their application.

## Impact

Because Application Insights relies on a Log Analytics Workspace, an organization will incur additional expenses when using this service.

## Audit Procedure

### Using Azure Portal

1. Navigate to `Application Insights`.
2. Ensure an `Application Insights` service is configured and exists.

### Using Azure CLI

```bash
az monitor app-insights component show --query "[].{ID:appId, Name:name, Tenant:tenantId, Location:location, Provisioning_State:provisioningState}"
```

Ensure the above command produces output, otherwise `Application Insights` has not been configured.

### Using PowerShell

```powershell
Get-AzApplicationInsights|select location,name,appid,provisioningState,tenantid
```

## Expected Result

At least one Application Insights resource should be configured and exist with a successful provisioning state.

## Remediation

### Remediate from Azure Portal

1. Navigate to `Application Insights`.
2. Under the `Basics` tab within the `PROJECT DETAILS` section, select the `Subscription`.
3. Select the `Resource group`.
4. Within the `INSTANCE DETAILS`, enter a `Name`.
5. Select a `Region`.
6. Next to `Resource Mode`, select `Workspace-based`.
7. Within the `WORKSPACE DETAILS`, select the `Subscription` for the log analytics workspace.
8. Select the appropriate `Log Analytics Workspace`.
9. Click `Next:Tags >`.
10. Enter the appropriate `Tags` as `Name`, `Value` pairs.
11. Click `Next:Review+Create`.
12. Click `Create`.

### Remediate from Azure CLI

```bash
az monitor app-insights component create --app <app name> --resource-group <resource group name> --location <location> --kind "web" --retention-time <INT days to retain logs> --workspace <log analytics workspace ID> --subscription <subscription ID>
```

### Remediate from PowerShell

```powershell
New-AzApplicationInsights -Kind "web" -ResourceGroupName <resource group name> -Name <app insights name> -location <location> -RetentionInDays <INT days to retain logs> -SubscriptionID <subscription ID> -WorkspaceResourceId <log analytics workspace ID>
```

## Default Value

Application Insights are not enabled by default.

## References

1. https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 8.2 Collect Audit Logs | x | x | x |
| v7 | 6.2 Activate audit logging | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1606 | TA0006 | M1047 |

## Profile

Level 2 | Automated
