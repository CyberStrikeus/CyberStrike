---
name: cis-aws-database-10.4
description: "Ensure Access Control and Authentication is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, timestream, time-series, iam, authentication, access-control, mfa]
cis_id: "10.4"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-10.1, cis-aws-database-10.5, cis-aws-database-10.6]
prerequisites: []
severity_boost: {}
---

# 10.4 Ensure Access Control and Authentication is Enabled (Manual)

## Description
Utilize AWS Identity and Access Management (IAM) to control access to your Amazon Timestream resources. Define IAM policies that grant or deny permissions for specific Timestream actions and resources.

## Rationale
Users should select whether they like to enable authentication. If they want to authenticate the user would be required to implement IAM roles would grant or deny permissions within that database. Users also have an option to enable multi-factor authentication, which adds an extra layer of security restricting access to unauthorized users.

## Impact
Allowing authentication verifies the identity of the person and who has appropriate access to a company's data.

## Audit Procedure

### Using AWS Console
1. Understand AWS Identity and Access Management (IAM):
   - Familiarize yourself with IAM, the AWS service used to manage access to AWS resources. Understand IAM users, groups, roles, policies, and permissions, essential for access control in Timestream.
2. Create IAM Users, Groups, and Roles:
   - Access the AWS Management Console and navigate to the IAM service. Create IAM users, groups, and roles based on your organization's access control requirements for Timestream. Define appropriate permissions for these entities, limiting access to specific Timestream actions and resources.
3. Assign IAM Policies:
   - Create IAM policies that define the desired level of access to Timestream. Associate these policies with the respective IAM users, groups, and roles created earlier. Ensure that the policies provide the necessary permissions for users to interact with Timestream resources.
4. Use IAM Roles for External Applications:
   - If you have external applications or services accessing Timestream, create IAM roles specific to those applications. Define the necessary permissions in the IAM roles and grant them to the respective applications or services. Configure the applications or services to assume these IAM roles when accessing Timestream.
5. Enable Multi-Factor Authentication (MFA):
   - Enable MFA for IAM users who require access to Timestream. Configure MFA devices and enforce MFA usage for these users. MFA adds an extra layer of security by requiring an additional authentication factor during the login process.
6. Implement AWS Identity Federation (Optional):
   - Consider implementing AWS Identity Federation if you need to grant access to Timestream to users from external identity providers. Configure the necessary trust relationships and establish a federation between the external identity provider and AWS. Ensure that the federated users have the appropriate IAM policies and permissions for Timestream.
7. Regularly Review and Update Access Controls:
   - Periodically review and update the IAM policies and permissions for Timestream. Remove unnecessary access permissions and ensure access controls align with your organization's security requirements. Monitor IAM activity logs and AWS CloudTrail to identify unauthorized access attempts or unusual activities.

## Expected Result
IAM users, groups, roles, and policies should be properly configured with appropriate permissions for Timestream access. MFA should be enabled for users accessing Timestream.

## Remediation

### Using AWS Console
Follow the audit steps above to configure IAM access controls and authentication for your Amazon Timestream resources.

## Default Value
Access to Timestream is controlled through IAM. No default IAM policies are configured for Timestream access beyond the root account.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile
Level 1 | Manual
