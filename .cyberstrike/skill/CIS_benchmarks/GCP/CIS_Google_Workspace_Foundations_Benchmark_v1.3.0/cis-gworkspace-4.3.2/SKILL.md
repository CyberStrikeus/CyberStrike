---
name: cis-gworkspace-4.3.2
description: "Ensure the Security health is reviewed regularly for anomalies"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, security-center, monitoring, security-health]
cis_id: "4.3.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.3.2 Ensure the Security health is reviewed regularly for anomalies

## Profile Applicability

- Enterprise Level 1

## Description

As an administrator, the security health page enables you to monitor the configuration of your Admin console settings from one location. For example, you can check the status of settings like automatic email forwarding, device encryption, Drive sharing settings, and much more.

Settings reported (Minimum, but could be many more depending on account type):

- Blocking of compromised mobile devices
- Mobile management
- Mobile password requirements
- Device encryption
- Mobile inactivity reports
- Auto account wipe
- Application verification
- Installation of mobile applications from unknown sources
- External media storage
- Two-step verification for users
- Two-step verification for admins
- Security key enforcement for admins

Details on what each of these report entries mean can be found in Google documentation. This report should be reviewed weekly.

**NOTE:** The availability of each individual report on the security dashboard depends on your Google Workspace edition. See Google documentation for more details.

## Rationale

The security health page provides visibility into your Admin console settings to help you better understand and manage security risks. If needed, you can make adjustments to your domain's settings based on general security guidelines and best practices, while balancing these guidelines with your organization's business needs and risk management policy.

## Impact

No user impact.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Security Center`
4. Select `Security Health`
5. Review the security health page for any anomalies or settings that are not configured according to your organization's security policies

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Security Center`
4. Select `Security Health`
5. Review each setting and follow the recommended actions for any items flagged as requiring attention
6. Refer to Google's documentation for specific remediation steps for each setting

## Default Value

The security health page displays all monitored settings and their current status.
