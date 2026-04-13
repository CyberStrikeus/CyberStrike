---
name: cis-aws-compute-2.11
description: "Ensure instances stopped for over 90 days are removed"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, stopped-instances, cleanup, lifecycle]
cis_id: "2.11"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.5, cis-aws-compute-2.12]
prerequisites: []
severity_boost: {}
---

# Ensure instances stopped for over 90 days are removed

## Description
Enable this rule to help with the baseline configuration of Amazon Elastic Compute Cloud (Amazon EC2) instances by checking whether Amazon EC2 instances have been stopped for more than the allowed number of days, according to your organization's standards.

## Rationale
Stopped instances that are no longer needed consume resources and may contain outdated configurations or unpatched software. Removing them reduces the attack surface and management overhead.

## Impact
Terminating instances is irreversible. Ensure data on the instance is backed up or no longer needed before termination.

## Audit Procedure

### Using AWS CLI
No specific CLI audit command is provided for this control. Use the console method below.

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane, click `Instances`, click `Instances`.
3. Select the Instance for review.
4. Under the `Details` tab.
5. Review the `Launch time`.

If the `Launch time` of the selected Instance is greater than 90 days, the Instance has been offline and is considered outdated.

6. Repeat steps no. 3 - 5 to verify the Launch date for the other instances.

Repeat all steps for the other regions.
Refer to the remediation procedure below if any of the `Launch times` are over 90 days.

## Expected Result
No stopped instances should have a Launch time older than 90 days. All stopped instances beyond this threshold should be terminated.

## Remediation

### Using AWS CLI
No specific CLI remediation command is provided for this control. Use the console method below.

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane, click `Instances`, click `Instances`.
3. Select the Instance for that hasn't been used for over 90 days.
4. Under the `Details` tab.
5. Click `Instance state`, click `Terminate instance`.
6. Click `Terminate`.

7. Repeat steps no. 3 - 6 the other instances with a launch date equal to or over 90 days.

Repeat all steps for the other regions.

## Default Value
AWS does not automatically terminate stopped instances. They remain in the stopped state indefinitely unless terminated.

## References
1. https://docs.aws.amazon.com/config/latest/developerguide/ec2-stopped-instance.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x | x | x |
| v7 | 1.4 Maintain Detailed Asset Inventory | x | x | x |

## Profile
Level 1 | Manual
