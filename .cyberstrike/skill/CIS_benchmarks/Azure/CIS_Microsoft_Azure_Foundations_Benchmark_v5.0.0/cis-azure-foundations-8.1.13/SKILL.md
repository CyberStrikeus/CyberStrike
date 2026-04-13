---
name: cis-azure-foundations-8.1.13
description: "Ensure 'Additional email addresses' for the subscription is configured with a security contact email"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, security, defender, email-notifications]
cis_id: "8.1.13"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.13 Ensure 'Additional email addresses' for the subscription is configured with a security contact email (Automated)

## Description

Ensure that additional email addresses are configured for the subscription's security contact settings in Microsoft Defender for Cloud, so that security alerts are sent to multiple designated recipients beyond just the subscription owner.

## Rationale

Configuring additional email addresses for security alerts ensures that multiple stakeholders receive notifications about security events. Relying solely on the subscription owner for alert notifications creates a single point of failure. If the owner is unavailable, critical alerts may be missed. By adding additional security contacts, organizations ensure broader coverage and faster incident response times.

## Impact

Adding additional email addresses has minimal technical impact. Recipients will receive security alert emails, which may increase email volume depending on the environment. Organizations should ensure all listed contacts are relevant security personnel who can act on the alerts.

## Audit Procedure

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Email notifications` blade.
5. Verify that the `Additional email addresses` field contains one or more valid email addresses (separated by semicolons).

**From Azure CLI:**
```
az rest --method get --url "https://management.azure.com/subscriptions/{subscriptionId}/providers/Microsoft.Security/securityContacts?api-version=2020-01-01-preview"
```
Verify that the `emails` property contains additional email addresses beyond the subscription owner.

**From PowerShell:**
```
Get-AzSecurityContact | Select-Object Name, Email
```
Ensure the `Email` field contains additional email addresses.

## Expected Result

The `Additional email addresses` field should contain at least one valid email address for a security contact.

## Remediation

**From Azure Portal:**
1. Go to `Microsoft Defender for Cloud`.
2. Under `Management`, click `Environment settings`.
3. Click the name of a subscription.
4. Select the `Email notifications` blade.
5. In the `Additional email addresses` field, enter the email addresses of security contacts separated by semicolons (e.g., `security@example.com;soc@example.com`).
6. Click `Save`.

**From Azure CLI:**
```
az rest --method put --url "https://management.azure.com/subscriptions/{subscriptionId}/providers/Microsoft.Security/securityContacts/default?api-version=2020-01-01-preview" --body '{"properties":{"emails":"security@example.com;soc@example.com","alertNotifications":{"state":"On","minimalSeverity":"High"}}}'
```

**From PowerShell:**
```
Set-AzSecurityContact -Name "default" -Email "security@example.com;soc@example.com" -AlertAdmin -NotifyOnAlert
```

## Default Value

By default, no additional email addresses are configured for security alert notifications.

## References

1. https://learn.microsoft.com/en-us/azure/defender-for-cloud/configure-email-notifications
2. https://learn.microsoft.com/en-us/rest/api/defenderforcloud/security-contacts
3. https://learn.microsoft.com/en-us/powershell/module/az.security/set-azsecuritycontact

## Profile

- Level 1
