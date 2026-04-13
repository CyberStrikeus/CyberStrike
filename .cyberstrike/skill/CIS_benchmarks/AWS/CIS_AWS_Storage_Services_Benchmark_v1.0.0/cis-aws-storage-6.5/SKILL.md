---
name: cis-aws-storage-6.5
description: "Ensure proper IAM configuration for AWS Elastic Disaster Recovery"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, iam, access-control, mfa, least-privilege, authentication]
cis_id: "6.5"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.1, cis-aws-storage-6.6]
prerequisites: []
severity_boost: {}
---

# CIS 6.5: Ensure proper IAM configuration for AWS Elastic Disaster Recovery (Manual)

## Profile Applicability

- **Level:** 2

## Description

Set up and maintain Identity and Access Management (IAM) roles and policies specifically for AWS Elastic Disaster Recovery. This includes defining least-privilege access for users and services, creating roles for automated processes, and enforcing multi-factor authentication (MFA) for added security. Regularly review and update IAM policies to adapt to changes in the organization and to maintain compliance with security best practices, ensuring that only authorized personnel and services can access and manage disaster recovery resources.

## Rationale

Proper IAM configuration for AWS Elastic Disaster Recovery ensures that only authorized users and services have access to critical recovery functions, reducing the risk of unauthorized access and potential security breaches. Implementing least-privilege access and MFA enhances security by limiting permissions and adding an extra layer of authentication. Regular reviews and updates of IAM policies help maintain security compliance and adapt to organizational changes, ensuring continuous protection of disaster recovery resources.

## Impact

Implementing proper IAM configuration requires:
- Creation and maintenance of specialized IAM roles
- Policy development for least-privilege access
- MFA enforcement for human users
- Regular policy reviews and updates
- Audit trail monitoring

## Audit Procedure

### Via AWS Console

**To create DRS Agent User:**

1. Navigate to the AWS IAM Console: [https://us-east-1.console.aws.amazon.com/iam/home?region=us-east-1#/home](https://us-east-1.console.aws.amazon.com/iam/home?region=us-east-1#/home)

2. Create new user:
   - This user will be able to access the Elastic disaster recovery agent installation resource.
   - Name the user "DSRuser"

3. Allow Programmatic access:
   - This allows the user to access resources programmatically with a secure key rather than having to enter a password.

4. Elect "attach policies directly" and search for "AWSElasticDisasterRecoveryAgentInstallationPolicy"

5. Create user.

**To create Failback Agent User:**

Follow the steps above with these two modifications:

1. Name the user "FailbackAgentuser"
2. Apply the "AWSElasticDisasterRecoveryFailbackInstallationPolicy"

## Expected Result

- DRS Agent User created with name "DSRuser"
- Programmatic access enabled for DSRuser
- AWSElasticDisasterRecoveryAgentInstallationPolicy attached to DSRuser
- Failback Agent User created with name "FailbackAgentuser"
- Programmatic access enabled for FailbackAgentuser
- AWSElasticDisasterRecoveryFailbackInstallationPolicy attached to FailbackAgentuser
- No additional unnecessary permissions granted
- MFA enabled for human users with EDR access
- IAM policies follow least-privilege principle
- Regular policy review schedule established

## Remediation

### Via AWS Console

1. **Create DRS Agent User:**
   - Navigate to AWS IAM Console
   - Create new user named "DSRuser"
   - Enable programmatic access
   - Attach "AWSElasticDisasterRecoveryAgentInstallationPolicy"
   - Create user

2. **Create Failback Agent User:**
   - Navigate to AWS IAM Console
   - Create new user named "FailbackAgentuser"
   - Enable programmatic access
   - Attach "AWSElasticDisasterRecoveryFailbackInstallationPolicy"
   - Create user

3. **Enforce MFA:**
   - For all human users with EDR access
   - Configure MFA requirements in IAM policies

4. **Review Permissions:**
   - Audit all EDR-related IAM policies
   - Remove unnecessary permissions
   - Implement least-privilege access

5. **Establish Review Schedule:**
   - Set up regular IAM policy reviews
   - Document review process
   - Update policies as needed

## Default Value

Configure IAM Credentials for AWS Elastic Disaster Recovery.

By default, no specialized IAM users or policies for EDR exist. Organizations must manually create and configure IAM resources.

## References

- [AWS IAM Console](https://us-east-1.console.aws.amazon.com/iam/home?region=us-east-1#/home)
- [AWS Elastic Disaster Recovery IAM Policies](https://docs.aws.amazon.com/drs/latest/userguide/security-iam.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.7 Centralize Access Control<br/>Centralize access control for all enterprise assets through a directory service or SSO provider, where supported. | | ● | ● |
| v8 | 6.8 Define and Maintain Role-Based Access Control<br/>Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. | | | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |
| v7 | 14.7 Enforce Access Control to Data through Automated Tools<br/>Use an automated tool, such as host-based Data Loss Prevention, to enforce access controls to data even when data is copied off a system. | | | ● |

## Profile

- Level 2
