---
name: cis-aws-compute-2.10
description: "Ensure unused ENIs are removed"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, eni, network-interfaces, unused, cleanup]
cis_id: "2.10"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.7, cis-aws-compute-2.2.4]
prerequisites: []
severity_boost: {}
---

# Ensure unused ENIs are removed

## Description

Identify and delete any unused Amazon AWS Elastic Network Interfaces in order to adhere to best practices and to avoid reaching the service limit. An AWS Elastic Network Interface (ENI) is pronounced unused when is not attached anymore to an EC2 instance.

## Rationale

Removing unused ENIs helps maintain a clean environment, reduces potential attack surface, and avoids reaching service limits.

## Impact

Deleting an ENI is permanent. Ensure the ENI is truly unused before removal.

## Audit Procedure

### Using AWS CLI

1. Run describe-network-interfaces command:

```bash
aws ec2 describe-network-interfaces --region us-east-1 --output json --filters Name=status,Values=available --query "NetworkInterfaces[*].{ENI:NetworkInterfaceId}"
```

2. The command output should return an empty list if no unused ENIs exist.
3. If there is a list of ENI IDs then refer to the remediation below.
4. Repeat steps 1 - 3 to determine the current status for any other `ENIs` within the current region.

NOTE Repeat the audit process for all other regions used.

### Using AWS Console

1. Login to EC2 using https://console.aws.amazon.com/ec2/
2. On the left Click `NETWORK & SECURITY`, click `Network Interfaces`.
3. Select the ENI that you want to review.
4. Go to the Details tab.
5. Check the value set for the Status attribute.
6. If it says `available`, refer to the remediation below.
7. Repeat steps 3 - 6 to determine the current status for any other `ENIs` within the current region.

NOTE Repeat the audit process for all other regions used.

## Expected Result

The CLI command should return an empty list, indicating no ENIs are in the `available` (unattached) state.

## Remediation

### Using AWS CLI

1. Run the delete-network-interface command with the ENI names collected above in the audit:

```bash
aws ec2 delete-network-interface --region us-east-1 --network-interface-id eni-1234abcd
```

2. This will remove the ENI that is not being used.
3. Repeat steps 1 - 2 for any `ENIs` within the current region.

NOTE Repeat the audit process for all other regions used.

### Using AWS Console

1. Login to EC2 using https://console.aws.amazon.com/ec2/
2. On the left Click `NETWORK & SECURITY`, click `Network Interfaces`.
3. Select the ENI that you want to remove.
4. Click 'Actions', then 'delete'.
5. Click `Delete`.
6. Repeat steps 3 - 5 any other `ENIs` listed in the audit within the current region.

NOTE Repeat the audit process for all other regions used.

## Default Value

ENIs are not automatically cleaned up when detached from instances.

## References

No specific references provided in the benchmark for this control.

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture          |      | x    | x    |
| v7               | 11.1 Maintain Standard Security Configurations for Network Devices |      | x    | x    |

## Profile

Level 1 | Manual
