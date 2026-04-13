---
name: cis-azure-foundations-8.1.14
description: "Ensure That 'Notify about alerts with the following severity' is Set to 'High'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, alert-notifications]
cis_id: "8.1.14"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.14 Ensure That 'Notify about alerts with the following severity' is Set to 'High' (Automated)

## Description

Ensure that Microsoft Defender for Cloud is configured to send email notifications for alerts with a severity level of 'High' or above, ensuring that critical security threats are promptly communicated to the security team.

## Rationale

Configuring alert notifications to trigger on 'High' severity ensures that the most critical security threats are escalated via email. High severity alerts typically indicate active threats, successful exploitation, or critical misconfigurations that require immediate attention. Without proper notification thresholds, security teams may miss critical alerts or be overwhelmed by lower-priority notifications.

## Impact

Setting the notification threshold to 'High' will result in email notifications only for high-severity alerts. Medium and low severity alerts will still be visible in the Defender for Cloud portal but will not trigger email notifications. Organizations should ensure they have processes to review lower-severity alerts through the portal or other monitoring channels.

## Audit Procedure

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Email notifications` blade.
5. Verify that `Notify about alerts with the following severity (or higher)` is set to `High`.

**From Azure CLI:**
```
az rest --method get --url "https://management.azure.com/subscriptions/{subscriptionId}/providers/Microsoft.Security/securityContacts?api-version=2020-01-01-preview"
```
Verify that `alertNotifications.minimalSeverity` is set to `High`.

**From PowerShell:**
```
Get-AzSecurityContact | Select-Object Name, AlertNotifications
```
Ensure `AlertNotifications` is enabled and the minimal severity is set to `High`.

## Expected Result

The alert notification severity threshold should be set to `High`.

## Remediation

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Email notifications` blade.
5. Set `Notify about alerts with the following severity (or higher)` to `High`.
6. Click `Save`.

**From Azure CLI:**
```
az rest --method put --url "https://management.azure.com/subscriptions/{subscriptionId}/providers/Microsoft.Security/securityContacts/default?api-version=2020-01-01-preview" --body '{"properties":{"alertNotifications":{"state":"On","minimalSeverity":"High"}}}'
```

**From PowerShell:**
```
Set-AzSecurityContact -Name "default" -AlertAdmin -NotifyOnAlert
```

## Default Value

By default, email notifications for security alerts are not configured.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/configure-email-notifications
2. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/security-contacts
3. https://learn.microsoft.com/en-us/powershell/module/az.security/set-azsecuritycontact

## Profile

- Level 1
