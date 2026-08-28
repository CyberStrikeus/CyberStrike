---
name: cis-aws-compute-2.4
description: "Ensure an Organizational EC2 Tag Policy has been Created"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, tag-policy, organizations, compliance]
cis_id: "2.4"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.3, cis-aws-compute-2.14]
prerequisites: []
severity_boost: {}
---

# Ensure an Organizational EC2 Tag Policy has been Created

## Description

A tag policy enables you to define tag compliance rules to help you maintain consistency in the tags attached to your organization's resources.

## Rationale

You can use an EC2 tag policy to enforce your tag strategy across all of your EC2 resources.

## Impact

Creating and enforcing tag policies may prevent resource creation if tags do not comply with the defined policy, potentially affecting automated deployments.

## Audit Procedure

### Using AWS CLI

No specific CLI audit command is provided for this control. Use the console method below.

### Using AWS Console

1. Login to the AWS Organizations using https://console.aws.amazon.com/organizations/
2. On the left click `Policies`.
3. Click on `Tag policies`.
4. Confirm that a policy name exists with a description.
5. Click on the policy for EC2 Tagging as indicated in the name, description or both.
6. Click on `Edit policy`.
7. Confirm that `Tag key capitalization compliance` is checked.
8. Confirm that `Prevent non-compliant operations for this tag` is checked.
9. Confirm that `ec2:image`, `ec2:instance` and `ec2:reserved-instances` are listed.

If the tag policy does not exist with the settings listed above refer to the remediation below.

## Expected Result

An EC2 tag policy should exist with Tag key capitalization compliance enabled, non-compliant operations prevented, and ec2:image, ec2:instance, and ec2:reserved-instances resource types specified.

## Remediation

### Using AWS CLI

No specific CLI remediation command is provided for this control. Use the console method below.

### Using AWS Console

You must sign in as an IAM user, assume an IAM role, or sign in as the root user (not recommended) in the organization's management account.

To create a tag policy:

1. Login to the AWS Organizations using https://console.aws.amazon.com/organizations/
2. Left hand side Click on `Policies`.
3. Under `Support policy types` click on `Tag policies`.
4. Under `Available policies` click on `Create policy`.
5. Enter policy name.
6. Enter policy description (Indicate this is the EC2 tag policy).
7. For New tag key 1, specify the name of a tag key to add.
8. For `Tag key capitalization compliance` select the box for Use the capitalization to enable this option mandating a specific capitalization for the tag key using this policy.
9. For `Resource types to enforce` check the box for `Prevent non-compliant operations for this tag`.
10. Click on `Specify resource types`.
11. Expand EC2.
12. Select ec2:image, ec2:instance, ec2:reserved-instances.
13. Click `Save changes`.
14. Click `Create policy`.

## Default Value

No EC2 tag policies exist by default.

## References

1. https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_tag-policies-create.html

## CIS Controls

| Controls Version | Control                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x    | x    | x    |
| v7               | 1.5 Maintain Asset Inventory Information                       |      | x    | x    |

## Profile

Level 1 | Manual
