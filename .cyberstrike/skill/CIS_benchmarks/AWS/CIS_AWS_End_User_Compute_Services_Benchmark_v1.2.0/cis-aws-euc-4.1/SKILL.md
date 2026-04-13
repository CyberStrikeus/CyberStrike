---
name: cis-aws-euc-4.1
description: "Ensure Administrators of WorkDocs is defined using IAM"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workdocs, iam, access-control]
cis_id: "4.1"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Administrators of WorkDocs is defined using IAM (Automated)

## Profile Applicability

- Level 1

## Description

Administration of AWS WorkDocs should be defined using AWS Identity and Access Management (IAM).

## Rationale

By default, IAM users and roles don't have permission to create or modify Amazon WorkDocs resources. Using IAM to manage WorkDocs administrators ensures proper access control and follows the principle of least privilege.

## Impact

None - this is a security best practice.

## Audit Procedure

### Using AWS Console

1. Log in to the IAM console at `https://console.aws.amazon.com/iam/`
2. In the left pane, click **Groups** and then click **Create New Group**
3. In the Group Name box, type the name of the group and then click **Next Step**
4. In the list of policies, select the check box for **AmazonWorkDocsFullAccess**
5. Click **Next Step**
6. Click **Create Group**

Add users to the Amazon WorkDocs Full Access group:

1. Log in to the IAM console at `https://console.aws.amazon.com/iam/`
2. In the left pane, click **Groups**
3. Select the group you created above
4. Click **Add Users To Group**
5. Select the users to be added to the group
6. Click **Add Users**

### Using AWS CLI

Not applicable for this control - must be configured via Console.

## Expected Result

IAM group with AmazonWorkDocsFullAccess policy exists and WorkDocs administrators are members of this group.

## Remediation

### Using AWS Console

Perform the following to create an IAM group and assign the Amazon WorkDocs Full Access policy to it:

1. Log in to the IAM console at `https://console.aws.amazon.com/iam/`
2. In the left pane, click **Groups** and then click **Create New Group**
3. In the Group Name box, type the name of the group and then click **Next Step**
4. In the list of policies, select the check box for **AmazonWorkDocsFullAccess**
5. Click **Next Step**
6. Click **Create Group**

Perform the following to add a user to a Amazon WorkDocs Full Access group:

1. Log in to the IAM console at `https://console.aws.amazon.com/iam/`
2. In the left pane, click **Groups**
3. Select the group you created above
4. Click **Add Users To Group**
5. Select the users to be added to the group
6. Click **Add Users**

### Using AWS CLI

Not applicable - must be configured via Console.

## Default Value

By default, IAM users and roles don't have permission to create or modify Amazon WorkDocs resources.

## References

1. https://docs.aws.amazon.com/workspaces/latest/adminguide/workspaces-access-control.html
2. https://docs.aws.amazon.com/workspaces/latest/adminguide/manage-workspaces-users.html
3. https://docs.aws.amazon.com/workdocs/latest/adminguide/security_iam_id-based-policy-examples.html

## CIS Controls

**v8:**

- 5.1 Establish and Maintain an Inventory of Accounts
  - Establish and maintain an inventory of all accounts managed in the enterprise. The inventory must include both user and administrator accounts. The inventory, at a minimum, should contain the person's name, username, start/stop dates, and department. Validate that all active accounts are authorized, on a recurring schedule at a minimum quarterly, or more frequently.

**v7:**

- 4.1 Maintain Inventory of Administrative Accounts
  - Use automated tools to inventory all administrative accounts, including domain and local accounts, to ensure that only authorized individuals have elevated privileges.

## Profile

Level 1
