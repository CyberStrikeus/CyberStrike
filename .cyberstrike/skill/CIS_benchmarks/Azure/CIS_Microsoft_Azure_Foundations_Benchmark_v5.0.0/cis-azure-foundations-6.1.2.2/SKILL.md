---
name: cis-azure-foundations-6.1.2.2
description: "Ensure Activity Log Alert exists for Delete Policy Assignment"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, activity-log-alerts, policy]
cis_id: "6.1.2.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.2.1]
prerequisites: []
severity_boost: {}
---

# Ensure that Activity Log Alert exists for Delete Policy Assignment

## Description

Create an activity log alert for the Delete Policy Assignment event.

## Rationale

Monitoring for delete policy assignment events gives insight into changes done in "azure policy - assignments" and can reduce the time it takes to detect unsolicited changes.

## Impact

None identified.

## Audit Procedure

### Using Azure Portal

1. Navigate to the `Monitor` blade.
2. Click on `Alerts`.
3. In the Alerts window, click on `Alert rules`.
4. Ensure an alert rule exists where the Condition column contains `Operation name=Microsoft.Authorization/policyAssignments/delete`.
5. Click on the Alert `Name` associated with the previous step.
6. Ensure the `Condition` panel displays the text `Whenever the Activity Log has an event with Category='Administrative', Operation name='Delete policy assignment'` and does not filter on `Level`, `Status` or `Caller`.
7. Ensure the `Actions` panel displays an Action group is assigned to notify the appropriate personnel in your organization.

### Using Azure CLI

```bash
az monitor activity-log alert list --subscription <subscription ID> --query "[].{Name:name,Enabled:enabled,Condition:condition.allOf,Actions:actions}"
```

Look for `Microsoft.Authorization/policyAssignments/delete` in the output.

### Using PowerShell

```powershell
Get-AzActivityLogAlert -SubscriptionId <subscription ID>|where-object {$_.ConditionAllOf.Equal -match "Microsoft.Authorization/policyAssignments/delete"}|select-object Location,Name,Enabled,ResourceGroupName,ConditionAllOf
```

## Expected Result

An activity log alert rule should exist with the operation name `Microsoft.Authorization/policyAssignments/delete` and an action group assigned.

## Remediation

### Remediate from Azure Portal

1. Navigate to the `Monitor` blade.
2. Select `Alerts`.
3. Select `Create`.
4. Select `Alert rule`.
5. Choose a subscription.
6. Select `Apply`.
7. Select the `Condition` tab.
8. Click `See all signals`.
9. Select `Delete policy assignment (Policy assignment)`.
10. Click `Apply`.
11. Select the `Actions` tab.
12. Click `Select action groups` to select an existing action group, or `Create action group` to create a new action group.
13. Follow the prompts to choose or create an action group.
14. Select the `Details` tab.
15. Select a `Resource group`, provide an `Alert rule name` and an optional `Alert rule description`.
16. Click `Review + create`.
17. Click `Create`.

### Remediate from Azure CLI

```bash
az monitor activity-log alert create --resource-group "<resource group name>" --condition category=Administrative and operationName=Microsoft.Authorization/policyAssignments/delete and level=<verbose | information | warning | error | critical> --scope "/subscriptions/<subscription ID>" --name "<activity log rule name>" --subscription <subscription id> --action-group <action group ID>
```

### Remediate from PowerShell

```powershell
$conditions = @()
$conditions += New-AzActivityLogAlertAlertRuleAnyOfOrLeafConditionObject -Equal Administrative -Field category
$conditions += New-AzActivityLogAlertAlertRuleAnyOfOrLeafConditionObject -Equal Microsoft.Authorization/policyAssignments/delete -Field operationName
$conditions += New-AzActivityLogAlertAlertRuleAnyOfOrLeafConditionObject -Equal Verbose -Field level

$actionGroup = Get-AzActionGroup -ResourceGroupName <resource group name> -Name <action group name>
$actionObject = New-AzActivityLogAlertActionGroupObject -Id $actionGroup.Id

$scope = "/subscriptions/<subscription id>"

New-AzActivityLogAlert -Name "<activity log alert rule name>" -ResourceGroupName "<resource group name>" -Condition $conditions -Scope $scope -Location global -Action $actionObject -Subscription <subscription ID> -Enabled $true
```

## Default Value

By default, no monitoring alerts are created.

## References

1. https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/alerts-create-activity-log-alert-rule
2. https://learn.microsoft.com/en-us/rest/api/monitor/activity-log-alerts/create-or-update
3. https://learn.microsoft.com/en-us/rest/api/monitor/activity-log-alerts/list-by-subscription-id
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation
5. https://azure.microsoft.com/en-us/products/blueprints/

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs |      | x    | x    |
| v7               | 6.3 Enable Detailed Logging     |      | x    | x    |

## Profile

Level 1 | Automated
