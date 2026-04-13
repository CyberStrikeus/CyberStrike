---
name: cis-aws-storage-1.6
description: "Ensure AWS Backup with Service Linked Roles"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, backup, iam, service-linked-role, automation]
cis_id: "1.6"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-1.4, cis-aws-storage-1.5]
prerequisites: [cis-aws-storage-1.1]
severity_boost: {}
---

# CIS Control 1.6: Ensure AWS Backup with Service Linked Roles (Manual)

## Profile Applicability

- **Level 2**

## Description

AWS Service Linked Roles are IAM roles designed specifically for AWS Backup. These roles come with default configurations allowing access to all AWS resources by default.

## Rationale

While Service Linked Roles offer quick deployment, using default configurations isn't recommended for security best practices.

Service Linked Roles provide:

- **Quick Setup**: Automatically created when you first use AWS Backup
- **Managed Permissions**: AWS maintains the permissions needed for backup operations
- **Ease of Use**: No manual policy management required

However, organizations should assess whether the default permissions align with their security requirements and consider custom roles for production environments where tighter controls are needed.

## Impact

Using Service Linked Roles without proper assessment can result in:

- Over-permissive access to AWS resources
- Difficulty implementing principle of least privilege
- Potential compliance violations if default permissions are too broad
- Reduced visibility into specific backup permissions

Benefits of properly configured Service Linked Roles:

- Simplified initial setup
- Automatic updates to permissions as AWS Backup evolves
- Reduced administrative overhead for basic backup operations

## Audit Procedure

### Via AWS Management Console

Create service-linked role for AWS Backup:

You don't need to create a service-linked role manually. AWS Backup automatically creates it when you list resources for back up, set up cross-account backup, or perform backups using the AWS Management Console, AWS CLI, or AWS API.

If you delete this role, you can recreate it by following the same steps. AWS Backup will create it for you again when needed.

1. **Check for Service-Linked Role**
   - Navigate to IAM → Roles
   - Search for roles with "AWSServiceRoleForBackup" prefix
   - Verify the role exists and review its permissions

2. **Review Trust Relationship**
   - Ensure the role can only be assumed by backup.amazonaws.com
   - Verify no unauthorized principals can assume the role

### Via AWS CLI

```bash
# List service-linked roles for AWS Backup
aws iam list-roles | grep AWSServiceRoleForBackup

# Get details of the service-linked role
aws iam get-role --role-name AWSServiceRoleForBackup

# List policies attached to service-linked role
aws iam list-attached-role-policies \
  --role-name AWSServiceRoleForBackup

# Get policy details
aws iam get-policy \
  --policy-arn arn:aws:iam::aws:policy/aws-service-role/BackupServiceRolePolicyForBackup
```

## Expected Result

- AWS Service Linked Role for Backup exists (AWSServiceRoleForBackup)
- Role has appropriate AWS-managed policies attached
- Trust relationship is correctly configured for backup.amazonaws.com service
- Organization has assessed whether service-linked role permissions align with security requirements

## Remediation

### Via AWS Management Console

1. **Automatic Creation (Recommended Initial Setup)**
   - Simply use AWS Backup for the first time
   - The service-linked role is created automatically
   - No manual intervention required

2. **Assessment of Service-Linked Role**
   - Review default permissions
   - Determine if permissions align with security policies
   - Decide whether to use service-linked role or create custom role (see control 1.5)

3. **If Custom Role is Preferred**
   - Follow guidance in control 1.5 to create custom IAM role
   - Use more restrictive permissions
   - Assign custom role to backup plans instead of service-linked role

### Via AWS CLI

The service-linked role is created automatically. To verify its existence:

```bash
# Check if service-linked role exists
aws iam get-role --role-name AWSServiceRoleForBackup

# If you need to recreate it (after deletion)
# Simply perform any backup operation via CLI:
aws backup list-backup-vaults

# The role will be automatically recreated
```

**Note**: You cannot manually create the service-linked role using AWS CLI. It must be created automatically by the service.

## Default Value

When using the AWS Backup console for the first time, you can choose to have AWS Backup create a default service role for you. This role has the permissions that AWS Backup needs to create and restore backups on your behalf.

The service-linked role includes these AWS-managed policies:

- `BackupServiceRolePolicyForBackup`
- `BackupServiceRolePolicyForRestores`

## References

1. [AWS Backup - Using Service-Linked Roles](https://docs.aws.amazon.com/aws-backup/latest/devguide/using-service-linked-roles.html)
2. [AWS IAM Service-Linked Roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/using-service-linked-roles.html)

## CIS Controls

Not mapped to specific CIS Controls v7 or v8 in the provided documentation.

## Notes

- This is a **manual** control requiring organizational assessment
- Service-linked roles are appropriate for:
  - Initial setup and testing
  - Organizations with standard backup requirements
  - Environments where AWS-managed permissions are acceptable
- Consider custom roles (control 1.5) for:
  - Production environments with strict security requirements
  - Compliance-driven organizations
  - Scenarios requiring fine-grained access control
- Assess your organization's needs to determine whether to utilize Service Linked Roles for AWS backups
- Document the decision and rationale for using service-linked vs. custom roles
