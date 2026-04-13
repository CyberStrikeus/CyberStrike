---
name: cis-aws-euc-4.8
description: "Ensure any user that has not accessed WorkDocs in 30 days is set to inactive"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workdocs, user-management, account-lifecycle]
cis_id: "4.8"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: [CWE-263]
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure any user that has not accessed WorkDocs in 30 days is set to inactive (Manual)

## Profile Applicability

- Level 1

## Description

User accounts that are not actively using the WorkDocs service should be set to inactive after a period of 30 days.

## Rationale

Inactive accounts may appear to not pose a problem but they can provide unauthorized access to files within WorkDocs.

## Impact

Changing a user to Inactive status does not delete their files, folders, or feedback from your Amazon WorkDocs site.

## Audit Procedure

Perform the following steps to review list of users.

### Using WorkDocs Admin Control Panel

1. Log in to WorkDocs as an Administrator
2. Under **My Account**, choose **Open admin control panel**
3. Under **Manage Users**, choose **Download user**
4. For Download user, choose **All users**
5. Review the file to determine if any users have not accessed WorkDocs in the past 30 days

If you find any users that have not accessed WorkDocs in the past 30 days refer to the remediation below.

### Using AWS Console

Not applicable - must be audited via WorkDocs Admin control panel.

## Expected Result

All users who have not accessed WorkDocs in 30+ days are set to inactive status.

## Remediation

### Using WorkDocs Admin Control Panel

Perform the steps below to disable a user's access by changing their status to Inactive:

1. Log in to WorkDocs as an Administrator
2. Under **My Account**, click **Open admin control panel**
3. Under **Manage Users**, choose the pencil icon next to the user's name that needs to be set as inactive
4. Choose **Inactive**, and Click Save Changes

The inactivated user no longer has access to your Amazon WorkDocs site.

### Using AWS CLI

Not applicable - must be configured via WorkDocs Admin control panel.

## Default Value

By default, there is no setting to manage inactive users.

## References

1. https://docs.aws.amazon.com/workdocs/latest/adminguide/inactive-user.html

## CIS Controls

**v8:**

- 5.1 Establish and Maintain an Inventory of Accounts
  - Establish and maintain an inventory of all accounts managed in the enterprise. The inventory must include both user and administrator accounts. The inventory, at a minimum, should contain the person's name, username, start/stop dates, and department. Validate that all active accounts are authorized, on a recurring schedule at a minimum quarterly, or more frequently.

- 6.2 Establish an Access Revoking Process
  - Establish and follow a process, preferably automated, for revoking access to enterprise assets, through disabling accounts immediately upon termination, rights revocation, or role change of a user. Disabling accounts, instead of deleting accounts, may be necessary to preserve audit trails.

**v7:**

- 16.6 Maintain an Inventory of Accounts
  - Maintain an inventory of all accounts organized by authentication system.

- 16.7 Establish Process for Revoking Access
  - Establish and follow an automated process for revoking system access by disabling accounts immediately upon termination or change of responsibilities of an employee or contractor. Disabling these accounts, instead of deleting accounts, allows preservation of audit trails.

## Profile

Level 1
