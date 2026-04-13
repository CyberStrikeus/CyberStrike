---
name: cis-aws-foundations-2.16
description: "Ensure IAM instance roles are used for AWS resource access from instances"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, ec2, instance-roles, credentials, least-privilege]
cis_id: "2.16"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.14, cis-aws-foundations-2.12]
prerequisites: []
severity_boost: {}
---

# Ensure IAM instance roles are used for AWS resource access from instances

## Description
AWS access from within EC2 instances can be achieved either by embedding AWS access keys into applications or by assigning an IAM role to the instance with the appropriate permissions. "AWS access" refers to making API calls to AWS services to access or manage resources.

## Rationale
IAM roles reduce the risks associated with storing, sharing, and rotating long-term credentials. Compromised credentials can be used outside of AWS, whereas IAM role credentials are temporary and tied to the instance.

Additionally, credentials embedded in applications or configuration files are more difficult to rotate and are more likely to be exposed over time, increasing the risk of unauthorized access.

## Impact
Using embedded credentials instead of IAM roles increases the risk of credential exposure and unauthorized access, particularly if credentials are not rotated or are improperly stored.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console and navigate to the EC2 dashboard at https://console.aws.amazon.com/ec2/
2. In the left navigation panel, choose `Instances`
3. Select the EC2 instance you want to examine
4. Select `Actions`
5. Select `View details`
6. Review the following:
- If `IAM Role` contains a role, it is compliant
- If `IAM Role` is blank, it is non-compliant
- If an `Instance profile ARN` exists but no role is attached, it is non-compliant
7. Repeat for all EC2 instances

### Using AWS CLI

1. List all EC2 instances:

```bash
aws ec2 describe-instances --region <region-name> --query 'Reservations[*].Instances[*].InstanceId'
```

2. Check for IAM instance profiles:

```bash
aws ec2 describe-instances --region <region-name> --instance-id <Instance-ID> --query 'Reservations[*].Instances[*].IamInstanceProfile'
```

3. If no IAM instance profile is returned, the instance does not have a role attached
4. Repeat for all instances and regions

## Expected Result
Every running EC2 instance should have an IAM instance profile with an appropriate role attached. No instance should rely on embedded access keys for AWS API calls.

## Remediation

### Using AWS Console

1. Sign in to the AWS Management Console and navigate to the EC2 dashboard at https://console.aws.amazon.com/ec2/
2. In the left navigation panel, choose `Instances`
3. Select the EC2 instance you want to modify
4. Click `Actions`
5. Click `Security`
6. Click `Modify IAM role`
7. Select an existing IAM role or create a new one
8. Click `Update IAM role`
9. Repeat for all applicable instances

### Using AWS CLI

1. Identify instances without roles (all regions):

```bash
for r in $(aws ec2 describe-regions --query "Regions[].RegionName" --output text); do aws ec2 describe-instances --region "$r" --query "Reservations[].Instances[?IamInstanceProfile==null].[InstanceId, '$r']" --output text done
```

2. Attach an instance profile:

```bash
aws ec2 associate-iam-instance-profile --region <region-name> --instance-id <Instance-ID> --iam-instance-profile Name="Instance-Profile-Name"
```

3. Verify the role is attached:

```bash
aws ec2 describe-instances --region <region-name> --instance-id <Instance-ID> --query 'Reservations[*].Instances[*].IamInstanceProfile'
```

4. Repeat steps 2 and 3 for each EC2 instance in your AWS account that requires an IAM role to be attached.

## Default Value
By default, EC2 instances are launched without an IAM role attached. Applications must use embedded credentials unless an instance role is configured.

## References
1. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2.html
2. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control - Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. | | | x |
| v7 | 14.1 Segment the Network Based on Sensitivity - Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs). | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1078.004 | TA0001, TA0004 | M1026 |

## Profile
Level 2 | Automated
