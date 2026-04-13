---
name: cis-gworkspace-4.2.3.1
description: "Ensure DLP policies for Google Drive are configured"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, dlp, data-protection, google-drive]
cis_id: "4.2.3.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.3.1 Ensure DLP policies for Google Drive are configured

## Profile Applicability

- Enterprise Level 1

## Description

Enabling Data Loss Prevention (DLP) policies for Google Drive allows organizations to control the content that users can share in Google Drive files outside the organization.

## Rationale

Enabling DLP policies alerts users and administrators that specific types of data should not be exposed, helping to protect the data from accidental exposure. DLP gives you control over what users can share, and prevents unintended exposure of sensitive information such as credit card numbers or identity numbers.

## Impact

Configuring a DLP policy for Google Drive will detect or block sensitive information.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Data protection`
5. Select `Manage Rules`
6. Ensure data protection rules `exist` and are `enabled`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Data protection`
5. Select `Manage Rules`
6. Select `ADD RULE`, then select either `New rule` or `New rule from template`

### New rule

Examples can be found in Google documentation.

1. Set the rule `Name`
2. Optionally - Set the rule `Description`
3. Set the `Scope` as appropriate
4. Select `Continue`
5. Set `Triggers` by checking `File modified` under `Google Drive`
6. Select `ADD CONDITION` and configure values (`Field`, `Comparison Operator`, `Content to match`) - Repeat as appropriate
7. Select `Continue`
8. Under `Actions`, select the desired action to take for each incident
9. Under `Alerting`, select the desired severity level
10. Under `Alerting`, Select `Send to alert center`
11. Select `Continue`
12. Select `Create`

### New rule from template

1. Select the desired rule template
2. Optionally set the `Name` as desired
3. Optionally set the `Description` as desired
4. Set the `Scope` as appropriate
5. Select `Continue`
6. Modify preconfigured `Conditions` as desired, or add additional conditions
7. Select `Continue`
8. Under `Alerting`, Select `Send to alert center`
9. Select `Continue`
10. Select `Create`

## Default Value

No DLP policies for Google Drive are configured by default

## References

1. https://apps.google.com/supportwidget/articlehome?article_url=https%3A%2F%2Fsupport.google.com%2Fa%2Fanswer%2F10846568%3Fvisit_id%3D638058685723082013-4065283876&product_context=10846568&product_name=UnuFlow&trigger_context=a
2. https://workspaceupdates.googleblog.com/2020/10/data-protection-dlp-reports.html

## CIS Controls

| Controls Version | Control                                                     | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.13 Deploy a Data Loss Prevention Solution                 |      |      | x    |
| v7               | 14.7 Enforce Access Control to Data through Automated Tools |      |      | x    |
