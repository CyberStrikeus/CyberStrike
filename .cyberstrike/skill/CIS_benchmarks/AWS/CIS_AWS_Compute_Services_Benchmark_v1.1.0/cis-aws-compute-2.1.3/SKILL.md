---
name: cis-aws-compute-2.1.3
description: "Ensure Only Approved Amazon Machine Images (AMIs) are Used"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, ami, approved-images, inventory]
cis_id: "2.1.3"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.1.1, cis-aws-compute-2.1.4, cis-aws-compute-2.1.5]
prerequisites: []
severity_boost: {}
---

# Ensure Only Approved Amazon Machine Images (AMIs) are Used

## Description

Ensure that all base AMIs utilized are approved for use by your organization.

## Rationale

An approved AMI is a base EC2 machine image that is a pre-configured OS configured to run your application. Using approved AMIs helps enforce consistency and security.

## Impact

Instances running on unapproved AMIs may need to be replaced with instances built from approved AMIs, which could cause temporary service disruption.

## Audit Procedure

### Using AWS CLI

No specific CLI audit command is provided for this control. Use the console method to manually verify AMI approval status.

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane click on `Images`.
3. Then choose `AMIs`.
4. Confirm that `Owned by me` is selected.
5. Review the list of AMIs.
6. Confirm that the AMIs listed are all approved for use.
7. In the left pane click on `Instances`.
8. Then choose `Instances`.
9. Select the EC2 instance for review.
10. In the Details tab review:

```
AMI Name
AMI location
```

11. Confirm that the AMI name matches an approved AMI and the AMI location is within your account.
12. Repeat steps 9 - 11 to verify the AMI is approved.

Repeat the process for all other regions.
If any of the AMIs are not approved refer to the remediation below.

## Expected Result

All EC2 instances should be running on organization-approved AMIs. The AMI Name and AMI location should match entries in the organization's approved AMI list.

## Remediation

### Using AWS CLI

No specific CLI remediation command is provided. Use the console method below.

### Using AWS Console

**Remove unauthorized AMIs:**

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane click on `Images`.
3. Then choose `AMIs`.
4. Confirm that `Owned by me` is selected.
5. Review the list of AMIs.
6. Confirm that the AMIs listed are all approved for use.
7. If an AMI is listed that is not approved select it.
8. Click on `Actions` and choose `Deregister`.

**After all unauthorized AMIs have been De-registered review all EC2 instances:**

1. Click on `Instances`.
2. Then choose `Instances`.
3. Select the `EC2 instance` for review.
4. In the `Details` tab review:

```
AMI Name
AMI location
```

5. If this information is listed as not available this instance was built with an unauthorized AMI.
6. Follow organization steps to secure this instance and replace it with an instance built from an approved AMI if applicable.
7. Repeat steps 3 - 6 to verify all instance have been created with approved AMIs.

Repeat the process for all other regions.

## Default Value

AWS does not enforce any default AMI approval process. Any AMI can be used to launch instances.

## References

No specific references provided in the benchmark for this control.

## CIS Controls

| Controls Version | Control                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x    | x    | x    |
| v7               | 1.4 Maintain Detailed Asset Inventory                          | x    | x    | x    |

## Profile

Level 1 | Manual
