---
name: cis-aws-storage-3.12
description: "Ensure configuring IAM for AWS Elastic Disaster Recovery"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, disaster-recovery, iam, drs, replication, failback]
cis_id: "3.12"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.12 Ensure configuring IAM for AWS Elastic Disaster Recovery (Manual)

## Profile Applicability
- Level 2

## Description
Before installing the AWS Elastic Disaster Recovery client, you need to configure AWS IAM permissions and users for both the AWS Replication and AWS Failback Client.

## Rationale
Configuring AWS IAM permissions and users before installing the AWS Elastic Disaster Recovery client ensures that the AWS Replication and AWS Failback Client have the necessary access rights. This setup is essential for maintaining security and preventing unauthorized access. Proper IAM configuration guarantees the smooth operation of disaster recovery processes, safeguarding your data and ensuring system reliability.

## Impact
Without proper IAM configuration for AWS Elastic Disaster Recovery, the AWS Replication and AWS Failback Client may lack the necessary access rights, leading to failed disaster recovery operations. This can result in data loss, prolonged downtime, and compromised system reliability. Additionally, inadequate IAM permissions increase the risk of unauthorized access, potentially exposing sensitive data and causing security breaches. Consequently, your organization may face significant operational disruptions, financial losses, and damage to its reputation.

## Audit Procedure

### Console

To create DRS Agent User, follow following steps:

1. Navigate to the AWS IAM Console - https://us-east-1.console.aws.amazon.com/iam/home?region=us-east-1#/home
2. Create new user. This user will only be able to access the Elastic disaster recovery agent installation resource. Accordingly, name the user "DSRuser".
3. Allow Programmatic access: This allows the user to access resources programmatically with a secure key rather than having to enter a password.
4. Select "attach policies directly" and search for "AWSElasticDisasterRecoveryAgentInstallationPolicy".
5. Create user.

To create Failback Agent User, Follow the steps above with these two modifications:

1. Name the user "FailbackAgentuser".
2. Apply the "AWSElasticDisasterRecoveryFailbackInstallationPolicy".

## Expected Result
- IAM user "DSRuser" should be created with programmatic access
- "AWSElasticDisasterRecoveryAgentInstallationPolicy" should be attached to DSRuser
- IAM user "FailbackAgentuser" should be created with programmatic access
- "AWSElasticDisasterRecoveryFailbackInstallationPolicy" should be attached to FailbackAgentuser
- Both users should have appropriate access keys configured

## Remediation

### Console

Configure IAM Credentials for AWS Elastic Disaster Recovery:

1. **Create DRS Agent User**:
   - Navigate to AWS IAM Console: https://us-east-1.console.aws.amazon.com/iam/home?region=us-east-1#/home
   - Create new user named "DSRuser"
   - Enable "Programmatic access"
   - Attach policy: "AWSElasticDisasterRecoveryAgentInstallationPolicy"
   - Create user and save access keys

2. **Create Failback Agent User**:
   - Create new user named "FailbackAgentuser"
   - Enable "Programmatic access"
   - Attach policy: "AWSElasticDisasterRecoveryFailbackInstallationPolicy"
   - Create user and save access keys

3. **Secure Access Keys**:
   - Store access keys securely
   - Rotate keys regularly
   - Monitor usage via CloudTrail

## Default Value
By default, AWS does not create IAM users or attach policies for Elastic Disaster Recovery. Users must explicitly create these IAM users and attach the required managed policies.

## References
1. https://us-east-1.console.aws.amazon.com/iam/home?region=us-east-1#/home

## CIS Controls

This control does not have specific CIS Controls mappings in the original document, but it aligns with general IAM and disaster recovery best practices.

## Profile
Level 2
