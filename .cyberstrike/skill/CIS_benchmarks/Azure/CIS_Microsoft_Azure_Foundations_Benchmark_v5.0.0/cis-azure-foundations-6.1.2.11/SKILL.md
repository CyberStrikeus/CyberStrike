---
name: cis-azure-foundations-6.1.2.11
description: "Ensure that an Activity Log Alert exists for Service Health"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, activity-log-alerts, service-health]
cis_id: "6.1.2.11"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that an Activity Log Alert exists for Service Health

## Description

Create an activity log alert for Service Health.

## Rationale

Monitoring for Service Health events provides insight into service issues, planned maintenance, security advisories, and other changes that may affect the Azure services and regions in use.

## Impact

There is no charge for creating activity log alert rules.

## Audit Procedure

### Using Azure Portal

1. Go to `Monitor`.
2. Click `Alerts`.
3. Click `Alert rules`.
4. Ensure an alert rule exists for a subscription with `Condition` set to `Service names=All, Event types=All` and `Target resource type` set to `Subscription`.
5. If an alert rule is found for step 4, click the name of the alert rule.
6. Ensure the `Actions` panel displays an action group configured to notify appropriate personnel.
7. Repeat steps 1-6 for each subscription.

### Using Azure CLI

Run the following command to list activity log alerts:

```bash
az monitor activity-log alert list --subscription <subscription-id>
```

For each activity log alert, run the following command:

```bash
az monitor activity-log alert show --subscription <subscription-id> --resource-group <resource-group> --activity-log-alert-name <activity-log-alert>
```

Ensure an alert exists for `ServiceHealth` with `scopes` set to a subscription ID.

Repeat for each subscription.

### Using PowerShell

Run the following command to locate `ServiceHealth` alert rules for a subscription:

```powershell
Get-AzActivityLogAlert -SubscriptionId <subscription-id> | where-object {$_.ConditionAllOf.Equal -match "ServiceHealth"} | select-object Location,Name,Enabled,ResourceGroupName,ConditionAllOf
```

Ensure that at least one `ServiceHealth` alert rule is returned.

Repeat for each subscription.

## Expected Result

An activity log alert rule should exist for Service Health with `ServiceHealth` category and an action group assigned to notify appropriate personnel.

## Remediation

### Remediate from Azure Portal

1. Go to `Monitor`.
2. Click `Alerts`.
3. Click `+ Create`.
4. Select `Alert rule` from the drop-down menu.
5. Choose a subscription.
6. Click `Apply`.
7. Select the `Condition` tab.
8. Click `See all signals`.
9. Select `Service health`.
10. Click `Apply`.
11. Open the drop-down menu next to `Event types`.
12. Check the box next to `Select all`.
13. Select the `Actions` tab.
14. Click `Select action groups` to select an existing action group, or `Create action group` to create a new action group.
15. Follow the prompts to choose or create an action group.
16. Select the `Details` tab.
17. Select a `Resource group`, provide an `Alert rule name` and an optional `Alert rule description`.
18. Click `Review + create`.
19. Click `Create`.
20. Repeat steps 1-19 for each subscription requiring remediation.

### Remediate from Azure CLI

For each subscription requiring remediation, run the following command to create a `ServiceHealth` alert rule for a subscription:

```bash
az monitor activity-log alert create --subscription <subscription-id> --resource-group <resource-group> --name <alert-rule> --condition category=ServiceHealth and properties.incidentType=Incident --scope /subscriptions/<subscription-id> --action-group <action-group>
```

### Remediate from PowerShell

Create the `Conditions` object:

```powershell
$conditions = @()
$conditions += New-AzActivityLogAlertAlertRuleAnyOfOrLeafConditionObject -Field category -Equal ServiceHealth
$conditions += New-AzActivityLogAlertAlertRuleAnyOfOrLeafConditionObject -Field properties.incidentType -Equal Incident
```

Retrieve the `Action Group` information and store in a variable:

```powershell
$actionGroup = Get-AzActionGroup -ResourceGroupName <resource-group> -Name <action-group>
$actionObject = New-AzActivityLogAlertActionGroupObject -Id $actionGroup.Id
```

Create the `Scope` object:

```powershell
$scope = "/subscriptions/<subscription-id>"
```

Create the activity log alert rule:

```powershell
New-AzActivityLogAlert -Name <alert-rule> -ResourceGroupName <resource-group> -Condition $conditions -Scope $scope -Location global -Action $actionObject -Subscription <subscription-id> -Enabled $true
```

Repeat for each subscription requiring remediation.

## Default Value

By default, no monitoring alerts are created.

## References

1. https://learn.microsoft.com/en-us/azure/service-health/overview
2. https://learn.microsoft.com/en-us/azure/service-health/alerts-activity-log-service-notifications-portal
3. https://azure.microsoft.com/en-us/pricing/details/monitor/#faq
4. https://learn.microsoft.com/en-us/cli/azure/monitor/activity-log/alert
5. https://learn.microsoft.com/en-us/powershell/module/az.monitor/get-azactivitylogalert
6. https://learn.microsoft.com/en-us/powershell/module/az.monitor/new-azactivitylogalert

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs |      | x    | x    |
| v7               | 6.3 Enable Detailed Logging     |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
|                             |         | M1047       |

## Profile

Level 1 | Automated
