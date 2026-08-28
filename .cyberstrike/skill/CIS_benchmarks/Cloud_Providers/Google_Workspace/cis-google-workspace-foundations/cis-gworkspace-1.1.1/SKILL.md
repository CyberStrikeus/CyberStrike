---
name: cis-gworkspace-1.1.1
description: "Ensure more than one Super Admin account exists"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, admin, super-admin, directory, users, sharing]
cis_id: "1.1.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.1 Ensure more than one Super Admin account exists (Manual)

## Description

Having more than one Super Admin account is needed primarily so that a single point of failure can be avoided. Also, for larger organizations, having multiple Super Admins can be useful for workload balancing purposes.

## Rationale

From a security point of view, having only a single Super Admin Account can be problematic if this user were unavailable for an extended period of time. Also, Super Admin accounts should never be shared amongst multiple users.

## Impact

There should be no user impact, but Administrators should have a normal (low privilege) and an Administrative (high privilege) account.

## Audit Procedure

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Go to `Directory` and click on `Users`, this will show a list of all users
3. Click on `+ Add a filter`, select `Admin role`, check the `Super admin` box, and then select `Apply`
4. The list of Users displayed will only be those with the `Super Admin` role
5. Make sure more than one (1) user is listed

## Expected Result

More than one (1) user should be listed with the `Super Admin` role.

## Remediation

Create at least one additional account with a Super Admin role.

**NOTE:** A new account should be created vs adding this role to an existing account since Administration tasks should be done through separate Admin accounts.

## Default Value

All Google Workspace tenants will have one Super Admin initially.

## References

- https://support.google.com/a/answer/33325

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.1 Establish and Maintain an Inventory of Accounts | x    | x    | x    |
| v7               | 4.1 Maintain Inventory of Administrative Accounts   |      | x    | x    |

## Profile

- Enterprise Level 1
