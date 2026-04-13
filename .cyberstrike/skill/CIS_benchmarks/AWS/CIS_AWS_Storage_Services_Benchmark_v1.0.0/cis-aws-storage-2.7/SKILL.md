---
name: cis-aws-storage-2.7
description: "Ensure creating IAM User"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, iam, iam-user, identity-verification, access-control]
cis_id: "2.7"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: [CWE-284]
chains_with: [cis-aws-storage-2.6, cis-aws-storage-2.8, cis-aws-storage-2.9]
prerequisites: []
severity_boost: {}
---

# CIS Control 2.7: Ensure creating IAM User (Manual)

## Profile Applicability

- **Level 2**

## Description

IAM users are individuals whose accounts have been created by the AWS administrator, providing them with access to specific AWS resources. These users have undergone identity verification with your organization, ensuring that only authorized personnel can manage and interact with your AWS environment.

## Rationale

The purpose of creating IAM users and verifying their identities with your organization is to ensure that only authorized individuals have access to AWS resources, enhancing security and preventing unauthorized access. This practice helps maintain control over your AWS environment, ensuring that sensitive data and critical operations are managed by trusted and validated personnel.

## Impact

Not creating IAM users and verifying their identities can lead to unauthorized access to your AWS resources, increasing the risk of security breaches and data leaks. This lack of control can result in compromised sensitive data, unauthorized changes to critical systems, and overall reduced security posture, potentially causing significant operational and financial damage to your organization.

## Audit Procedure

### Via AWS Management Console

1. **Access the AWS Management Console**
   - Log in to your AWS account and navigate to the AWS Management Console

2. **Review IAM Users**
   - Go to the IAM Dashboard and select "Users"
   - Check the list of IAM users to ensure that only authorized users are present

3. **Check User Details**
   - For each user, click on their name to view their details
   - Verify the "User ARN" and ensure that the user was created by an authorized administrator
   - Check the "Security credentials" tab to see if Multi-Factor Authentication (MFA) is enabled for added security

4. **Verify Identity Policies**
   - Review the policies attached to each user to ensure they are appropriate for the user's role
   - Check that permissions follow the principle of least privilege, granting only the necessary access

5. **Monitor Login Activity**
   - Use AWS CloudTrail to review login activities for each IAM user
   - Check for any unusual login patterns or unauthorized access attempts

6. **Use AWS IAM Access Analyzer**
   - Enable IAM Access Analyzer to identify any IAM resources shared outside your AWS account
   - Review findings to ensure that only verified and authorized users have access to your resources

7. **Generate IAM Credential Reports**
   - In the IAM Dashboard, go to "Credential reports" and generate a report
   - Review the report for details on all IAM users, including their access key age, password age, and MFA status

8. **Implement AWS Config Rules**
   - Enable AWS Config to continuously monitor IAM configurations
   - Create and apply AWS Config rules to check for compliance with identity verification and user management best practices

9. **Review IAM Roles and Groups**
   - Ensure that roles and groups are properly configured and assigned only to authorized users
   - Verify that roles have the correct trust relationships and that group memberships are appropriate for the user's responsibilities

10. **Schedule Regular Audits**
    - Set up regular intervals to audit IAM users and their access rights
    - Keep records of audit findings and remediation actions to maintain a secure and compliant AWS environment

### Via AWS CLI

```bash
# List all IAM users
aws iam list-users --query 'Users[].[UserName,CreateDate,PasswordLastUsed]' --output table

# Get details of specific user
aws iam get-user --user-name <USERNAME>

# Check if user has MFA enabled
aws iam list-mfa-devices --user-name <USERNAME>

# List policies attached to user
aws iam list-attached-user-policies --user-name <USERNAME>

# List access keys for user
aws iam list-access-keys --user-name <USERNAME>

# Generate credential report
aws iam generate-credential-report
aws iam get-credential-report --query 'Content' --output text | base64 -d
```

## Expected Result

- Only authorized IAM users exist in the account
- All users have undergone identity verification
- Users have appropriate MFA enabled
- Access keys are rotated regularly
- Permissions follow least privilege principle

## Remediation

### Via AWS Management Console

1. **Remove Unauthorized Users**
   - Go to the IAM Dashboard, select "Users," and review the list of users
   - Identify any unauthorized or unverified users and delete their accounts to prevent unauthorized access

2. **Enable Multi-Factor Authentication (MFA)**
   - For each IAM user, go to the "Security credentials" tab and enable MFA
   - Ensure all users have MFA configured to enhance security and reduce the risk of unauthorized access

3. **Update User Policies**
   - Review the policies attached to each IAM user
   - Modify policies to follow the principle of least privilege, ensuring users have only the permissions necessary for their role
   - Remove any overly permissive policies that could lead to security risks

4. **Rotate Access Keys**
   - For IAM users with long-lived access keys, create new keys and update the applications or services using them
   - In the IAM Dashboard, select "Users," go to the "Security credentials" tab, and create new access keys. Then, disable and delete old access keys after confirming the new keys are functioning correctly

5. **Review and Correct IAM Roles and Groups**
   - Ensure IAM roles are assigned only to authorized users and that trust relationships are properly configured
   - Check group memberships and remove users who should not be part of specific groups
   - Update role policies to adhere to the principle of least privilege

6. **Configure AWS Access Analyzer**
   - Enable IAM Access Analyzer to continuously monitor and analyze access to your IAM resources
   - Address any findings related to unauthorized or overly broad access permissions

7. **Implement and Enforce IAM Policies**
   - Create and enforce organizational IAM policies that require identity verification for all users
   - Use AWS Organizations and Service Control Policies (SCPs) to enforce these policies across all accounts within your organization

8. **Enable AWS Config and Create Compliance Rules**
   - Enable AWS Config to monitor IAM configurations and compliance
   - Create AWS Config rules to ensure users have MFA enabled, policies adhere to least privilege, and access keys are rotated regularly

9. **Conduct Regular Training**
   - Provide regular security awareness training for all users to emphasize the importance of secure IAM practices
   - Educate users on how to properly use IAM features and the significance of identity verification

10. **Schedule Regular Reviews and Audits**
    - Establish a schedule for regular audits of IAM configurations and access controls
    - Document findings and remediation actions taken during each audit
    - Continuously improve your IAM practices based on audit results and evolving security threats

### Via AWS CLI

```bash
# Create new IAM user
aws iam create-user --user-name <USERNAME>

# Attach policy to user
aws iam attach-user-policy \
  --user-name <USERNAME> \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess

# Enable MFA (requires MFA device configuration)
aws iam enable-mfa-device \
  --user-name <USERNAME> \
  --serial-number arn:aws:iam::ACCOUNT:mfa/<USERNAME> \
  --authentication-code-1 <CODE1> \
  --authentication-code-2 <CODE2>

# Delete unauthorized user
aws iam delete-user --user-name <UNAUTHORIZED_USER>
```

## Default Value

No IAM users exist by default. Users must be created by administrators.

## References

1. [Creating IAM Users](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 6.1 Establish an Access Granting Process | ● | ● | ● |

**CIS Control v8 - 6.1 Establish an Access Granting Process:**
Establish and follow a process, preferably automated, for granting access to enterprise assets upon new hire, rights grant, or role change of a user.

## Notes

- This is a **manual** control requiring identity verification processes
- All IAM users should represent real, verified individuals
- Avoid creating generic or shared user accounts
- Implement automated user lifecycle management where possible
- Document user onboarding and offboarding procedures
