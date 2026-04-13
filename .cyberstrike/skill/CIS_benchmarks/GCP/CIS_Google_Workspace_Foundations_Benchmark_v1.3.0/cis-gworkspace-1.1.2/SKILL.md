---
name: cis-gworkspace-1.1.2
description: "Ensure no more than 4 Super Admin accounts exist"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, admin, super-admin, directory, users, sharing]
cis_id: "1.1.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.2 Ensure no more than 4 Super Admin accounts exist (Manual)

## Description

Having more than one Super Admin account is needed primarily so that a single point of failure can be avoided, but having too many should be avoided.

## Rationale

From a security point of view, having a large number of Super Admin accounts is a bad practice. In general, all users should be assigned the least privileges needed to do their job. This includes Administrators since not everyone that needs to "Administer Something" needs to be a Super Admin. Google Workspaces provides many predefined Administration Roles and also allows the creation of Custom Roles with very granular permission selection.

## Impact

There should be no user impact, but Administrators should have a normal (low privilege) and an Administrative (high privilege) account.

## Audit Procedure

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Go to `Directory` and click on `Users`, this will show a list of all users
3. Click on `+ Add a filter`, select `Admin role`, check the `Super admin` box, and then select `Apply`
4. The list of Users displayed will only be those with the `Super Admin` role
5. Make sure no more than four (4) users are listed

## Expected Result

No more than four (4) users should be listed with the `Super Admin` role.

## Remediation

Reduce the number of accounts with a "Super Admin" role.

## Default Value

All Google Workspace tenants will have one Super Admin initially.

## References

- https://support.google.com/a/answer/33325

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 5.1 Establish and Maintain an Inventory of Accounts | x | x | x |
| v7 | 4.1 Maintain Inventory of Administrative Accounts | | x | x |

## Profile

- Enterprise Level 1
