---
name: cis-aws-compute-2.1.5
description: "Ensure Images are not Publicly Available"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, ami, public-access, permissions]
cis_id: "2.1.5"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.1.3, cis-aws-compute-2.2.2]
prerequisites: []
severity_boost: {}
---

# Ensure Images are not Publicly Available

## Description
EC2 allows you to make an AMI public, sharing it with all AWS accounts.

## Rationale
Publicly sharing an AMI with all AWS accounts could expose organizational data and configuration information.

## Impact
Making an AMI private may affect other AWS accounts that depend on it. Ensure shared accounts are explicitly added if needed.

## Audit Procedure

### Using AWS CLI
No specific CLI audit command is provided for this control. Use the console method below.

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane, under `Images`, click `AMIs`.
3. Confirm the `Owned by me` is set.
4. Select the AMI from the list.
5. Click on the `Permissions` Tab.
6. If this reads `This image is currently Public`, please refer to the remediation below.

## Expected Result
All AMIs should have their permissions set to Private. No AMI should display "This image is currently Public" in the Permissions tab.

## Remediation

### Using AWS CLI
No specific CLI remediation command is provided for this control. Use the console method below.

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane, under `Images`, click `AMIs`.
3. Confirm the `Owned by me` is set.
4. Select the AMI from the list.
5. Click on the `Permissions` Tab.
6. Click on `Edit`.
7. Click on the radio button `Private`.

Add AWS Account Number if you have a need to share with other Internal AWS accounts that your Organization owns.

## Default Value
By default, AMIs are private when created. They must be explicitly made public.

## References
1. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/sharing-amis.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 11.3 Protect Recovery Data | x | x | x |
| v7 | 5.3 Securely Store Master Images | | x | x |

## Profile
Level 1 | Manual
