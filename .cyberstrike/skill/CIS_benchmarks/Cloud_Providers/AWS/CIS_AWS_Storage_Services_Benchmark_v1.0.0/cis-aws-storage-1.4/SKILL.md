---
name: cis-aws-storage-1.4
description: "Ensure to create AWS IAM Policies"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, backup, iam, iam-policy, access-control, least-privilege]
cis_id: "1.4"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: [CWE-284]
chains_with: [cis-aws-storage-1.2, cis-aws-storage-1.5, cis-aws-storage-1.6]
prerequisites: [cis-aws-storage-1.1]
severity_boost: {}
---

# CIS Control 1.4: Ensure to create AWS IAM Policies (Manual)

## Profile Applicability

- **Level 2**

## Description

AWS IAM policies specify the desired permissions for accessing AWS resources and define the conditions under which those permissions are granted. Configure the appropriate policies to keep your resources secure.

## Rationale

Managing AWS IAM policies is crucial to safeguard your backups from unauthorized access, ensuring that only approved users can manipulate or view sensitive data.

Properly configured IAM policies implement the principle of least privilege, granting only the minimum permissions necessary for users and services to perform their designated tasks. This minimizes the risk of accidental or malicious data exposure and unauthorized backup modifications.

## Impact

Not implementing proper IAM policies for AWS Backup can lead to:

- Unauthorized access to backup data
- Backup tampering or deletion by unauthorized users
- Non-compliance with regulatory requirements
- Inability to track who accessed or modified backups
- Privilege escalation vulnerabilities

## Audit Procedure

### Via AWS Management Console

To create a role for AWS Backup, follow these steps:

1. Navigate to the "IAM Dashboard" in the AWS Console
2. Select "Roles" from the left-hand menu
3. Click on the "Create Role" button
4. Choose "AWS Service" as the trusted entity
5. Select "AWS Backup" as the service that will use this role
6. Choose a policy to apply to the role or create a custom policy
7. Review the role details and provide a meaningful name for the role
8. Click on "Create Role" to finalize the creation of the role for AWS Backup

### Via AWS CLI

```bash
# List IAM policies related to backups
aws iam list-policies --scope Local | grep -i backup

# Get a specific policy document
aws iam get-policy --policy-arn <POLICY_ARN>

# Get policy version details
aws iam get-policy-version \
  --policy-arn <POLICY_ARN> \
  --version-id <VERSION_ID>

# List roles and their attached policies
aws iam list-roles | grep -i backup

# List policies attached to a specific role
aws iam list-attached-role-policies --role-name <ROLE_NAME>
```

## Expected Result

- IAM policies for AWS Backup follow least privilege principle
- Backup-specific policies are created and properly scoped
- Policies clearly define permissions for backup operations (create, delete, restore)
- Access to backup vaults is restricted through IAM policies

## Remediation

### Via AWS Management Console

1. **Navigate to IAM Dashboard**
   - Go to IAM service in AWS Console

2. **Create Custom Policy**
   - Click "Policies" → "Create policy"
   - Use JSON editor or visual editor
   - Define permissions for backup operations
   - Add conditions for additional security

3. **Example Policy Structure**
   - Allow backup creation and management
   - Restrict backup deletion to specific roles
   - Enable restore operations for authorized users
   - Limit access to specific backup vaults

4. **Apply Policy to Roles/Users**
   - Attach policy to IAM roles used by AWS Backup
   - Assign to users who need backup management access

### Via AWS CLI

```bash
# Create an IAM policy for backup operations
aws iam create-policy \
  --policy-name BackupAdministratorPolicy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "backup:CreateBackupPlan",
          "backup:CreateBackupSelection",
          "backup:StartBackupJob",
          "backup:ListBackupPlans",
          "backup:ListBackupVaults",
          "backup:DescribeBackupVault"
        ],
        "Resource": "*"
      },
      {
        "Effect": "Deny",
        "Action": [
          "backup:DeleteBackupPlan",
          "backup:DeleteBackupVault"
        ],
        "Resource": "*",
        "Condition": {
          "StringNotEquals": {
            "aws:PrincipalArn": "arn:aws:iam::ACCOUNT:role/BackupAdministrator"
          }
        }
      }
    ]
  }'

# Attach policy to a role
aws iam attach-role-policy \
  --role-name BackupServiceRole \
  --policy-arn arn:aws:iam::ACCOUNT:policy/BackupAdministratorPolicy
```

## Default Value

AWS provides managed policies like `AWSBackupServiceRolePolicyForBackup` and `AWSBackupServiceRolePolicyForRestores`, but custom policies should be created for granular control.

## References

1. [AWS IAM Policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html)
2. [AWS Backup IAM Policies](https://docs.aws.amazon.com/aws-backup/latest/devguide/security-iam.html)

## CIS Controls

Not mapped to specific CIS Controls v7 or v8 in the provided documentation.

## Notes

- This is a **manual** control requiring policy review and configuration
- Implement least privilege for all backup-related IAM policies
- Separate backup creation permissions from deletion permissions
- Use IAM conditions to restrict access based on tags, time, or source IP
- Regularly audit IAM policies for over-permissive access
- Consider using AWS Organizations SCPs for additional backup protection
