---
name: cis-aws-foundations-2.1.6
description: "Ensure delegated admins manage AWS Organizations-integrated services"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, organizations, delegated-admin, cloudtrail, integrated-services]
cis_id: "2.1.6"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.1.5]
prerequisites: []
severity_boost: {}
---

# Ensure delegated admins manage AWS Organizations-integrated services

## Description
Ensure that AWS services (such as AWS CloudTrail) which integrate with AWS Organizations and support delegated administration are managed through delegated administrator member accounts instead of directly from the Organizations management account. For each such service, the management account should enable trusted access and register a purpose-built member account as the delegated administrator, so that this account can perform service-level administration across all organization accounts.

## Rationale
The management account has unique and high privileges to manage AWS Organizations (for example, creating/deleting accounts, managing org structures) and is not subject to guardrails like SCPs. Without delegated administrators, organization-wide security, logging, and management services must be operated directly from the management account, concentrating operational activity and credentials in the most privileged account in the organization. Registering member accounts as delegated administrators for AWS services distributes service-specific administration to dedicated security, logging, or operations accounts that can be restricted by SCPs, monitored like other workload accounts, and aligned with team responsibilities, while reducing day-to-day use of the management account.

## Impact
Configuring a delegated administrator for AWS Services that integrate with AWS Organizations requires creating or identifying a dedicated member account for policy management and granting it specific permissions. Existing workflows, automation, and user access patterns that currently perform tasks directly from the management account must be updated to use the delegated account instead. This introduces short-term operational overhead and testing to ensure policy creation, attachment, and management continue to function correctly from the new account.

## Audit Procedure

### Using AWS Console
Note: This audit uses AWS CloudTrail as a concrete example. You must perform similar audits for all other AWS services that integrate with AWS Organizations and support delegated administration that are in use in your environment.

1. Sign in to the management account and open the CloudTrail console.
2. In the left navigation pane, choose Trails.
   - Verify that there is at least one organization trail (trail with Apply trail to all accounts in my organization or equivalent setting enabled).
   - If CloudTrail is only configured as single-account trails and no organization trail is in use, note that delegated admin for CloudTrail is not in scope and this recommendation is not applicable for CloudTrail in this environment.
3. In the same management account CloudTrail console, choose Settings in the left navigation pane, and scroll to the Organization delegated administrators section.
4. Verify the configuration for Organization delegated administrators:
   - Verify that at least one member account ID (not the management account) is listed as a delegated administrator for CloudTrail.
   - Verify that the account(s) are appropriate for security/logging operations (for example, a named Security or Logging account, not a sandbox or general workload account).
   - If the section shows "No delegated administrators" when an organization trail is in use, CloudTrail is effectively administered from the management account and this is a gap.

## Expected Result
At least one dedicated member account (not the management account) is registered as a delegated administrator for each AWS service that integrates with Organizations and is in use in the environment.

## Remediation

### Using AWS Console
Note: This remediation section uses AWS CloudTrail as a concrete example. You must perform similar procedure for all other AWS services that integrate with AWS Organizations and support delegated administration that are in use in your environment.

1. In the management account, verify that trusted access for CloudTrail is enabled in AWS Organizations (AWS Organizations -> Services).
2. In the management account CloudTrail console, choose Settings in the left navigation pane. Scroll to Organization delegated administrators.
3. Click on "Register administrator"
   - Enter the account ID of the designated Logging or Security account.
   - Click on Register administrator. CloudTrail will automatically create the necessary service-linked roles and register the account.
4. In the delegated administrator account, open the CloudTrail console and confirm that the organization trail is visible and administrative actions are accessible.
5. Update operational runbooks so that routine CloudTrail administration is performed from the delegated admin account, not the management account.

## Default Value
By default, no delegated administrators are configured for AWS Organizations-integrated services. All service administration must be performed directly from the management account.

## References
- AWS Organizations documentation on delegated administration
- AWS CloudTrail documentation on organization trails

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | | x | x |
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |

## Profile
Level 2 | Manual
