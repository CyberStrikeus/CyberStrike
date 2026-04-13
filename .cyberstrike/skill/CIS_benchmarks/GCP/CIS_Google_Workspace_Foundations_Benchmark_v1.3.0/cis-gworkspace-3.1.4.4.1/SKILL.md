---
name: cis-gworkspace-3.1.4.4.1
description: "Ensure allow users to install Chat apps is disabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, google-chat, chat-apps]
cis_id: "3.1.4.4.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure allow users to install Chat apps is disabled (Manual)

## Description

Control the use of Chat apps in spaces or direct messages to connect to services in Google Chat and look up information, schedule meetings, or complete tasks. Apps are accounts created by Google, users in your organization, or third parties.

## Rationale

When a user interacts with an app in Chat, the app can see the user's email address, avatar, other basic user information, user locale, timezone, and interaction information. The app can also see the basic user information of other people in the chat, but it can't see their email address or avatar unless they also interact directly with the app.

Chat apps that you install from the Google Workspace Marketplace can be made by developers from outside of your organization.

Using these Chat app need to be carefully controlled (vetted and approved) since a malicious Chat app could allow the exfiltration of company proprietary information.

## Impact

By default users will not be able to install Chat apps.

## Audit Procedure

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Chat and classic Hangouts`
4. Select `Chat apps`
5. Under `Chat apps access settings`, verify `Allow users to install Chat apps` is **OFF**

### Expected Result

`Allow users to install Chat apps` should be OFF.

## Remediation

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Chat and classic Hangouts`
4. Select `Chat apps`
5. Under `Chat apps access settings`, set `Allow users to install Chat apps` to **OFF**
6. Select `Save`

## Default Value

`Allow users to install Chat apps` is **ON**

## References

1. https://developers.google.com/chat/concepts/apps

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

## Profile

Level 1
