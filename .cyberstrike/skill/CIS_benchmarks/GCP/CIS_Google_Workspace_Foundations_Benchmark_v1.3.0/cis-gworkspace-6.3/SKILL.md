---
name: cis-gworkspace-6.3
description: "Ensure User suspended due to suspicious activity is configured"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, rules, alerts, suspicious-activity]
cis_id: "6.3"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3 Ensure User suspended due to suspicious activity is configured

## Profile Applicability
- Enterprise Level 1

## Description
Configuring and enabling the setting that an alert will be generated when Google suspended a user's account due to a potential compromise detected.

## Rationale
Ensuring that administrators are alerted when the account was suspended by Google. The reason for this should be investigated ASAP, since it could be a possible indication of malicious activity. In any case, the user's account was suspended and something will need to be done to allow the user to resume work.

## Impact
Emails will be sent to all super administrators when triggered. Also, the user's account will be suspended and something will need to be done about that based on company policy (investigated, re-enabled, etc.).

## Audit
To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator.
2. Select **Rules**.
3. Under **Google protects you by default** select **View list**.
4. Scroll to **User suspended due to suspicious activity** and select it.
5. Ensure that **Alerts** is set to **On**.
6. Ensure the **Severity** is set to **High**.
7. Ensure that **Email Notifications** is set to **On**.
8. Ensure that **Email notification recipients** is set to **All super administrators**.

## Remediation
To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator.
2. Select **Rules**.
3. Under **Google protects you by default** select **View list**.
4. Scroll to **User suspended due to suspicious activity** and select it.
5. Within the **Actions** pane, click the edit pencil on the right side of the pane.
6. Select **Send to alert center** (This will result in the alert being set to On).
7. Set the alert severity to **High**.
8. To enable emails when this alert condition is met, select **Send email notifications**. Once enabled, the **All super administrators** option is selected by default.
9. Click **Review** to confirm the values.
10. Click **Update Rule**.
11. Confirm that the **User suspended due to suspicious activity** shows an Alert status of **On** in the list.

## Default Value
User suspended due to suspicious activity is **ON**.

## References
1. https://support.google.com/a/answer/3230421

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v7 | 16.13 Alert on Account Login Behavior Deviation | | | x |
