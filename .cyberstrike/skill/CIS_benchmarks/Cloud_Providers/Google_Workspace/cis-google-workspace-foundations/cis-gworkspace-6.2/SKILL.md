---
name: cis-gworkspace-6.2
description: "Ensure Government-backed attacks is configured"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, rules, alerts, government-attacks]
cis_id: "6.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2 Ensure Government-backed attacks is configured

## Profile Applicability

- Enterprise Level 1

## Description

Configuring and enabling the setting that an alert will be generated when Google believes your users are being targeted by a government-backed attack.

## Rationale

Ensuring that administrators are alerted that they may be being targeted by a government-backed entity allows them time to check their defenses and potentially up their sensitivity for anomalies.

**NOTE:** Google sends these out of an abundance of caution -- the notice does not necessarily mean that the account has been compromised or that there is a widespread attack. Rather, the notice reflects Google's assessment that a government-backed attacker has likely attempted to access the user's account or computer through phishing or malware, for example.

## Impact

This setting should have no impact on the end user but will send emails to super administrators when triggered.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator.
2. Select **Rules**.
3. Under **Google protects you by default** select **View list**.
4. Scroll to **Government-backed attacks** and select it.
5. Ensure that **Alerts** is set to **On**.
6. Ensure the **Severity** is set to **High**.
7. Ensure that **Email Notifications** is set to **On**.
8. Ensure that **Email notification recipients** is set to **All super administrators**.

## Remediation

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator.
2. Select **Rules**.
3. Under **Google protects you by default** select **View list**.
4. Scroll to **Government-backed attacks** and select it.
5. Within the **Actions** pane, click the edit pencil on the right side of the pane.
6. Select **Send to alert center** (This will result in the alert being set to On).
7. Set the alert severity to **High**.
8. To enable emails when this alert condition is met, select **Send email notifications**. Once enabled, the **All super administrators** option is selected by default.
9. Click **Review** to confirm the values.
10. Click **Update Rule**.
11. Confirm that the **Government-backed attacks** shows an Alert status of **On** in the list.

## Default Value

Government-backed attacks is **ON**.

## References

1. https://support.google.com/a/answer/3230421

## CIS Controls

| Controls Version | Control                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------- | ---- | ---- | ---- |
| v7               | 16.13 Alert on Account Login Behavior Deviation |      |      | x    |
