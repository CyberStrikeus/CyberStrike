---
name: cis-aws-compute-2.8
description: "Ensure the Use of IMDSv2 is Enforced on All Existing Instances"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, imdsv2, metadata, ssrf, instance-metadata]
cis_id: "2.8"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.7, cis-aws-compute-2.13]
prerequisites: []
severity_boost: {}
---

# Ensure the Use of IMDSv2 is Enforced on All Existing Instances

## Description
Ensure the Instance Metadata Service Version 2 (IMDSv2) method is enabled on all running instances.

## Rationale
The IMDSv2 method uses session-based controls to help protect access and control of Amazon Elastic Compute Cloud (Amazon EC2) instance metadata. With IMDSv2, controls can be implemented to restrict changes to instance metadata.

## Impact
Once you enforce IMDSv2, then IMDSv1 no longer works, and applications that use IMDSv1 might not function correctly. Before enforcing IMDSv2, verify that any applications that use Amazon EC2 metadata are upgraded to a version that supports IMDSv2.

## Audit Procedure

### Using AWS CLI

1. Run the describe-instances command:

```bash
aws ec2 describe-instances --region us-east-1 --output text --filter "Name=metadata-options.http-tokens,Values=optional" --query "Reservations[*].Instances[*].{Instance:InstanceId}"
```

2. The output should look like this:

```
i-1234567abcdefghi0
i-1234567abcdefghi0
i-1234567abcdefghi0
```

The list above contains all the instances that have the metadata version set to optional which means either IMDSv1 or IMDSv2 can be used. Refer to the remediation below.

Repeat steps 1 - 2 for the other AWS regions.

### Using AWS Console

1. At this time the instance metadata setting for existing instances can only be reviewed and confirmed using AWS CLI.

## Expected Result
The CLI command should return an empty list, indicating all instances have http-tokens set to `required` (enforcing IMDSv2). Any instances listed are using optional mode allowing IMDSv1.

## Remediation

### Using AWS CLI

1. Run the modify-instance-metadata-options command using the list of Instances collected in the audit:

```bash
aws ec2 modify-instance-metadata-options --instance-id i-1234567abcdefghi0 --http-tokens required --http-endpoint enabled
```

2. The output should show the information for the instance and the metadata changes:

```json
{
    "InstanceId": "i-1234567abcdefghi0",
    "InstanceMetadataOptions": {
        "State": "pending",
        "HttpTokens": "required",
        "HttpPutResponseHopLimit": 1,
        "HttpEndpoint": "enabled"
    }
}
```

3. Repeat for the other instances and regions collected during the audit.

### Using AWS Console

1. At this time the instance metadata setting for existing instances can only be changed using AWS CLI.

## Default Value
By default, new EC2 instances may allow both IMDSv1 and IMDSv2 (http-tokens set to optional) depending on region and account settings.

## References
1. https://aws.amazon.com/premiumsupport/knowledge-center/ssm-ec2-enforce-imdsv2/
2. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html
3. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html
4. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/launching-instance.html#configure_instance_details_step
5. https://docs.aws.amazon.com/config/latest/developerguide/ec2-imdsv2-check.html
6. https://docs.aws.amazon.com/systems-manager-automation-runbooks/latest/userguide/automation-aws-enforce-ec2-imdsv2.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile
Level 2 | Manual
