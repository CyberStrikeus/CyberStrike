---
name: cis-aws-compute-10.4
description: "Ensure that HTTPS is enabled on load balancer"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, elastic-beanstalk, https, tls, load-balancer, encryption]
cis_id: "10.4"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-10.1, cis-aws-compute-10.2, cis-aws-compute-10.3]
prerequisites: []
severity_boost: {}
---

# 10.4 Ensure that HTTPS is enabled on load balancer (Manual)

## Description

The simplest way to use HTTPS with an Elastic Beanstalk environment is to assign a server certificate to your environment's load balancer.

## Rationale

When you configure your load balancer to terminate HTTPS, the connection between the client and the load balancer is secure.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com/elasticbeanstalk
2. On the left hand side click `Environments`
3. Click on the `Environment name` that you want to review
4. Under the "environment_name-env" click `Configuration`
5. Scroll down under Configurations
6. Under category look for `Load balancer`
7. Click `Edit`
8. Under the `Listeners` section
9. Check the Listeners section for any enabled listeners and make sure the Protocol is set to HTTPS and Enabled.
10. If the Listener is required for HTTP and is not set to HTTPS refer to the remediation below.
11. Repeat steps 3-10 for each environment within the current region.
12. Then repeat the Audit process for all other regions.

### Using AWS CLI

N/A - This control is manual and console-based.

## Expected Result

All enabled Listeners under the Load balancer configuration have their Protocol set to HTTPS and are Enabled.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com/elasticbeanstalk
2. On the left hand side click `Environments`
3. Click on the `Environment name` that you want to review
4. Under the "environment_name-env" click `Configuration`
5. Scroll down under Configurations
6. Under category look for `Load balancer`
7. Click `Edit`
8. Under the `Listeners` section
9. Click `Add listener`

```
Set listener port
Set Listener protocol to HTTPS
Set Instance Port
Sent Instance protocol to HTTPS
Select your SSL certificate
```

10. Click `Add`
11. Make sure it is listed as enabled. If you have other listeners not using HTTPS make sure to turn off enabled
12. Click `Apply` to save the configuration changes.
13. Repeat steps 3-12 for each environment within the current region.
14. Then repeat the remediation for all other regions.

### Using AWS CLI

N/A - This control is manual and console-based.

## Default Value

HTTPS is not configured on Elastic Beanstalk load balancers by default.

## References

1. https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/configuring-https.html

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | X    | X    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | X    | X    |

## Profile

Level 1 | Manual
