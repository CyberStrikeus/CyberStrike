---
name: cis-aws-storage-2.10
description: "Ensure Resource Access via Tag-based Policies"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, iam, tags, abac, tag-based-policy, ec2]
cis_id: "2.10"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: [CWE-284]
chains_with: [cis-aws-storage-2.9]
prerequisites: []
severity_boost: {}
---

# CIS Control 2.10: Ensure Resource Access via Tag-based Policies (Manual)

## Profile Applicability

- **Level 2**

## Description

For optimal granularity in EC2 access, configuring IAM policies via tags proves highly effective. This involves editing the policy text editor to specify access permissions based on specific tags.

## Rationale

Implementing IAM policies based on tags in EC2 enables administrators to finely tailor access control, granting permissions dynamically according to resource attributes. This approach enhances security and scalability by aligning access rights with specific resource requirements while minimizing manual intervention.

## Audit Procedure

### Via AWS CLI

\`\`\`bash

# Check IAM policies for tag-based conditions

aws iam list-policies --scope Local
aws iam get-policy-version \
 --policy-arn <POLICY_ARN> \
 --version-id <VERSION_ID> | grep -i "aws:ResourceTag"
\`\`\`

## Remediation

Review existing IAM policies associated with EC2 resources to ensure they include tag-based conditions. Modify policies to incorporate tag-based conditions for granular access control.

## References

1. [Tag-based IAM Policies](https://docs.aws.amazon.com/tag-editor/latest/userguide/tags-in-iam-policies.html)

## CIS Controls

| Controls Version | Control                                                     | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.7 Centralize Access Control                               |      | ●    | ●    |
| v7               | 14.7 Enforce Access Control to Data through Automated Tools |      |      | ●    |
