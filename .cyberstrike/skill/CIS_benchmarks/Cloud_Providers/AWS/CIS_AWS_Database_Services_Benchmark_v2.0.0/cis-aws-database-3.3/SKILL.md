---
name: cis-aws-database-3.3
description: "Ensure to Create a Virtual Private Cloud (VPC)"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, vpc, network-security, segmentation]
cis_id: "3.3"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.4, cis-aws-database-3.12]
prerequisites: []
severity_boost: {}
---

# 3.3 Ensure to Create a Virtual Private Cloud (VPC) (Manual)

## Description

Setting up a Virtual Private Cloud (VPC) protects the private network that has been established from any external networks from interfering. It allows internal networks to communicate with one another with the network that has been established.

## Rationale

A VPC provides network isolation and segmentation for RDS instances, ensuring that database traffic is contained within a private network boundary.

## Impact

Builds a strong connection between internal networks, and the internet, and it secures your data from getting into the hand of an unauthorized party.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console
   - Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon VPC Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/vpc/.

3. Create a VPC
   - In the Amazon VPC console, click `Your VPCs` in the left-side menu.
   - Click on `Create VPC` to begin creating a new VPC.
   - Provide a name and the desired IPv4 CIDR block for your VPC.
   - Configure additional settings, such as IPv6 CIDR block, tenancy, and DNS resolution.
   - Click `Create` to create the VPC.

4. Create Subnets
   - In the Amazon VPC console, click `Subnets` in the left-side menu.
   - Click on `Create subnet` to create a subnet within the VPC.
   - Select the VPC you created in the previous step.
   - Provide a name, choose an availability zone, and specify the IPv4 CIDR block for the subnet.
   - Configure additional settings, such as IPv6 CIDR block and availability zone.
   - Click `Create` to create the subnet.

5. Configure Route Tables
   - In the Amazon VPC console, click on `Route Tables` in the left-side menu.
   - Click on `Create route table` to create a new route table.
   - Provide a name for the route table and select the VPC you created earlier.
   - Click `Create` to create the route table.
   - Associate the route table with the desired subnets by selecting the route table and clicking on the `Subnet associations` tab.
   - Click `Edit subnet associations` and select the desired subnets to associate them with the route table.

6. Configure Security Groups
   - In the Amazon VPC console, click `Security Groups` in the left-side menu.
   - Click on `Create security group` to create a new security group.
   - Provide a name and description for the security group.
   - Select the VPC you created earlier.
   - Configure inbound and outbound rules to control network traffic to and from your RDS instances.
   - Click `Create` to create the security group.

7. Configure Network Access Control Lists (ACLs)
   - In the Amazon VPC console, click on `Network ACLs` in the left-side menu.
   - Click on `Create network ACL` to create a new network ACL.
   - Provide a name for the network ACL and select the VPC you created earlier.
   - Configure inbound and outbound rules to allow or deny specific types of traffic.
   - Associate the network ACL with the desired subnets by selecting the network ACL and clicking on the `Subnet associations` tab.
   - Click `Edit subnet associations` and select the desired subnets to associate them with the network ACL.

8. Use the VPC with Amazon RDS
   - Select the appropriate VPC, subnets, and security groups when creating an RDS instance.
   - Configure the database instance with the desired network and security settings within the chosen VPC.

## Expected Result

All RDS instances should be deployed within a properly configured VPC with appropriate subnets, route tables, security groups, and network ACLs.

## Remediation

### Using AWS Console

Follow the audit steps above to create and configure a VPC. For existing RDS instances not in a VPC, create a snapshot, then restore it into the desired VPC.

## Default Value

AWS creates a default VPC in each region, but custom VPCs should be created for production RDS deployments.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture      |      | x    | x    |
| v7               | 11.7 Manage Network Infrastructure Through a Dedicated Network |      | x    | x    |

## Profile

Level 1 | Manual
