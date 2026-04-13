---
name: cis-aws-euc-2.11
description: "Ensure your WorkSpaces image has the appropriate CIS Operating System Benchmark applied"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, os-hardening, compliance]
cis_id: "2.11"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure your WorkSpaces image has the appropriate CIS Operating System Benchmark applied (Manual)

## Description

Utilize the CIS Benchmark to secure the Operating system image that you are utilizing for your WorkSpaces.

## Rationale

Securing the Operating system with a CIS Benchmark ensures all systems remain in a secure, compliant and hardened state.

## Impact

None

## Audit Procedure

### Using AWS Console

Spin up a WorkSpaces instance and run a manual assessment by confirming the CIS Operating System Benchmark recommendations for the applicable operating system are applied. You can also utilize a 3rd Party Assessment tool that has been certified for the specific CIS Operating System Benchmark to automate this process.

### Expected Result

The WorkSpaces image should have the appropriate CIS Operating System Benchmark applied.

## Remediation

### Using AWS Console

Perform the steps below using the downloaded free version of the applicable CIS Operating System Benchmark and manually apply the recommendations for the WorkSpaces instance. Or Utilize a 3rd Party tool to assess and apply the CIS Operating System Benchmark.

1. Launch a WorkSpaces Bundle
2. Access that WorkSpace as an Administrator utilize SSH or RDP.
3. Apply the Benchmark:
   - Manually
   - Using Active Directory by creating a GPO that matches the Benchmark.
   - Or using a Third Party tool that will apply the Benchmark recommendations.
4. Assess the WorkSpaces instance manually or with a 3rd Party tool.
5. Create a workspace bundle that can then be used to launch your production WorkSpaces instances.

## Default Value

By default, this feature is not native to AWS and therefore is not enabled by default.

## References

1. https://www.cisecurity.org/partners-vendor/
2. https://docs.aws.amazon.com/workspaces/latest/adminguide/create-custom-bundle.html
3. https://docs.aws.amazon.com/workspaces/latest/adminguide/update-custom-bundle.html

## CIS Controls

**Controls Version v8:**
- 4.1 Establish and Maintain a Secure Configuration Process

**Controls Version v7:**
- 5.1 Establish Secure Configurations

## Profile

Level 1
