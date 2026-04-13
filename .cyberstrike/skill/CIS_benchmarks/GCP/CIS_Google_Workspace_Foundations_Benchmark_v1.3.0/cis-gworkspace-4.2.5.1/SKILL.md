---
name: cis-gworkspace-4.2.5.1
description: "Ensure Google Cloud session control is configured"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, session-control, google-cloud, access-control]
cis_id: "4.2.5.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.5.1 Ensure Google Cloud session control is configured

## Profile Applicability

- Enterprise Level 2

## Description

Configure Google cloud session control to strengthen session expiration.

## Rationale

As an administrator, you can control how long different users can access the Google Cloud console and Cloud SDK without having to re-authenticate. For example, you might want users with elevated privileges, like project owners, billing administrators, or others with administrator roles, to re-authenticate more frequently than regular users. If you set a session length, they're prompted to sign in again to start a new session.

## Impact

The potential impact associated with implementation of this setting are:

- When a Google cloud session expires for a user, they see the Verify it's you page and must sign in again.
- If you require a security key, users who do not have one cannot use the GCP Console or Cloud SDK until they set it up. Once they have a security key, they can switch to using their password instead if they want.

### If you're using a third-party identity provider (IdP):

- With the GCP Console -- If you require a user to re-authenticate using their password, they're redirected to the identity provider (IdP). The IdP might not require the user to re-enter their password to start another console session, if the user already has a session active with the IdP -- because they are using another application that caused the session to remain active. If a user must re-authenticate by touching their security key, they can do this while using the console. They will not be redirected to the IdP.
- With the Cloud SDK -- If a password is required for re-authentication, gcloud will require the user to execute the gcloud auth login command to renew the session. This will bring up a browser window, and the user will be taken to the IdP, where they may be prompted for credentials if there's no active session with the IdP. If a user must reauthenticate by touching their security key, they can do this on the Cloud SDK. They will not be redirected to the IdP.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Google Cloud session control`
5. Under `Reauthentication policy`, ensure `Require reauthentication` is `selected` and `Exempt Trusted apps` is `unchecked`
6. Verify `Reauthentication frequency`, is `16 hours (recommended)`
7. Verify `Reauthentication method` is `Security key`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Google Cloud session control`
5. Under `Reauthentication policy`, set `Require reauthentication` to selected and `Exempt Trusted apps` is `unchecked`
6. Set `Reauthentication frequency` to `16 hours (recommended)`
7. Set `Reauthentication method` to `Security key`
8. Select `Override`

## Default Value

`Reauthentication policy` is `Never require reauthentication`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.3 Configure Automatic Session Locking on Enterprise Assets | x | x | x |
