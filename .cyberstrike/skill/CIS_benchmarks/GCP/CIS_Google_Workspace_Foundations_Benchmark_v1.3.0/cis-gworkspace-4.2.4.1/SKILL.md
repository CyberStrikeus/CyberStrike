---
name: cis-gworkspace-4.2.4.1
description: "Ensure Google session control is configured"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, session-control, access-control]
cis_id: "4.2.4.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.4.1 Ensure Google session control is configured

## Profile Applicability

- Enterprise Level 1

## Description

Configure Google Workspace's session control to strengthen session expiration.

## Rationale

As an administrator, you can control how long users can access Google services, such as Gmail on the web, without having to sign in again. For example, for users that work remotely or from untrusted locations, you might want to limit the time that they can access sensitive resources by applying a shorter web session length. If users want to continue accessing a resource when a session ends, they're prompted to sign in again and start a new session.

How the settings work on mobile devices varies by device and app.

## Impact

The potential impact associated with implementation of this setting are:

- When a web session expires for a user, they see the Verify it's you page and must sign in again.
- When you change the session length, users need to sign out and in again for settings to take effect.
- If you set the session to never expire, users never have to sign in again.
- If you need some users to sign in more frequently than others, place them in different organizational units. Then, apply different session lengths to them. That way, certain users won't be interrupted to sign in when it isn't necessary.
- If a Google Meet meeting starts within 2 hours of a session's scheduled expiration, the user is forced to sign in again before the start of the meeting. This helps avoid an interruption to the meeting while in-progress.
- If you're using a third-party identity provider (IdP), such as Okta or Ping, and you set web session lengths for your users, you need to set the IdP session length parameter to expire before the Google session expires. That way, your users will be forced to sign in again. If the third-party IdP session is still valid when the Google session expires, the Google session might be renewed automatically without the user signing in again.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Google session control`
5. Verify `Web session duration`, is `12 hours` or less

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Google session control`
5. Set `Web session duration` to `12 hours` or less
6. Select `Save`

## Default Value

`Web session duration` is `14 days`

## CIS Controls

| Controls Version | Control                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.3 Configure Automatic Session Locking on Enterprise Assets | x    | x    | x    |
