---
name: cis-azure-foundations-6.1.1.4
description: "Ensure that logging for Azure Key Vault is 'Enabled'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, key-vault, diagnostic-settings]
cis_id: "6.1.1.4"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.4]
prerequisites: []
severity_boost: {}
---

# Ensure that logging for Azure Key Vault is 'Enabled'

## Description

Enable AuditEvent logging for key vault instances to ensure interactions with key vaults are logged and available.

## Rationale

Monitoring how and when key vaults are accessed, and by whom, enables an audit trail of interactions with confidential information, keys, and certificates managed by Azure Key Vault. Enabling logging for Key Vault saves information in a user provided destination of either an Azure storage account or Log Analytics workspace. The same destination can be used for collecting logs for multiple Key Vaults.

## Impact

None identified.

## Audit Procedure

### Using Azure Portal

1. Go to `Key vaults`.
2. For each Key vault, under `Monitoring`, go to `Diagnostic settings`.
3. Click `Edit setting` next to a diagnostic setting.
4. Ensure that a destination is configured.
5. Under `Category groups`, ensure that `audit` and `allLogs` are checked.

### Using Azure CLI

List all key vaults:

```bash
az keyvault list
```

For each keyvault id:

```bash
az monitor diagnostic-settings list --resource <id>
```

Ensure that `storageAccountId` reflects your desired destination and that `categoryGroup` and `enabled` are set as follows:

```json
"logs": [
  {
    "categoryGroup": "audit",
    "enabled": true,
  },
  {
    "categoryGroup": "allLogs",
    "enabled": true,
  }
]
```

### Using PowerShell

List the key vault(s) in the subscription:

```powershell
Get-AzKeyVault
```

For each key vault, run the following:

```powershell
Get-AzDiagnosticSetting -ResourceId <key_vault_id>
```

Ensure that `StorageAccountId`, `ServiceBusRuleId`, `MarketplacePartnerId`, or `WorkspaceId` is set as appropriate. Also, ensure that `enabled` is set to `true`, and that `categoryGroup` reflects both `audit` and `allLogs` category groups.

## Expected Result

All Key Vault instances should have diagnostic logging enabled with both `audit` and `allLogs` category groups sending to an appropriate destination.

## Remediation

### Remediate from Azure Portal

1. Go to `Key vaults`.
2. Select a Key vault.
3. Under `Monitoring`, select `Diagnostic settings`.
4. Click `Edit setting` to update an existing diagnostic setting, or `Add diagnostic setting` to create a new one.
5. If creating a new diagnostic setting, provide a name.
6. Configure an appropriate destination.
7. Under `Category groups`, check `audit` and `allLogs`.
8. Click `Save`.

### Remediate from Azure CLI

To create a new Diagnostic Settings:

```bash
az monitor diagnostic-settings create --name "<diagnostic_setting_name>" --resource <key_vault_id> --logs "[{category:audit,enabled:true},{category:allLogs,enabled:true}]" --metrics "[{category:AllMetrics,enabled:true}]" <[--event-hub <event_hub_ID> --event-hub-rule <event_hub_auth_rule_ID> | --storage-account <storage_account_ID> | --workspace <log_analytics_workspace_ID> | --marketplace-partner-id <solution_resource_ID>]>
```

### Remediate from PowerShell

Create the Log settings object:

```powershell
$logSettings = @()
$logSettings += New-AzDiagnosticSettingLogSettingsObject -Enabled $true -Category audit
$logSettings += New-AzDiagnosticSettingLogSettingsObject -Enabled $true -Category allLogs
```

Create the Metric settings object:

```powershell
$metricSettings = @()
$metricSettings += New-AzDiagnosticSettingMetricSettingsObject -Enabled $true -Category AllMetrics
```

Create the Diagnostic Settings for each Key Vault:

```powershell
New-AzDiagnosticSetting -Name "<diagnostic_setting_name>" -ResourceId <key_vault_id> -Log $logSettings -Metric $metricSettings [-StorageAccountId <storage_account_ID> | -EventHubName <event_hub_name> -EventHubAuthorizationRuleId <event_hub_auth_rule_ID> | -WorkSpaceId <log analytics workspace ID> | -MarketPlacePartnerId <full resource ID for third-party solution>]
```

## Default Value

By default, Diagnostic AuditEvent logging is not enabled for Key Vault instances.

## References

1. https://learn.microsoft.com/en-us/azure/key-vault/general/howto-logging
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-8-ensure-security-of-key-and-certificate-repository
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation

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
