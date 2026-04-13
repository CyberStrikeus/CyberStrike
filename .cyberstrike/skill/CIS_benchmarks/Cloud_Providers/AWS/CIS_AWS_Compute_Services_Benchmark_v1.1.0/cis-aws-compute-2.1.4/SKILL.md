---
name: cis-aws-compute-2.1.4
description: "Ensure Images (AMI) are not older than 90 days"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, ami, age, patching, lifecycle]
cis_id: "2.1.4"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.1.3, cis-aws-compute-2.5]
prerequisites: []
severity_boost: {}
---

# Ensure Images (AMI) are not older than 90 days

## Description

Ensure that your AMIs are not older than 90 days.

## Rationale

Using up-to-date AMIs will provide many benefits from OS updates and security patches helping to ensure reliability, security and compliance.

## Impact

Outdated AMIs must be replaced by creating new images from updated instances. This requires a refresh cycle that involves launching instances, applying updates, creating new AMIs, and deregistering old ones.

## Audit Procedure

### Using AWS CLI

Run the aws ec2 describe-images command:

```bash
aws ec2 describe-images \
    --region <region> \
    --image-ids <image-ID>
```

Look for CreationDate in response.
If the age of the selected AMI is greater than 90 days, the AMI is considered outdated and it should be updated.

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane, under `Images`, click `AMIs`.
3. Select the AMI for review.
4. Under the `Details` tab.
5. Review the `Creation date`.

If the age of the selected AMI is greater than 90 days, the AMI is considered outdated and it should be updated.

6. Repeat steps no. 3 - 5 to verify the date of the other approved AMIs available.

Repeat all steps for the other regions.

## Expected Result

All AMIs should have a CreationDate within the last 90 days. Any AMI older than 90 days is considered non-compliant and should be updated.

## Remediation

### Using AWS CLI

No specific CLI remediation command is provided. Follow the console steps below to update AMIs.

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane, under `Images`, click `AMIs`.
3. Select the AMI to be updated.
4. Click on Launch.
5. Go through the EC2 Instance creation process.
6. Apply all system, security and application updates that are applicable to the EC2 instance.
7. Once completed click on `Instance state`, Stop instance.
8. Click on `Actions, Image and templates, Create image`.
9. Once the image process has complete return to the AMI list but clicking on `Images, AMIs`.
10. Select the AMI that is older than 90 days.
11. Click on `Actions, Deregister`.

Repeat these steps for any other AMIs older than 90 days.

## Default Value

AWS does not enforce any default age limit on AMIs.

## References

1. https://docs.aws.amazon.com/cli/latest/reference/ec2/describe-images.html
2. https://docs.aws.amazon.com/cli/latest/reference/ec2/deregister-image.html

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.2 Ensure Authorized Software is Currently Supported | x    | x    | x    |
| v7               | 2.2 Ensure Software is Supported by Vendor            | x    | x    | x    |

## Profile

Level 1 | Automated
