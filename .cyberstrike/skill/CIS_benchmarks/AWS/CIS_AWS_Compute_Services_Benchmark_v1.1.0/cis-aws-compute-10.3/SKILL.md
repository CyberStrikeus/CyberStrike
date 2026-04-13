---
name: cis-aws-compute-10.3
description: "Ensure access logs are enabled"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, elastic-beanstalk, access-logs, load-balancer, logging]
cis_id: "10.3"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-10.1, cis-aws-compute-10.2, cis-aws-compute-10.4]
prerequisites: []
severity_boost: {}
---

# 10.3 Ensure access logs are enabled (Manual)

## Description
When you enable load balancing, your AWS Elastic Beanstalk environment is equipped with an Elastic Load Balancing load balancer to distribute traffic among the instances in your environment.

## Rationale
For security reasons it is important to have a record of all the access logs and this is enabled within the Load Balancer assigned to the Elastic Beanstalk environments.

## Impact
N/A

## Audit Procedure

### Using AWS Console
1. Login to AWS Console using https://console.aws.amazon.com/ec2
2. On the left hand scroll down to Load Balancing and click on `Load Balancers`
3. Click on the Load balancer associated with the Elastic Beanstalk Environment

```
Typically they have AWSEB in the name.
If you utilized Elastic Beanstalk to create the Load balancer the Source
Security Group listed in the Description will reference `Elastic Beanstalk`
```

4. Under the `Description` tab scroll down to the `Attributes` section
5. Confirm `Access logs` is set to Enabled.
6. If status options reads `Disabled` refer to the remediation below.
7. Repeat steps 3-8 for each environment within the current region.
8. Then repeat the Audit process for all other regions.

### Using AWS CLI
N/A - This control is manual and console-based.

## Expected Result
`Access logs` is set to Enabled under the Attributes section on the Load Balancer Description tab.

## Remediation

### Using AWS Console
1. Login to AWS Console using https://console.aws.amazon.com/ec2
2. On the left hand scroll down to Load Balancing and click on `Load Balancers`
3. Click on the Load balancer associated with the Elastic Beanstalk Environment

```
Typically they have AWSEB in the name.
If you utilized Elastic Beanstalk to create the Load balancer the Source
Security Group listed in the Description will reference `Elastic Beanstalk~`
```

4. Under the `Description` tab scroll down to the `Attributes` section
5. Under Access logs - Disabled click on Configure access logs.
6. Click the check box next to `Enable access logs`.
7. Enter the S3 bucket name you have setup for the Elastic Beanstalk access logs.
   **Note - if you don't have a S3 bucket already created enter an organization name in accordance with policy and have it identify with Elastic Beanstalk. Then click the check box next to `Create this location for me`
8. Click `Save`
9. Scroll down under the description tab and confirm that the Access logs are set as described above.
10. Repeat steps 3-11 for each Load balancer created and used with Elastic Beanstalk environment within the current region.
11. Then repeat the remediation process for all other regions identified in the Audit.

### Using AWS CLI
N/A - This control is manual and console-based.

## Default Value
Access logs are disabled by default on Load Balancers.

## References
1. https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/using-features.managing.elb.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.2 Collect Audit Logs | X | X | X |
| v7 | 6.2 Activate audit logging | X | X | X |

## Profile
Level 1 | Manual
