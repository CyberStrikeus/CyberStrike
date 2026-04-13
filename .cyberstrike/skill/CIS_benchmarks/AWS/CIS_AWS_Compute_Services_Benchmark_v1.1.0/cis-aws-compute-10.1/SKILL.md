---
name: cis-aws-compute-10.1
description: "Ensure Managed Platform updates is configured"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, elastic-beanstalk, managed-updates, patching, platform]
cis_id: "10.1"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-10.2, cis-aws-compute-10.3, cis-aws-compute-10.4]
prerequisites: []
severity_boost: {}
---

# 10.1 Ensure Managed Platform updates is configured (Manual)

## Description
AWS Elastic Beanstalk regularly releases platform updates to provide fixes, software updates, and new features. With managed platform updates, you can configure your environment to automatically upgrade to the latest version of a platform during a scheduled maintenance window.

## Rationale
Your application remains in service during the update process with no reduction in capacity. Managed updates are available on both single-instance and load-balanced environments. They also ensure you aren't introducing any vulnerabilities by running legacy systems that require updates and patches.

## Impact
N/A

## Audit Procedure

### Using AWS Console
1. Login to AWS Console using https://console.aws.amazon.com/elasticbeanstalk
2. On the left hand side click `Environments`
3. Click on the `Environment name` that you want to review
4. Under the `environment_name-env` in the left column click `Configuration`
5. Scroll down under Configurations
6. Under category look for `Managed updates`
7. Confirm `Managed updates: enabled`
8. If status options reads `Managed updates: disabled` refer to the remediation below.
9. Repeat steps 3-8 for each environment within the current region.
10. Then repeat the Audit process for all other regions.

### Using AWS CLI
N/A - This control is manual and console-based.

## Expected Result
`Managed updates: enabled` is displayed under the Managed updates category in the environment Configuration.

## Remediation

### Using AWS Console
1. Login to AWS Console using https://console.aws.amazon.com/elasticbeanstalk
2. On the left hand side click `Environments`
3. Click on the `Environment name` that you want to update
4. Under the `environment_name-env` in the left column click `Configuration`
5. Scroll down under Configurations
6. Under category look for `Managed updates`
7. Click on Edit
8. On the Managed Platform Updates page:

```
Managed updates - click the Enable checkbox
Weekly update window - set preferred maintenance window
Update level- set it to Minor and patch
Instance replacement - click the Enabled checkbox
```

9. Click Apply
10. Repeat steps 3-8 for each environment within the current region that needs Managed updates set.
11. Then repeat the remediation process for all other regions identified in the Audit.

### Using AWS CLI
N/A - This control is manual and console-based.

## Default Value
Managed platform updates are not enabled by default.

## References
1. https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/environment-platform-update-managed.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 7.4 Perform Automated Application Patch Management | X | X | X |
| v7 | 3.5 Deploy Automated Software Patch Management Tools | X | X | X |

## Profile
Level 1 | Manual
