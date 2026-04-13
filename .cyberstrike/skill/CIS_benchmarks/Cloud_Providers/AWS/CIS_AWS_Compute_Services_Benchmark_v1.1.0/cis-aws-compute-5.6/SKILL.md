---
name: cis-aws-compute-5.6
description: "Disable IPv6 Networking if not in use within your organization"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lightsail, ipv6, networking, attack-surface]
cis_id: "5.6"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-5.3, cis-aws-compute-5.4, cis-aws-compute-5.5]
prerequisites: []
severity_boost: {}
---

# 5.6 Disable IPv6 Networking if not in use within your organization (Manual)

## Description

Any protocols enable within Lightsail by default that aren't being used should be disabled.

## Rationale

Any ports enable within Lightsail by default are open and exposed to the world. This can result in outside traffic trying to access or even deny access to the Lightsail instances. Removing and disabling a protocol when not in use even if restricted by IP address is the safest solution especially when it is not required for access.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Windows or Linux Instance` you want to review.
5. Go to the Networking section.
6. Under IPv6 networking confirm that it reads `IPv6 networking is disabled`.
7. If it reads `IPv6 networking is enabled` refer to the remediation below.

### Using AWS CLI

N/A - This setting is managed through the AWS Console.

## Expected Result

IPv6 networking should be disabled on Lightsail instances when not in use within the organization.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Windows or Linux Instance` you want to review.
5. Go to the Networking section.
6. Under IPv6 networking click on the check mark next to `IPv6 networking is enabled`.
7. In the `Disable IPv6 for this instance?`
8. Click on `Yes, disable`

### Using AWS CLI

N/A - This setting is managed through the AWS Console.

## Default Value

IPv6 networking is enabled by default on new Lightsail instances.

## References

N/A

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function. |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.                                       |      | x    | x    |

## Profile

Level 1 | Manual
