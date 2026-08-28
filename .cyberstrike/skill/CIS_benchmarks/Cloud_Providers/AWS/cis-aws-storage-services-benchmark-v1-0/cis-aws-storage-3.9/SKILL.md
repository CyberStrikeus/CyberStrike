---
name: cis-aws-storage-3.9
description: "Ensure using VPC endpoints - EFS"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, vpc-endpoints, privatelink, network-security]
cis_id: "3.9"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-3.3, cis-aws-storage-3.4]
prerequisites: []
severity_boost: {}
---

# 3.9 Ensure using VPC endpoints - EFS (Manual)

## Profile Applicability

- Level 2

## Description

With AWS PrivateLink, VPC Endpoints allow services to communicate within AWS using private IP addresses within approved CIDR ranges. This communication can be achieved without the need for a VPN, ensuring secure and efficient data transfer.

## Rationale

The rationale behind using AWS PrivateLink with VPC Endpoints is to enable secure and efficient communication between services within AWS. By using private IP addresses within approved CIDR ranges, it eliminates the need for a VPN, reducing complexity and potential points of failure. This approach enhances security, reduces latency, and ensures data remains within the AWS network, aligning with best practices for secure and reliable cloud architecture.

## Impact

Not using AWS PrivateLink with VPC Endpoints can lead to several issues, including increased security risks and potential data exposure since services would need to communicate over the public internet or through more complex VPN setups. This can result in higher latency, reduced performance, and greater vulnerability to attacks. Additionally, managing VPN connections adds complexity and potential points of failure, compromising the overall efficiency and reliability of your network architecture.

## Audit Procedure

### Console

Creating a FIPS compliant interface endpoint for EFS:

1. Navigate to VPC Console: https://console.aws.amazon.com/vpc/
2. Select "Endpoints" on the sidebar.
3. Select "Create endpoint".
4. Name the endpoint.
5. Copy and paste this services into the services bar:
   `com.amazonaws.region.elasticfilesystem-fips` – replace "region: with us-east-1 or whatever region you're using.
6. Select your VPC.
7. For subnets, select the availability zone and then select private subnet.
8. Select the Security Group for the VPC endpoint.
9. For policy: select "full access".
10. Create a tag for future reference / granular IAM permissions.
11. Create endpoint.

## Expected Result

- VPC endpoint should be created for EFS service
- Endpoint should use FIPS-compliant service name
- Endpoint should be associated with appropriate VPC and subnets
- Security group should be configured for the endpoint
- Full access policy should be configured (or restricted as per requirements)

## Remediation

### Console

Use VPC Endpoints in tandem with AWS Private Link to secure your EFS connections.

1. Navigate to VPC Console
2. Create VPC endpoint for EFS
3. Configure endpoint with appropriate VPC, subnets, and security groups
4. Use FIPS-compliant service endpoint: `com.amazonaws.[region].elasticfilesystem-fips`
5. Configure access policy as needed

## Default Value

VPC endpoints are not created by default. Users must explicitly create and configure VPC endpoints for EFS to enable private connectivity.

## References

1. https://docs.aws.amazon.com/efs/latest/ug/efs-vpc-endpoints.html#:~:text=To%20establish%20a%20private%20connection,private%20network%20(VPN)%20connection.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 13.5 Manage Access Control for Remote Assets<br/>Manage access control for assets remotely connecting to enterprise resources. Determine amount of access to enterprise resources based on: up-to-date anti-malware software installed, configuration compliance with the enterprise's secure configuration process, and ensuring the operating system and applications are up-to-date. |      | ●    | ●    |
| v8               | 14.5 Train Workforce Members on Causes of Unintentional Data Exposure<br/>Train workforce members to be aware of causes for unintentional data exposure. Example topics include mis-delivery of sensitive data, losing a portable end-user device, or publishing data to unintended audiences.                                                                                          | ●    | ●    | ●    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running<br/>Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.                                                                                                                                                                         |      | ●    | ●    |
| v7               | 13.1 Maintain an Inventory Sensitive Information<br/>Maintain an inventory of all of the sensitive information stored, processed, or transmitted by the organization's technology systems, including those located onsite or at a remote service provider.                                                                                                                              | ●    | ●    | ●    |

## Profile

Level 2
