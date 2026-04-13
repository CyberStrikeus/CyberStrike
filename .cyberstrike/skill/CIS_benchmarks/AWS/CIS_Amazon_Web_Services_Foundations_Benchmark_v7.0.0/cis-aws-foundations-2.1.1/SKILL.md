---
name: cis-aws-foundations-2.1.1
description: "Ensure centralized root access in AWS Organizations"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, organizations, root-access, centralized-management]
cis_id: "2.1.1"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.1.2, cis-aws-foundations-2.1.3]
prerequisites: []
severity_boost: {}
---

# Ensure centralized root access in AWS Organizations

## Description

Ensure centralized root access management is enabled to manage and secure root user credentials for member accounts in AWS Organizations. This allows the management account and an optional delegated administrator account to centrally delete, prevent recovery of, and if necessary, perform short-lived, scoped root-required actions in member accounts without maintaining long-term root user credentials in each account.

## Rationale

The AWS account root user is a powerful, default administrative identity that is difficult to manage safely across many accounts. When each member account manages its own root credentials, organizations often end up with numerous long-lived root passwords, access keys, and MFA devices that are hard to inventory, rotate, and protect. Centralized root access management lets security teams remove or avoid creating root user credentials in member accounts, centrally review and manage any remaining credentials, and perform necessary root-only tasks via short-term, task-scoped root sessions. This significantly reduces privileged credential sprawl, supports least privilege and dedicated administrator models, and improves visibility and auditability of root-level activity across the organization.

## Impact

Enabling centralized root access management changes how root user access is obtained and used in member accounts, but it does not automatically remove existing root credentials. Organizations must plan when and how to delete or disable any existing root passwords, access keys, signing certificates, and MFA devices in member accounts and update any workflows that still rely on direct root sign-in. Security and operations teams will need to use centrally initiated, short-lived root sessions for exceptional tasks that truly require root. This may require procedural changes and additional training, but it significantly reduces long-lived privileged credential sprawl across the organization.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console with the management account.
2. In the console search bar, type Organizations and open AWS Organizations.
3. On the Overview page, confirm that an Organization exists and that this account is listed as the Management account.
4. In AWS Organizations, choose Services.
5. Confirm that AWS Identity and Access Management appears in the list of services with trusted access enabled.
6. In the console search bar, type IAM and open IAM. In the left navigation pane, choose Root access management. Check the status banner.
7. If you see that Root access management is enabled and the feature card shows that root credentials management is turned on for member accounts, the organization has centralized root access management enabled.
8. If you see Root access management is disabled with an option to Enable, centralized root access is not yet enabled.
9. (Optional) On the same Root access management page, review the Delegated administrator information (if shown).
10. Confirm that the delegated account (if present) is a security or management-focused account, not a general workload account.

## Expected Result

Root access management is enabled in the Organizations management account. The feature card confirms root credentials management is turned on for member accounts. If a delegated administrator is configured, it is a security or management-focused account.

## Remediation

### Using AWS Console

1. Sign in to the AWS Management Console with the management account.
2. In the console search bar, type Organizations and open AWS Organizations.
3. On the Overview page, confirm that an Organization exists and that this account is listed as the Management account.
4. In AWS Organizations, choose Services. Locate AWS Identity and Access Management in the list and, if it is not already enabled, choose Enable trusted access and confirm.
5. In the console search bar, type IAM and open IAM. In the left navigation pane, choose Root access management. If you see Root access management is disabled, choose Enable.
6. In the enable dialog, confirm that you want to enable "Root credentials management" and if desired "Privileged root actions in member accounts".
7. In the Delegated administrator field, enter the account ID of the account that will manage root user access and take privileged actions on member accounts. AWS recommends using an account intended for security or management purposes, not a general workload account.
8. When you enable centralized root access in the console, IAM also enables trusted access for IAM in AWS Organizations if it isn't already enabled.
9. Choose Enable to save the configuration.

## Default Value

Centralized root access management is not enabled by default. Each member account manages its own root user credentials independently.

## References

- [AWS Documentation - Centralize root access for member accounts](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user.html)

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts |      | \*   | \*   |
| v8               | 5.6 Centralize Account Management                                         |      | \*   | \*   |
| v8               | 6.7 Centralize Access Control                                             |      | \*   | \*   |

## Profile

Level 2 | Manual
