---
name: cis-aws-foundations-2.19
description: "Ensure IAM users are managed centrally via identity federation or AWS Organizations for multi-account environments"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, federation, identity-center, sso, organizations, multi-account]
cis_id: "2.19"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.13, cis-aws-foundations-2.14]
prerequisites: []
severity_boost: {}
---

# Ensure IAM users are managed centrally via identity federation or AWS Organizations for multi-account environments

## Description
In multi-account environments, IAM user centralization facilitates greater user control. User access beyond the initial account is provided through role assumption. Centralization of users can be accomplished through federation with an external identity provider or through the use of AWS Organizations. AWS IAM Identity Center (formerly AWS SSO) is the recommended approach for centralized user management in AWS Organizations.

## Rationale
Centralizing IAM user management to a single identity store reduces complexity and the likelihood of access management errors. Using AWS IAM Identity Center further simplifies access management and reduces reliance on legacy per-account federation configurations.

## Impact
Managing IAM users independently across multiple accounts increases the risk of inconsistent access controls, orphaned accounts, and excessive permissions.

## Audit Procedure

### Using AWS Console

For multi-account AWS environments with an external identity provider:

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam
2. Click `Identity providers`
3. Verify that federation is configured appropriately

For environments using AWS IAM Identity Center (recommended):

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam
2. Navigate to `IAM Identity Center`
3. Verify that IAM Identity Center is enabled
4. Confirm that users and groups are centrally managed
5. Confirm that access is assigned to accounts through IAM Identity Center

For multi-account environments without centralized identity management:

1. Identify accounts that should not contain local IAM users
2. Sign in to the AWS Management Console
3. Switch role into each identified account
4. Navigate to the IAM console
5. Select Users
6. Confirm that no IAM users representing individuals are present

## Expected Result
Multi-account environments should have centralized identity management through either AWS IAM Identity Center or an external identity provider with federation. No local IAM users representing individuals should exist in member accounts (except for service accounts where required).

## Remediation

The remediation procedure will vary based on the organization's implementation of identity federation and or AWS Organizations.

Ensure the following:

1. IAM users are centrally managed through a single identity provider
2. Local IAM users are removed from member accounts, except for service accounts where required
3. Access to accounts is granted through role assumption
4. Where possible, migrate to AWS IAM Identity Center for centralized access management
5. Avoid legacy per-account federation configurations

## Default Value
By default, AWS accounts are created and managed independently. IAM users are local to each account unless centralized management is explicitly configured. IAM Identity Center must be enabled to provide centralized access management.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.6 Centralize Account Management - Centralize account management through a directory or identity service. | | x | x |
| v7 | 16.2 Configure Centralized Point of Authentication - Configure access for all accounts through as few centralized points of authentication as possible, including network, security, and cloud systems. | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1078.004 | TA0001, TA0004 | M1018 |

## Profile
Level 2 | Manual
