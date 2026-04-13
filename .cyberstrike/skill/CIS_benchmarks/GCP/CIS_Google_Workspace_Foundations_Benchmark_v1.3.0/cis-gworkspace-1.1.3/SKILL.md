---
name: cis-gworkspace-1.1.3
description: "Ensure super admin accounts are used only for super admin activities"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, admin, super-admin, directory, users, sharing]
cis_id: "1.1.3"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.3 Ensure super admin accounts are used only for super admin activities (Manual)

## Description

Super admin accounts have access to all features in the Google Admin console and Admin API and can manage every aspect of your organization's account. Super admins also have full access to all users' calendars and event details.

It is recommended to give each super administrator two accounts. One for their super admin account and a second account for daily activities. Users should only sign in to a super admin account to perform super admin tasks, such as setting up 2-Step Verification (2SV), managing billing and user licenses, or helping another admin recover their account. Super administrators should use a separate, non-admin account for day-to-day activities.

Super admins should sign in as needed to do specific tasks and then sign out. Leaving super admin accounts sign-in can increase exposure to phishing attacks.

## Rationale

Use the super admin account only when needed. Delegate administrator tasks to user accounts with limited admin roles. Use the least privilege approach, where each user has access to the resources and tools needed for their typical tasks. For example, you could grant an admin permissions to create user accounts and reset passwords, but not let them delete user accounts.

## Impact

Super admin users will have to switch accounts as well as utilize login/logout functionality when performing administrative tasks.

## Audit Procedure

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Go to `Directory` and click on `Users`, this will show a list of all users
3. Click on `+ Add a filter`, select `Admin role`, check the `Super admin` box, and then select `Apply`
4. The list of Users displayed will only be those with the `Super Admin` role
5. Click on `+ Add a filter`, select `Admin role`, check the `Delegated admin` box, and then select `Apply`
6. Verify that there are no users in both the `Super admin` and `Delegated admin` roles

## Expected Result

No users should appear in both the `Super admin` and `Delegated admin` roles simultaneously.

## Remediation

For every `Super admin` that is also a `Delegated admin` account, either create a `Delegated admin` account for the user of elevate or their existing non-admin account to a `Delegated admin` account.

## Default Value

N/A

## References

1. https://support.google.com/a/answer/179832?hl=en

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x | x | x |
| v7 | 4.1 Maintain Inventory of Administrative Accounts | | x | x |

## Profile

- Enterprise Level 1
