---
name: cis-aws-database-5.4
description: "Ensure Automatic Updates and Patching are Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, patching, updates, vulnerability-management]
cis_id: "5.4"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.7]
prerequisites: []
severity_boost: {}
---

# 5.4 Ensure Automatic Updates and Patching are Enabled

## Description

Enabling automatic updates and patching for Amazon ElastiCache ensures that your ElastiCache clusters run the latest software versions with important security fixes and enhancements.

## Rationale

Automatic updates help the software be updated and address any vulnerabilities within the software that can help business with any potential exists that can impact the business and prevent any unauthorized access.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console
   - Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the ElastiCache Console
   - Open the Amazon ElastiCache console by navigating to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/elasticache/.

3. Select the ElastiCache Cluster
   - Choose the ElastiCache cluster you want to enable automatic updates and patching.
   - Click on the cluster name to access its details page.

4. Enable Automatic Updates
   - Click on the `Configuration` tab on the cluster details page.
   - Scroll down to the `Cluster details` section.
   - Under `Cluster maintenance and updates`, click `Modify`.
   - In the `Maintenance and updates` dialog, find the `Auto minor version upgrade` option and select `Enable`.
   - Leave other settings unchanged or adjust them according to your requirements.
   - Click `Save` to apply the changes.

5. Verify Automatic Updates Status
   - Wait a few moments for the changes to take effect.
   - Refresh the cluster details page to see the updated configuration.
   - Verify that the "Auto minor version upgrade" setting is now enabled for the ElastiCache cluster.

## Expected Result

Auto minor version upgrade is enabled for all ElastiCache clusters.

## Remediation

### Using AWS Console

Follow the same steps as the audit procedure to enable automatic updates and patching for ElastiCache clusters.

## Default Value

By default, auto minor version upgrade may not be enabled for ElastiCache clusters.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------- | ---- | ---- | ---- |
| v8               | 7 Continuous Vulnerability Management |      |      |      |
| v7               | 3 Continuous Vulnerability Management |      |      |      |

## Profile

Level 1 | Manual
