---
name: cis-aws-storage-1.2
description: "Ensure securing AWS Backups"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, backup, aws-backup, security, disaster-recovery, iam]
cis_id: "1.2"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-1.1, cis-aws-storage-1.3, cis-aws-storage-1.4, cis-aws-storage-1.5]
prerequisites: [cis-aws-storage-1.1]
severity_boost: {}
---

# CIS Control 1.2: Ensure securing AWS Backups (Manual)

## Profile Applicability

- **Level 2**

## Description

As an AWS administrator, it's important to know what you're responsible for. You're responsible for keeping things safe in the cloud, which means taking care of the resources and data on AWS. Here's what you need to secure, according to AWS documentation:

1. Responsible for alert communication with AWS
2. Managing access credentials for AWS resources
3. Configuring backup plans according to organization policies
4. Ensuring backup recovery capability
5. Including AWS Backups in the organization's disaster recovery procedures
6. Ensuring user awareness and familiarity with AWS Backups platform usage

## Rationale

AWS will send periodic emails regarding the status of your backups and any service issues. The administrator must address any communicated issues from AWS, such as billing problems or backup inactivity, and take necessary steps to resolve them.

## Impact

Failure to secure AWS Backups properly can result in:

- Inability to recover from data loss incidents
- Unauthorized access to backup data
- Non-compliance with regulatory requirements
- Backup tampering or deletion by malicious actors
- Increased recovery time during disasters

## Audit Procedure

### Via AWS Management Console

**CREATING AN AWS BACKUP:**

Creating an AWS Backup involves selecting the desired data, specifying backup frequency, and choosing storage options. Below we'll walk through how to create and configure an AWS Backup instance.

1. **Sign into AWS Console**
   - To sign into the AWS Console `https://console.aws.amazon.com/billing/home#/`, users navigate to the AWS Management Console website and enter their credentials, including their username and password

2. **Access the AWS Backup Service Dashboard in the AWS Management Console**
   - AWS Management Console and type "Backup" or navigate through the services menu to find the "Storage" category, where AWS Backup is listed

3. **Create Backup Plan**
   - Choose "Create backup plan" from the options provided. You can either create a custom plan tailored to your requirements or option for a pre-defined template offered by AWS

### Via AWS CLI

```bash
# List backup plans to verify they exist
aws backup list-backup-plans

# Describe a specific backup plan
aws backup get-backup-plan --backup-plan-id <PLAN_ID>

# List backup vaults
aws backup list-backup-vaults

# Check backup vault access policy
aws backup get-backup-vault-access-policy --backup-vault-name <VAULT_NAME>
```

## Expected Result

- Backup plans are configured and active
- Access credentials are properly managed through IAM
- Backup recovery has been tested
- AWS Backups are integrated into disaster recovery procedures
- Users are trained on AWS Backup usage
- Alert communication channels are established

## Remediation

### Via AWS Management Console

1. **Configure Backup Plans**
   - Navigate to AWS Backup service
   - Create or update backup plans according to organizational policies
   - Define backup frequency, retention, and lifecycle policies

2. **Secure Access Credentials**
   - Use IAM roles instead of long-term credentials where possible
   - Enable MFA for backup administration activities
   - Implement least privilege access

3. **Test Backup Recovery**
   - Regularly perform restore tests
   - Document recovery procedures
   - Validate recovered data integrity

4. **Integrate with Disaster Recovery**
   - Include backup restoration in DR runbooks
   - Define RPO (Recovery Point Objective) and RTO (Recovery Time Objective)
   - Establish escalation procedures

5. **User Training**
   - Conduct regular training on AWS Backup features
   - Document backup and restore procedures
   - Maintain runbooks for common scenarios

### Via AWS CLI

```bash
# Create backup vault with encryption
aws backup create-backup-vault \
  --backup-vault-name secure-vault \
  --encryption-key-arn arn:aws:kms:region:account:key/key-id

# Set backup vault access policy (restrict access)
aws backup put-backup-vault-access-policy \
  --backup-vault-name secure-vault \
  --policy file://vault-policy.json
```

## Default Value

AWS Backup has no default security configurations. All security measures must be explicitly configured by the administrator.

## References

1. [AWS Backup - What is Backup](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html)
2. [AWS Backup Security](https://docs.aws.amazon.com/aws-backup/latest/devguide/security.html)

## CIS Controls

Not mapped to specific CIS Controls v7 or v8 in the provided documentation.

## Notes

- This is a **manual** control requiring administrative procedures and processes
- Establish regular communication channels with AWS support
- Monitor AWS Health Dashboard for backup service status
- Implement automated alerting for backup failures
- Consider cross-account backup for additional protection
