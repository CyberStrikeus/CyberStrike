---
name: cis-aws-compute-6.1
description: "Ensure you are using VPC Endpoints for source code access"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, app-runner, vpc-endpoint, encryption, privatelink]
cis_id: "6.1"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1 Ensure you are using VPC Endpoints for source code access (Manual)

## Description
App Runner needs access to your application source, so it can't be encrypted. Therefore, be sure to secure the connection between your development or deployment environment and App Runner.

## Rationale
Client-side encryption isn't a valid method for protecting the source image or code that you provide to App Runner for deployment. Using a VPC endpoint, you can privately connect your VPC to supported AWS services and VPC endpoint services that are powered by AWS PrivateLink.

Note that this isn't required if you are deploying your app runner directly from an ECR image as ECR images can be independently encrypted.

## Impact
N/A

## Audit Procedure

### Using AWS Console
1. Login to the AWS Console using https://console.aws.amazon.com/vpc/
2. On the left hand side, click Endpoints.
3. On the `Endpoints` page.
4. Review all the endpoints listed under name.
5. Locate the Endpoint assigned and configured for App Runner.
6. If there is no Endpoint set for App Runner refer to the remediation below.
7. Either click the check box, Actions, View Details or click on the VPC endpoint ID.
8. Confirm these settings:

```
1. Service name - `com.amazonaws."region".apprunner`
**Note - "Region" will reflect the region that you are operating in.
2. Status - Available
3. VPC ID - correctly associated for use with the service
4. Subnets tab - correctly associated for use with the service
5. Security Groups tab - correctly associated for use with the service
6. Policy tab - correctly configured for use with the service
```

9. If the settings listed above are not correct refer to the remediation below.

### Using AWS CLI
N/A - This control is manual and console-based.

## Expected Result
A VPC endpoint for App Runner exists with service name `com.amazonaws."region".apprunner`, status is Available, and VPC ID, Subnets, Security Groups, and Policy are correctly configured.

## Remediation

### Using AWS Console
To create an interface endpoint for an App Runner:

1. Login to the AWS Console using https://console.aws.amazon.com/vpc/
2. On the left hand side, click Endpoints.
3. Click `Create endpoint`.
4. Under Service category, choose AWS services.
5. For Service name, select `com.amazonaws."region".apprunner`. "Region" will reflect the region that your are operating in.
6. For VPC, select the VPC from which you'll access App Runner.
7. For Subnets, select one subnet per Availability Zone.
8. For Security group, select the security groups to associate with the App Runner endpoint network interfaces.
9. For Policy, select Custom to attach a VPC endpoint policy that controls the permissions that principals have for performing actions on resources over the VPC endpoint.
10. Click `Create endpoint`.

### Using AWS CLI
N/A - This control is manual and console-based.

## Default Value
No VPC endpoint is configured for App Runner by default.

## References
- https://docs.aws.amazon.com/apprunner/latest/dg/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | X | X |
| v8 | 3.12 Segment Data Processing and Storage Based on Sensitivity | | X | X |
| v7 | 5.2 Maintain Secure Images | | X | X |
| v7 | 10.4 Ensure Protection of Backups | X | X | X |

## Profile
Level 1 | Manual
