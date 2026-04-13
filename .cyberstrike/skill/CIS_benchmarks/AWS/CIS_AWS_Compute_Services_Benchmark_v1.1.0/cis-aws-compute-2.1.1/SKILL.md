---
name: cis-aws-compute-2.1.1
description: "Ensure Consistent Naming Convention is used for Organizational AMI"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, ami, naming-convention, inventory]
cis_id: "2.1.1"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.1.2, cis-aws-compute-2.1.3]
prerequisites: []
severity_boost: {}
---

# Ensure Consistent Naming Convention is used for Organizational AMI

## Description
The naming convention for AMI (Amazon Machine Images) should be documented and followed for any AMI's created.

## Rationale
The majority of AWS resources can be named and tagged. Most organizations have already created standardize naming conventions, and have existing rules in effect. They simply need to extend that for all AWS cloud resources to include Amazon Machine Images (AMI).

## Impact
No significant operational impact. This is an organizational best practice that improves manageability and consistency of AMI resources.

## Audit Procedure

### Using AWS CLI

1. Run aws ec2 describe-images.

```bash
aws ec2 describe-images --owner self --region us-west-2
```

2. Review the list of AMIs.
3. Confirm that the AMI Name matches the organizational image naming policy.

If any of the AMI Name's do not match the Organization policy refer to the remediation below.

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane, under `Images`, click `AMIs`.
3. Review the list of AMIs.
4. Confirm that the AMI Name matches the organizational image naming policy.

## Expected Result
All AMI names should follow the organization's documented naming convention. The output of describe-images should show AMIs with consistent, policy-compliant names.

## Remediation

### Using AWS CLI
No specific CLI remediation command is provided. Use the console method to copy and rename AMIs that do not comply with the naming policy.

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane click `Images`, click `AMIs`.
3. Select the AMI that does not comply to the naming policy.
4. Click on `Actions`.
5. Click on `Copy AMI`.

```
Destination region - Select the region the AMI is in.
Name - `Enter the new Name`
Description - `Enter the new description`
Encryption - `Select` if it matches your image policy
```

6. Click on Copy AMI

Once the AMI has finished copying:

7. Select the AMI that does not comply to the naming policy.
8. Click on `Actions`.
9. Click on `Deregister`.

## Default Value
AWS does not enforce any default naming convention for AMIs.

## References
1. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/describe-images.html
2. https://docs.aws.amazon.com/AWSEC2/latest/WindowsGuide/AMIs.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x | x | x |
| v7 | 1.4 Maintain Detailed Asset Inventory | x | x | x |

## Profile
Level 1 | Manual
