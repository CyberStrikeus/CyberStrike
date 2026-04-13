---
name: cis-gworkspace-5.1.1.1
description: "Ensure the App Usage Report is reviewed regularly for anomalies"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, reporting, app-usage, anomalies, monitoring]
cis_id: "5.1.1.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1.1 Ensure the App Usage Report is reviewed regularly for anomalies

## Profile Applicability
- Enterprise Level 1

## Description
As an administrator, you can use Apps usage reports to get an in-depth understanding of how your users use Google Workspace apps.

Fields Available:
- User
- Gmail storage used (MB)
- Drive storage used (MB)
- Photos storage used (MB)
- Total storage used (MB)
- Storage used (%)
- Classroom - last used time
- Classes created
- Posts created
- Total emails
- Emails sent
- Emails received
- Gmail (IMAP) - last used time
- Gmail (POP) - last used time
- Gmail (Web) - last used time
- Files edited
- Files viewed
- Drive - last active time
- Files added
- Other types added
- Google Docs added
- Google Sheets added
- Google Slides added
- Google Forms added
- Google Drawings added
- Posts
- +1s
- +1s received
- Comments
- Comments received
- Reshares
- Reshares received
- Search queries
- Search queries from web
- Search queries from Android
- Search queries from iOS

This report should be reviewed weekly.

**NOTE:** In larger organizations reviewing this entire report weekly may not be possible. At a minimum, all Administrator and Super Administrator users should be reviewed, since they are a higher risk. These can be filtered from the overall user list.

## Rationale
The App usage report can allow administrator to discover user that are potentially using application that they do not have access to and/or using in atypical ways.

## Impact
No user impact.

## Audit
To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator.
2. Select **Reporting**.
3. Select **Reports**.
4. Select **User Reports**.
5. Select **App usage**, and a table of results will be displayed with the fields listed in the Recommendation description above.
6. Review the displayed users and values for anomalies.

## Remediation
The remediation for any anomalies in the various fields varies widely (different sections of the Google Workspace Admin UI). Please refer to Google's documentation for specifics.

**NOTE:** Many of these settings will be remedied by implementing other sections of this Benchmark. For example, an Admin showing recent Gmail (IMAP) - last used time and/or Gmail (POP) - last used time can be remedied by implementing the Remediation procedure for the recommendation *Ensure POP and IMAP access is disabled for all users*.

## Default Value
The report will display all users and fields.

## References
1. https://support.google.com/a/answer/4579578

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.11 Conduct Audit Log Reviews | | x | x |
| v7 | 6.7 Regularly Review Logs | | x | x |
