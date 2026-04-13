---
name: cis-aws-foundations-2.1.5
description: "Ensure delegated admin manages AWS Organizations policies"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, organizations, delegated-admin, scp, policies]
cis_id: "2.1.5"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.1.6]
prerequisites: []
severity_boost: {}
---

# Ensure delegated admin manages AWS Organizations policies

## Description

Ensure that a dedicated member account is configured as a delegated administrator for AWS Organizations to manage organization policies (SCPs, RCPs, tag policies, backup policies, AI opt-out policies) and other Organizations features, instead of performing these tasks directly from the management account. The delegated administrator for AWS Organizations is configured via a resource-based delegation policy in the management account, which grants specific member accounts limited permissions to perform Organizations policy and account management actions across the organization. This allows policy management, OU operations, and other governance tasks to be handled from purpose-built accounts without requiring broad access to the management account.

## Rationale

The management account has unique and high privileges to manage AWS Organizations (for example, creating/deleting accounts, managing org structures) and is not subject to guardrails like SCPs. Without a delegated administrator for Organizations, all policy management, OU changes, and account governance must be performed directly from the management account. This results in concentrating operational activity in the most powerful account. Configuring a dedicated member account as a delegated administrator for Organizations policy management distributes these tasks to a purpose-built AWS account that can be protected by SCPs and other controls, reduces the number of users and roles that need management-account access, and supports separation of duties while maintaining centralized control over organization-wide features.

## Impact

Configuring a delegated administrator for AWS Organizations requires creating or identifying a dedicated member account for policy management and granting it specific permissions via a resource-based delegation policy. Existing workflows, automation, and user access patterns that currently perform Organizations policy tasks directly from the management account must be updated to use the delegated account instead. This introduces short-term operational overhead and testing to ensure policy creation, attachment, and management continue to function correctly from the new account.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Organizations console. From the AWS Accounts section, verify that this is the management account for the organization.
2. In the AWS Organizations console, navigate to Settings. Scroll to the Delegated administrator for AWS Organizations section.
3. Review the delegation policy status:
   - If a delegation policy is configured and shows one or more member accounts registered to manage Organizations policies, proceed to step 4.
   - If no delegation policy is configured or the section shows No delegated administrator (or equivalent), the audit fails because Organizations management is performed directly from the management account.
4. In the Delegated administrator section, note the account IDs registered for Organizations policy management. Confirm that the delegated accounts are purpose-built governance, security, or policy management accounts, not general workload, sandbox, or development accounts.
5. View the delegation policy details to confirm it grants appropriate least-privilege permissions for policy types (for example, SCPs, tag policies, backup policies) and actions (CreatePolicy, AttachPolicy, UpdatePolicy, etc.).

## Expected Result

A delegation policy is configured in the management account with at least one dedicated member account registered as a delegated administrator for Organizations policy management with least-privilege permissions.

## Remediation

### Using AWS Console

1. Identify a dedicated member account for governance/policy management (for example, create a new "Policy Management" account or use an existing Security account).
2. You must be in the management account with permissions to manage Organizations resource policies. Navigate to AWS Organizations console, then click on Settings and browse to "Delegated administrator for AWS Organizations" section.
3. If no policy exists, click on Delegate. If a policy exists, choose Edit policy.
4. In the policy editor, paste or construct a delegation policy statement mentioning the Principal as the AWS account Root which is being delegated access to, and the Actions with the list of least-privileged permissions that could be performed by the delegated AWS account.
5. Save and validate the delegation policy.
6. Sign in to the delegated administrator account and open the AWS Organizations console. Confirm that policy management (Policies, Attach/Detach, etc.) is accessible and that users/roles in this account can perform Organizations tasks without management-account access.
7. Grant IAM roles/users in the delegated admin account only the permissions needed for Organizations policy management.
8. Update procedures so that routine Organizations policy tasks are performed from the delegated account, reserving the management account for tasks that only it can perform.

## Default Value

By default, no delegated administrator is configured for AWS Organizations policy management. All policy management tasks must be performed directly from the management account.

## References

- AWS Organizations documentation on delegated administration

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts |      | x    | x    |
| v8               | 6.8 Define and Maintain Role-Based Access Control                         |      |      | x    |

## Profile

Level 2 | Manual
