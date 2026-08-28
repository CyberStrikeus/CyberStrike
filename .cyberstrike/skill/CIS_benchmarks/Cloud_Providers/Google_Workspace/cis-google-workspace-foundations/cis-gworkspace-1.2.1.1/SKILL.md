---
name: cis-gworkspace-1.2.1.1
description: "Ensure directory data access is externally restricted"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, admin, super-admin, directory, users, sharing]
cis_id: "1.2.1.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.1.1 Ensure directory data access is externally restricted (Manual)

## Description

Configure Google Workspace's external directory sharing to prevent unrestricted directory data access.

## Rationale

If your organization uses third-party apps that integrate with your Google services, you control how much Directory information the external apps can access.

If you allow directory access, your users have a better experience with external apps. For example, when they use a third-party mail app, they want to find domain contacts and have email addresses automatically complete. The app needs access to Directory data to make this happen. However, this has the ability to share ALL domain AND public data with the connected third-party app.

- **Public data and authenticated user basic profile fields** -- Share publicly visible domain profile data with external apps and APIs. Also share the authenticated user's name, photo, and email address to enable Google Sign-In if the appropriate scopes are granted. Other non-public profile fields for the authenticated user aren't shared. All the non-public profile information of other users in the domain aren't shared.
- **Domain and public data** -- (Default) Share all Directory information that's shared with your domain and public data. This information includes profile information for users in your domain, shared external contacts, and Google+ profile names and photos.

## Impact

The External directory sharing setting applies only to the following APIs and the Apps Scripts or third-party Marketplace apps that use those APIs:

- Google People API
- Google CardDAV API
- Google Contacts API v3

The setting applies only to third-party apps, such as iOS Mail and iOS Contacts (when enrolled on an iOS device via Add Account and then Google), third-party Contacts apps (on Android).

The setting doesn't apply to Google products, including mobile apps, such as the following:

- Gmail, Contacts (on Android), Inbox, Meet, and other Google mobile apps
- iOS Mail and iOS Contacts using Google Sync (when enrolled on an iOS device through Add Account and then Exchange)
- Workspace Sync for Microsoft Outlook

## Audit Procedure

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Open the collapsed menu via "hamburger button \ 3 horizontal lines"
3. Under `Directory`, select `Directory settings`
4. Under `Sharing settings`, select `External Directory sharing`
5. Ensure `Domain and public data` is **not** selected
6. Select `Save`

## Expected Result

`Domain and public data` should NOT be selected. `Public data and authenticated user basic profile fields` should be selected instead.

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Open the collapsed menu via "hamburger button \ 3 horizontal lines"
3. Under `Directory`, select `Directory settings`
4. Under `Sharing settings`, select `External Directory sharing`
5. Select `Public data and authenticated user basic profile fields`

## Default Value

`External Directory sharing` = `Domain and public data`

## References

- https://support.google.com/a/answer/60218

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

- Enterprise Level 1
