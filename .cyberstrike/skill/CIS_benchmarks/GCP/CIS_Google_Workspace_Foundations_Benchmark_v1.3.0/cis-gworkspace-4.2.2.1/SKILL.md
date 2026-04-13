---
name: cis-gworkspace-4.2.2.1
description: "Ensure blocking access from unapproved geographic locations"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, context-aware-access, geo-restriction, access-control]
cis_id: "4.2.2.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.2.1 Ensure blocking access from unapproved geographic locations

## Profile Applicability

- Enterprise Level 1

## Description

Restrict access to selected Google applications by geographic location.

## Rationale

Restricting access to known/approved geographic locations is a simple way to limit where attacks can originate from. Especially for smaller organizations that do not need global access to applications.

## Impact

Valid/approved users traveling to a geographic region outside of those defined in the Access Level will not be able to access their applications.

## Audit

To verify this setting via the Google Workspace Admin Console:

### Verify an appropriate Access Level has been defined

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Context-Aware Access`
5. Select `Access levels`
6. Review the list of Access Levels displayed and determine if there is an appropriate restriction on geographic access

### Verify the appropriate Access Level has been assigned to the application(s) that need the restriction

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Context-Aware Access`
5. Select `Assign access levels`
6. Review the list of Google Applications displayed and make sure the appropriate access level for geographic access is assigned to each

**NOTE:** CIS recommends geographically restricting access to the following Google applications at minimum:

1. Admin Console
2. Drives and Docs
3. Gmail
4. Google Vault

## Remediation

To configure this setting via the Google Workspace Admin Console:

### Create an appropriate Access Level

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Context-Aware Access`
5. Select `Access levels`
6. Select `Create Access Level`
7. Under Details - Name the Access Level (Suggested using a clear name - ex. "Restrict to USA")
8. Under Conditions - Select `Basic`
9. Under Condition 1 - Select `Meet attributes`
10. Under Condition 1 - Select `Add Attribute`
11. Click on the `Add Attribute` drop-down box and select `Geographic origin`
12. Click on the far right drop-down box and select the region, or regions, to be allowed (ex. United States)
13. Click `Save`

### Assign the defined Access Level to the application(s) that need the restriction

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Context-Aware Access`
5. Select `Assign access levels`
6. For each application listed that needs this restriction, select `Assign`
7. Under, `Access is granted when a user meets conditions in at least one of the selected access levels`, ensure the previously named Access Level (ex. "Restrict to USA") is `checked`
8. Also, ensure `Apply to Google desktop and mobile apps` is `checked`

**NOTE:** CIS recommends geographically restricting access to the following Google applications at minimum:

1. Admin Console
2. Drives and Docs
3. Gmail
4. Google Vault

## Default Value

None

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v7 | 16.13 Alert on Account Login Behavior Deviation | | | x |
