---
name: cis-gcp-foundations-2.14
description: "Ensure 'Access Transparency' is 'Enabled'"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, logging, monitoring, access-transparency, audit-logs]
cis_id: "2.14"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.14 Ensure 'Access Transparency' is 'Enabled' (Manual)

## Profile Applicability

- Level 2

## Description

GCP Access Transparency provides audit logs for all actions that Google personnel take in your Google Cloud resources.

## Rationale

Controlling access to your information is one of the foundations of information security. Given that Google Employees do have access to your organizations' projects for support reasons, you should have logging in place to view who, when, and why your information is being accessed.

## Impact

To use Access Transparency your organization will need to have at one of the following support level: Premium, Enterprise, Platinum, or Gold. There will be subscription costs associated with support, as well as increased storage costs for storing the logs. You will also not be able to turn Access Transparency off yourself, and you will need to submit a service request to Google Cloud Support.

## Audit

### From Google Cloud Console

Determine if Access Transparency is Enabled:

1. From the Google Cloud Home, click on the Navigation hamburger menu in the top left. Hover over the IAM & Admin Menu. Select `settings` in the middle of the column that opens.
2. The status will be under the heading `Access Transparency`. Status should be `Enabled`.

## Remediation

### From Google Cloud Console

Add privileges to enable Access Transparency:

1. From the Google Cloud Home, within the project you wish to check, click on the Navigation hamburger menu in the top left. Hover over the 'IAM and Admin'. Select `IAM` in the top of the column that opens.
2. Click the blue button the says `+add` at the top of the screen.
3. In the `principals` field, select a user or group by typing in their associated email address.
4. Click on the `role` field to expand it. In the filter field enter `Access Transparency Admin` and select it.
5. Click `save`.

Verify that the Google Cloud project is associated with a billing account:

1. From the Google Cloud Home, click on the Navigation hamburger menu in the top left. Select `Billing`.
2. If you see `This project is not associated with a billing account` you will need to enter billing information or switch to a project with a billing account.

Enable Access Transparency:

1. From the Google Cloud Home, click on the Navigation hamburger menu in the top left. Hover over the IAM & Admin Menu. Select `settings` in the middle of the column that opens.
2. Click the blue button labeled Enable `Access Transparency for Organization`.

## Default Value

By default Access Transparency is not enabled.

## References

1. https://cloud.google.com/cloud-provider-access-management/access-transparency/docs/overview
2. https://cloud.google.com/cloud-provider-access-management/access-transparency/docs/enable
3. https://cloud.google.com/cloud-provider-access-management/access-transparency/docs/reading-logs
4. https://cloud.google.com/cloud-provider-access-management/access-transparency/docs/reading-logs#justification_reason_codes
5. https://cloud.google.com/cloud-provider-access-management/access-transparency/docs/supported-services

## Additional Information

To enable Access Transparency for your Google Cloud organization, your Google Cloud organization must have one of the following customer support levels: Premium, Enterprise, Platinum, or Gold.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | x | x | x |
| v8 | 8.5 Collect Detailed Audit Logs | | x | x |
| v7 | 6.2 Activate audit logging | x | x | x |
| v7 | 6.3 Enable Detailed Logging | | x | x |
