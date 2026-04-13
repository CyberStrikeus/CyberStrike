---
name: cis-aws-compute-2.14
description: "Ensure EC2 Auto Scaling Groups Propagate Tags to EC2 Instances that it launches"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, auto-scaling, tags, propagation, compliance]
cis_id: "2.14"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.3, cis-aws-compute-2.4]
prerequisites: []
severity_boost: {}
---

# Ensure EC2 Auto Scaling Groups Propagate Tags to EC2 Instances that it launches

## Description
Tags can help with managing, identifying, organizing, searching for, and filtering resources. Additionally, tags can help with security and compliance. Tags can be propagated from an Auto Scaling group to the EC2 instances that it launches.

## Rationale
Without tags, EC2 instances created via Auto Scaling can be without tags and could be out of compliance with security policy.

## Impact
No negative impact. Enabling tag propagation ensures all instances launched by Auto Scaling groups inherit the group's tags automatically.

## Audit Procedure

### Using AWS CLI

1. Run `aws autoscaling describe-auto-scaling-groups`:

```bash
aws autoscaling describe-auto-scaling-groups
```

2. Ensure `PropagateAtLaunch` is `true` under `Tags` for each Tag for the Auto Scaling Group.
3. Repeat Steps 1-2 for each AWS Region used.

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click All services and click EC2 under Compute.
3. Select Auto Scaling Groups.
4. For each Auto Scaling Group's Details, ensure that all tags have `Tag new instances` set to `Yes`.
5. Repeat Steps 1-4 for each AWS Region used.

## Expected Result
All tags in every Auto Scaling Group should have `PropagateAtLaunch` set to `true`. In the console, all tags should show `Tag new instances` set to `Yes`.

## Remediation

### Using AWS CLI
No specific CLI remediation command is provided for this control. Use the console method below.

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click All services and click EC2 under Compute.
3. Select Auto Scaling Groups.
4. Click `Edit` for each Auto Scaling Group.
5. Check the `Tag new instances` Box for the Auto Scaling Group.
6. Click `Update`.
7. Repeat Steps 1-6 for each AWS Region used.

## Default Value
By default, Auto Scaling group tags are not automatically propagated to launched instances unless `PropagateAtLaunch` is set to `true`.

## References
No specific references provided in the benchmark for this control.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v7 | 5.2 Maintain Secure Images | | x | x |

## Profile
Level 1 | Automated
