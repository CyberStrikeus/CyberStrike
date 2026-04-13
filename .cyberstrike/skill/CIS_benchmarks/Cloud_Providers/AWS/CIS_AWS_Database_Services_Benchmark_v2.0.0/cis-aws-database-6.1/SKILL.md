---
name: cis-aws-database-6.1
description: "Ensure Network Security is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, memorydb, redis, network, vpc, security-groups]
cis_id: "6.1"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-6.2, cis-aws-database-6.3, cis-aws-database-6.5]
prerequisites: []
severity_boost: {}
---

# 6.1 Ensure Network Security is Enabled (Manual)

## Description

Ensure network security is enabled for Amazon MemoryDB for Redis clusters by deploying them within a secure Virtual Private Cloud (VPC), configuring appropriate security groups, network ACLs, and VPC endpoints.

## Rationale

Network security controls are essential to isolate Amazon MemoryDB clusters from unauthorized access and ensure that only trusted sources can communicate with the clusters.

## Impact

Properly configured network security settings ensure that MemoryDB clusters are protected from unauthorized network access while allowing legitimate traffic.

## Audit Procedure

### Using AWS Console

1. Create or Select a Virtual Private Cloud (VPC)
   - Sign in to the AWS Management Console and open the Amazon VPC console at https://console.aws.amazon.com/vpc/.
   - Create a new VPC or select an existing VPC where you want to deploy your Amazon MemoryDB clusters.

2. Configure Subnets
   - In the VPC console, navigate to `Subnets` in the left-side menu.
   - Create or select the subnets within your VPC where you want to deploy your Amazon MemoryDB clusters.
   - Ensure you have private subnets to isolate your MemoryDB clusters from the public internet.

3. Define Security Groups
   - In the VPC console, navigate to `Security Groups` in the left-side menu.
   - Create a new security group or select an existing one for your Amazon MemoryDB clusters.
   - Configure inbound and outbound rules in the security group to control traffic access.
     - Allow inbound access only from trusted sources, such as specific IP ranges or security groups, on the necessary ports used by MemoryDB.
     - Define outbound rules based on your requirements, allowing outbound traffic to necessary destinations or ports.
   - Associate the security group with your Amazon MemoryDB clusters.

4. Configure Network Access Control Lists (ACLs)
   - In the VPC console, navigate to `Network ACLs` in the left-side menu.
   - Create or select the network ACLs associated with the subnets used by your Amazon MemoryDB clusters.
   - Configure inbound and outbound rules in the network ACLs to control traffic access.
     - Define rules based on your security requirements, allowing only necessary protocols, ports, and IP ranges.
     - Deny unnecessary or unwanted traffic.
   - Associate the network ACLs with the subnets used by your Amazon MemoryDB clusters.

5. Configure VPC Endpoints
   - In the VPC console, navigate to `Endpoints` in the left-side menu.
   - Create or select the VPC endpoints required for Amazon MemoryDB.
     - If you need to access MemoryDB from within your VPC, create a VPC endpoint for Amazon MemoryDB to connect your applications securely.
     - If you need to access MemoryDB from another VPC or on-premises network, set up VPC peering or a transit gateway to establish a secure connection.

6. Verify Connectivity and Test
   - Launch an Amazon EC2 instance within the same VPC and subnet as your Amazon MemoryDB clusters or use an existing one.
   - Connect to the EC2 instance using SSH or other remote access methods.
   - Test the connectivity to your Amazon MemoryDB clusters by trying to connect to them using the appropriate client or utility.
   - Verify that the network security settings allow the necessary traffic and deny unauthorized access.

## Expected Result

MemoryDB clusters are deployed in private subnets within a VPC, with security groups restricting access to only trusted sources and necessary ports.

## Remediation

### Using AWS Console

Follow the same steps as the audit procedure to configure VPC, subnets, security groups, network ACLs, and VPC endpoints for your Amazon MemoryDB clusters.

## Default Value

Amazon MemoryDB clusters must be deployed within a VPC. Default security group rules may allow all outbound traffic.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture      |      | X    | X    |
| v7               | 11.7 Manage Network Infrastructure Through a Dedicated Network |      | X    | X    |

## Profile

Level 1 | Manual
