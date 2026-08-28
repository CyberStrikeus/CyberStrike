---
name: cis-azure-compute-15.7
description: "Ensure Diagnostics settings logs for Batch accounts are enabled"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, batch]
cis_id: "15.7"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Diagnostics settings logs for Batch accounts are enabled

## Description

Azure Batch resource logs give important operational data such as job scheduling, pool management, and node communication. Having these logs enabled is necessary for monitoring, troubleshooting, and compliance auditing.

## Rationale

Enable resource logging for:

- Operational Visibility -- Keep track of any job failures, node allocation issues, or API activities.
- Security Compliance -- Needed for audits (ISO 27001, SOC 2, GDPR).
- Forensic Investigations -- Acts as evidence in case of security incidents or performance bottlenecks.

## Impact

Costs for monitoring varies with Log Volume and storage destination. Not every resource needs to have logging enabled. It is important to determine the security classification of the data being processed by the given resource and adjust the logging based on which events need to be tracked. This is typically determined by governance and compliance requirements.

Retention is not addressed in this recommendation and should be considered depending on the needs of your organization. A 30-day minimum is recommended and longer may be required depending on the security or compliance framework your organization is following.

## Audit Procedure

### Using Azure Portal

1. Login to Azure portal `https://portal.azure.com`
2. Go to `Batch Accounts`

For each Batch account perform the following:

1. Expand the `Monitoring` section and click on `Diagnostic settings`

If no named `Diagnostic setting` exists in the table, the configuration fails this audit procedure.

Review the named `Diagnostics settings` in the table to ensure that the following categories are enabled:

- ServiceLog (Tracks Batch service operations)
- AuditLog (Records management-plane activities)

Ensure that each is configured to send to a valid destination:

- Log Analytics workspace (Recommended for querying)
- Storage account (For long-term retention)
- Event Hub (For real-time streaming)

### Using Azure CLI

```bash
az batch account list --query "[].id" | xargs -I {} az monitor diagnostic-settings list --resource {} --query "value[].{account:{split('/')[8]}, name:name, enabled:logs[?enabled]}" -o tsv
```

### Using Azure PowerShell

```powershell
Get-AzBatchAccount | ForEach-Object {
    $settings = Get-AzDiagnosticSetting -ResourceId $_.Id
    [PSCustomObject]@{
        AccountName = $_.AccountName
        HasDiagnostics = ($settings -ne $null)
        LogsEnabled = ($settings.Logs | Where-Object Enabled).Count -gt 0
    }
}
```

## Expected Result

Each Batch account should have Diagnostic settings configured with ServiceLog and AuditLog categories enabled, sending to at least one valid destination (Log Analytics workspace, Storage account, or Event Hub).

## Remediation

### Using Azure Portal

1. Login to Azure portal `https://portal.azure.com`
2. Go to `Batch Accounts`

For each Batch account perform the following:

1. Expand the `Monitoring` section and click on `Diagnostic settings`
2. Click `+Add diagnostic setting`
3. Enter an appropriate name, then ensure that the following categories are checked:
   - ServiceLog (Tracks Batch service operations)
   - AuditLog (Records management-plane activities)
4. Configure to send to a valid destination based on what is used within your tenant:
   - Log Analytics workspace (Recommended for querying)
   - Storage account (For long-term retention)
   - Event Hub (For real-time streaming)
5. Click `Save`

### Using Azure CLI

```bash
az monitor diagnostic-settings create \
  --name "<batch_logs_name>" \
  --resource $(az batch account show --name <batch_account_name> --resource-group <resource_group_name> --query id -o tsv) \
  --logs '[{"category": "AuditLog", "enabled": true}, {"category": "ServiceLog", "enabled": true}]' \
  --workspace $(az monitor log-analytics workspace show --resource-group <resource_group_name> --name <workspace_name> --query id -o tsv) \
```

### Using Azure PowerShell

```powershell
$batchAccountId = (Get-AzBatchAccount -AccountName "<batch_account_name>" -ResourceGroupName "<resource_group_name>").Id
New-AzDiagnosticSetting -Name "BatchLogs" -ResourceId $batchAccountId -Log @(@{Category="AuditLog";Enabled=$true}, @{Category="ServiceLog";Enabled=$true}) -WorkspaceId (Get-AzOperationalInsightsWorkspace -Name "<workspace_name>").ResourceId
```

## Default Value

Resource logs are not configured by default.

## References

1. https://learn.microsoft.com/en-us/azure/batch/monitoring-overview#diagnostic-logs
2. https://learn.microsoft.com/en-us/azure/batch/batch-diagnostics#service-logs

## Profile

Level 1 | Automated
