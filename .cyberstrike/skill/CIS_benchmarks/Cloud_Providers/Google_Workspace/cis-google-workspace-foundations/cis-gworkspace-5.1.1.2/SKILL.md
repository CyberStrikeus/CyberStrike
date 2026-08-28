---
name: cis-gworkspace-5.1.1.2
description: "Ensure the Security Report is reviewed regularly for anomalies"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, reporting, security-report, anomalies, monitoring]
cis_id: "5.1.1.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1.2 Ensure the Security Report is reviewed regularly for anomalies

## Profile Applicability

- Enterprise Level 1

## Description

As your organization's administrator, you can monitor your users' exposure to data compromise by reviewing the security report.

Fields Available:

- User
- External apps
- 2-Step verification enrollment
- 2-Step verification enforcement
- Password length compliance
- Password strength
- User account status
- Admin status
- Security keys enrolled
- Less secure apps access
- Gmail (IMAP) - last used time
- Gmail (POP) - last used time
- Gmail (Web) - last used time
- External shares
- Internal shares
- Public
- Anyone with link
- Outside domain
- Anyone in domain shares
- Anyone in domain with link shares
- Within domain shares
- Private shares

This report should be reviewed weekly.

**NOTE:** In larger organizations reviewing this entire report weekly may not be possible. At a minimum, all Administrator and Super Administrator users should be reviewed, since they are a higher risk. These can be filtered from the overall user list.

## Rationale

The Security report provides a comprehensive view of how people share and access data and whether they take appropriate security precautions. For example, you can review who installs external apps, shares numerous files, skips 2-Step Verification, and uses security keys.

## Impact

No user impact.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator.
2. Select **Reporting**.
3. Select **Reports**.
4. Select **User Reports**.
5. Select **Security**, and a table of results will be displayed with the fields listed in the Recommendation description above.
6. Review the displayed users and values for anomalies.

## Remediation

The remediation for any anomalies in the various fields varies widely (different sections of the Google Workspace Admin UI). Please refer to Google's documentation for specifics.

**NOTE:** Many of these settings will be remedied by implementing other sections of this Benchmark. For example, an Admin not enrolled in 2-Step Verification can be remedied by implementing the Remediation procedure for the recommendation _Ensure 2-Step Verification (Multi-Factor Authentication) is enforced for all users in administrative roles_.

## Default Value

The report will display all users and fields.

## References

1. https://support.google.com/a/answer/6000269

## CIS Controls

| Controls Version | Control                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------ | ---- | ---- | ---- |
| v8               | 8.11 Conduct Audit Log Reviews |      | x    | x    |
| v7               | 6.7 Regularly Review Logs      |      | x    | x    |
