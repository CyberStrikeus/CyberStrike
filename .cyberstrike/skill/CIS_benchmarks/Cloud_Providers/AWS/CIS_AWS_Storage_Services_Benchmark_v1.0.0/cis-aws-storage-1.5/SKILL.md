---
name: cis-aws-storage-1.5
description: "Ensure to create IAM roles for Backup"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, backup, iam, iam-role, service-role, least-privilege]
cis_id: "1.5"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: [CWE-284]
chains_with: [cis-aws-storage-1.4, cis-aws-storage-1.6]
prerequisites: [cis-aws-storage-1.1, cis-aws-storage-1.4]
severity_boost: {}
---

# CIS Control 1.5: Ensure to create IAM roles for Backup (Manual)

## Profile Applicability

- **Level 2**

## Description

An AWS Identity and Access Management (IAM) role is similar to a user, in that it is an AWS identity with permissions policies that determine what the identity can and cannot do in AWS. However, instead of being uniquely associated with one person, a role is intended to be assumable by anyone who needs it.

## Rationale

While Service Linked Roles offer quick deployment, using default configurations isn't recommended for security best practices.

Creating custom IAM roles for AWS Backup allows you to:

- Implement principle of least privilege
- Control exactly which services and resources the backup service can access
- Audit and track backup operations more effectively
- Separate backup permissions from other administrative functions

## Impact

Not properly configuring IAM roles for AWS Backup can result in:

- Over-permissive backup access using default service roles
- Inability to track which role performed backup operations
- Difficulty implementing fine-grained access controls
- Compliance violations related to access management
- Potential for backup service to access resources beyond what's necessary

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
# List IAM roles related to backup
aws iam list-roles | grep -i backup

# Get details of a specific backup role
aws iam get-role --role-name <ROLE_NAME>

# List policies attached to the backup role
aws iam list-attached-role-policies --role-name <ROLE_NAME>

# Get the trust relationship (assume role policy)
aws iam get-role --role-name <ROLE_NAME> \
  --query 'Role.AssumeRolePolicyDocument'
```

## Expected Result

- Custom IAM roles exist for AWS Backup operations
- Roles follow least privilege principle
- Trust relationships only allow AWS Backup service to assume the role
- Roles have clear, descriptive names indicating their purpose
- Role policies are scoped to necessary resources only

## Remediation

### Via AWS Management Console

1. **Create Custom IAM Role for Backup**
   - Navigate to IAM → Roles → Create role
   - Select "AWS service" as trusted entity type
   - Choose "Backup" from the service list
   - Select use case (e.g., "Backup")

2. **Attach Appropriate Policies**
   - Use AWS managed policies as a baseline:
     - `AWSBackupServiceRolePolicyForBackup`
     - `AWSBackupServiceRolePolicyForRestores`
   - Or create custom policies for tighter control

3. **Configure Trust Relationship**
   - Ensure only AWS Backup service can assume the role
   - Verify no overly permissive trust policies

4. **Name the Role Appropriately**
   - Use descriptive names like `CustomBackupServiceRole` or `ProdBackupRole`
   - Add tags for organization and tracking

### Via AWS CLI

```bash
# Create trust policy document for AWS Backup service
cat > backup-trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "backup.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the IAM role
aws iam create-role \
  --role-name CustomAWSBackupRole \
  --assume-role-policy-document file://backup-trust-policy.json \
  --description "Custom IAM role for AWS Backup operations"

# Attach AWS managed backup policy
aws iam attach-role-policy \
  --role-name CustomAWSBackupRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup

# Attach restore policy
aws iam attach-role-policy \
  --role-name CustomAWSBackupRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores
```

## Default Value

When using the AWS Backup console for the first time, you can choose to have AWS Backup create a default service role for you. This role has the permissions that AWS Backup needs to create and restore backups on your behalf.

The default service-linked role is created automatically but may have broader permissions than necessary for your specific use case.

## References

1. [AWS IAM Service-Linked Roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/using-service-linked-roles.html)
2. [AWS Backup IAM Roles](https://docs.aws.amazon.com/aws-backup/latest/devguide/iam-service-roles.html)

## CIS Controls

Not mapped to specific CIS Controls v7 or v8 in the provided documentation.

## Notes

- This is a **manual** control requiring IAM role configuration
- Avoid using overly permissive default roles in production
- Assess your organization's needs to determine whether to utilize Service Linked Roles for AWS backups
- Regularly review role permissions to ensure they remain appropriate
- Use separate roles for different environments (production, development, testing)
- Consider using AWS Organizations to enforce role creation standards
- Audit role usage through CloudTrail logs
