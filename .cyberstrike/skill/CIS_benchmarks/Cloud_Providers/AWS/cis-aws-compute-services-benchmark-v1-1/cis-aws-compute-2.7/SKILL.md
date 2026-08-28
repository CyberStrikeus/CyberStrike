---
name: cis-aws-compute-2.7
description: "Ensure Default EC2 Security groups are not being used"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, security-groups, default, network-security]
cis_id: "2.7"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.8]
prerequisites: []
severity_boost: {}
---

# Ensure Default EC2 Security groups are not being used

## Description

When an EC2 instance is launched a specified custom security group should be assigned to the instance.

## Rationale

When an EC2 Instance is launched the default security group is automatically assigned. In error a lot of instances are launched in this way, and if the default security group is configured to allow unrestricted access, it will increase the attack footprint allowing the opportunity for malicious activity.

## Impact

Instances using the default security group must be migrated to custom security groups. This may require updating application configurations and testing connectivity.

## Audit Procedure

### Using AWS CLI

1. Run the describe-instances command:

```bash
aws ec2 describe-instances --region us-east-1 --output json --filters "Name=instance.group-name,Values=default" --query "Reservations[*].Instances[*].{Instance:InstanceId}"
```

2. The command output should return an empty list if the default security group is not being used.
3. If there is a list of instance IDs then the default security group is currently attached to those EC2 instances.
4. Refer to the remediation below using list of EC2 Instance ids captured.

NOTE Repeat the audit process for all other regions used.

### Using AWS Console

1. Login to EC2 using https://console.aws.amazon.com/ec2/
2. On the left Click `INSTANCES`, click `Instances`.
3. On the EC2 Instances page, click inside the attributes filter box.
4. Click the Security Group Name from the dropdown list.
5. Type `default` for the attribute value. (This filter will detect the EC2 instances currently associated with the default security group)
6. Refer to the remediation below using list of EC2 Instance ids captured.

NOTE Repeat the audit process for all other regions used.

## Expected Result

The CLI command should return an empty list, indicating no EC2 instances are using the default security group.

## Remediation

### Using AWS CLI

No specific CLI remediation command is provided for this control. Use the console method below to remove inbound rules from default security groups.

### Using AWS Console

1. Login to EC2 using https://console.aws.amazon.com/ec2/
2. On the left Click `Network & Security`, click `Security Groups`.
3. Select `Security Groups`.
4. Click on the `default Security Group` you want to review.
5. Click `Actions, View details`.
6. Select the `Inbound rules` tab.
7. Click on `Edit inbound rules`.
8. Click on `Delete` for all the rules listed.
9. Once there are no rules listed click on 'Save rules'.
10. Repeat steps no. 3 - 8 for any other default security groups listed.

## Default Value

AWS automatically creates a default security group for each VPC. The default security group allows all inbound traffic from other instances in the same security group and all outbound traffic.

## References

1. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/describe-security-groups.html
2. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/default-custom-security-groups.html#default-security-group

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Manual
