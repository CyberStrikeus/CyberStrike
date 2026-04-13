---
name: cis-gworkspace-4.3.1
description: "Ensure the Dashboard is reviewed regularly for anomalies"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, security-center, monitoring, dashboard]
cis_id: "4.3.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.3.1 Ensure the Dashboard is reviewed regularly for anomalies

## Profile Applicability

- Enterprise Level 1

## Description

As an administrator, you can use the security dashboard to see an overview of different security reports. By default, each security report panel displays data from the last 7 days. You can customize the dashboard to view data from Today, Yesterday, This week, Last week, This month, Last month, or Days ago (up to 180 days).

Charts/reports available (Minimum, but could be many more depending on account type):

- DLP incidents
- Top policy incidents
- Failed device password attempts
- Compromised device events
- Suspicious device activities
- OAuth scope grants by product (beta customers only)
- OAuth grant activity
- OAuth grants to new apps
- User login attempts -- Challenge method
- User login attempts -- Failed
- User login attempts -- Suspicious

Details on what each of these charts/reports mean can be found in Google documentation. This report should be reviewed weekly.

**NOTE:** The availability of each individual report on the security dashboard depends on your Google Workspace edition. See Google documentation for more details.

**NOTE:** In larger organizations reviewing this entire report weekly may not be possible. At a minimum, all Administrator and Super Administrator users should be reviewed, since they are a higher risk. These can be filtered from the overall user list.

## Rationale

The Security report provides a comprehensive view of how people share and access data and whether they take appropriate security precautions. For example, you can review who installs external apps, shares numerous files, skips 2-Step Verification, and uses security keys.

## Impact

No user impact.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator.
2. Select `Reporting`
3. Select `Reports`
4. Select `User Reports`
5. Select `Security`, and a table of results will be displayed with the fields listed in the Recommendation description above.
6. Review the displayed users and values for anomalies

## Remediation

The remediation for any anomalies in the various fields varies widely (different sections of the Google Workspace Admin UI). Please refer to Google's documentation for specifics.

**NOTE:** Many of these settings will be remedied by implementing other sections of this Benchmark. For example, an Admin not enrolled in 2-Step Verification can be remedied by implementing the Remediation procedure for the recommendation **Ensure 2-Step Verification (Multi-Factor Authentication) is enforced for all users in administrative roles**.

## Default Value

The report will display all users and fields.

## References

1. https://apps.google.com/supportwidget/articlehome?article_url=https%3A%2F%2Fsupport.google.com%2Fa%2Fanswer%2F7492330&assistant_id=generic-unu&product_context=7492330&product_name=UnuFlow&trigger_context=a

## CIS Controls

| Controls Version | Control                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------ | ---- | ---- | ---- |
| v8               | 8.11 Conduct Audit Log Reviews |      | x    | x    |
| v7               | 6.7 Regularly Review Logs      |      | x    | x    |
