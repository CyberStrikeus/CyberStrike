---
name: cis-azure-foundations-2.1.7
description: "Ensure diagnostic log delivery is configured for Azure Databricks"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, databricks, analytics]
cis_id: "2.1.7"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure diagnostic log delivery is configured for Azure Databricks

## Description

Azure Databricks Diagnostic Logging provides insights into system operations, user activities, and security events within a Databricks workspace. Enabling diagnostic logs helps organizations:

- Detect security threats by logging access, job executions, and cluster activities.
- Ensure compliance with industry regulations such as SOC 2, HIPAA, and GDPR.
- Monitor operational performance and troubleshoot issues proactively.

## Rationale

Diagnostic logging provides visibility into security and operational activities within Databricks workspaces while maintaining an audit trail for forensic investigations, and it supports compliance with regulatory standards that require logging and monitoring.

## Impact

Logs consume storage and may require additional monitoring tools, leading to increased operational overhead and costs. Incomplete log configurations may result in missing critical events, reducing monitoring effectiveness.

## Audit Procedure

### Audit from Azure Portal

Check if diagnostic logging is enabled for the Databricks workspace:

1. Go to `Azure Databricks`.
2. Select a workspace.
3. In the left-hand menu, select `Monitoring` > `Diagnostic settings`.
4. Verify if a diagnostic setting is configured. If not, diagnostic logging is not enabled.

Ensure that logging is enabled for the following categories:

- `accounts`: User account activities.
- `Filesystem`: Databricks Filesystem Logs.
- `clusters`: Cluster state changes and errors.
- `notebook`: Execution events.
- `jobs`: Job execution tracking.

Verify that logs are being sent to one or more of the following destinations:

- `Azure Log Analytics workspace`: For analysis and querying.
- `Azure Storage Account`: For long-term retention.
- `Azure Event Hubs`: For integration with SIEM tools.

### Audit from Azure CLI

Check if diagnostic logging is enabled for the Databricks workspace:

```bash
az monitor diagnostic-settings list --resource <databricks-resource-id>
```

If the output is empty, no diagnostic settings are configured.

Verify log categories being collected:

```bash
az monitor diagnostic-settings show --name <setting-name> --resource <databricks-resource-id>
```

Review the output to confirm that the necessary log categories are enabled.

Check if logs are stored securely in an approved location:

```bash
az monitor diagnostic-settings list --resource <databricks-resource-id>
```

Review the storageAccountId, workspaceId, and eventHubAuthorizationRuleId fields in the output to confirm the log destinations.

### Audit from PowerShell

Check if diagnostic logging is enabled for the Databricks workspace:

```powershell
Get-AzDiagnosticSetting -ResourceId <databricks-resource-id>
```

An empty result indicates that diagnostic logging is not enabled.

### Audit from Azure Policy

- **Policy ID:** `138ff14d-b687-4faa-a81c-898c91a87fa2` - **Name:** 'Resource logs in Azure Databricks Workspaces should be enabled'

## Expected Result

Diagnostic settings should be configured with all required log categories enabled. Logs should be delivered to at least one approved destination (Log Analytics, Storage Account, or Event Hubs).

## Remediation

### Remediate from Azure Portal

Enable diagnostic logging for Azure Databricks:

1. Navigate to your Azure Databricks workspace.
2. In the left-hand menu, select `Monitoring` > `Diagnostic settings`.
3. Click `+ Add diagnostic setting`.
4. Under `Category details`, select the log categories you wish to capture, such as AuditLogs, Clusters, Notebooks, and Jobs.
5. Choose a destination for the logs:
   - `Log Analytics workspace`: For advanced querying and monitoring.
   - `Storage account`: For long-term retention.
   - `Event Hub`: For integration with third-party systems.
6. Provide a `Name` for the diagnostic setting.
7. Click `Save`.

Implement log retention policies:

1. Navigate to your Log Analytics workspace.
2. Under `General`, select `Usage and estimated costs`.
3. Click `Data Retention`.
4. Adjust the retention period slider to the desired number of days (up to 730 days).
5. Click `OK`.

Monitor logs for anomalies:

1. Navigate to `Azure Monitor`.
2. Select `Alerts` > `+ New alert rule`.
3. Under `Scope`, specify the Databricks resource.
4. Define `Condition` based on log queries that identify anomalies (e.g. unauthorized access attempts).
5. Configure `Actions` to notify stakeholders or trigger automated responses.
6. Provide an Alert rule `name` and `description`.
7. Click `Create alert rule`.

### Remediate from Azure CLI

Enable diagnostic logging for Azure Databricks:

```bash
az monitor diagnostic-settings create --name "DatabricksLogging" --resource <databricks-resource-id> --logs '[{"category": "accounts", "enabled": true}, {"category": "Clusters", "enabled": true}, {"category": "Notebooks", "enabled": true}, {"category": "Jobs", "enabled": true}]' --workspace <log-analytics-id>
```

Implement log retention policies:

```bash
az monitor log-analytics workspace update --resource-group <resource-group> --name <log-analytics-name> --retention-time 365
```

Monitor logs for anomalies:

```bash
az monitor activity-log alert create --name "DatabricksAnomalyAlert" --resource-group <resource-group> --scopes <databricks-resource-id> --condition "contains 'UnauthorizedAccess'"
```

## Default Value

By default, diagnostic logging is not enabled for Azure Databricks workspaces.

## References

1. https://learn.microsoft.com/en-us/azure/databricks/admin/account-settings/audit-log-delivery
2. https://learn.microsoft.com/en-us/troubleshoot/azure/azure-monitor/log-analytics/billing/configure-data-retention
3. https://docs.azure.cn/en-us/databricks/admin/account-settings/audit-logs
4. https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-logs/microsoft-databricks-workspaces-logs

## Additional Information

- Ensure that the Azure Databricks workspace is on the Premium plan to utilize diagnostic logging features.
- Regularly review and update alert rules to adapt to evolving security threats and operational requirements.

## CIS Controls

| Controls Version | Control                    | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs     | x    | x    | x    |
| v7               | 6.2 Activate audit logging | x    | x    | x    |

## Profile

Level 1 | Automated
