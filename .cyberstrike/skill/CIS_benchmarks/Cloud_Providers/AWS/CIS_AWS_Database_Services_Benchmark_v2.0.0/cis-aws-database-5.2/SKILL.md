---
name: cis-aws-database-5.2
description: "Ensure Network Security is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, vpc, security-groups, network-security]
cis_id: "5.2"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.1, cis-aws-database-5.5]
prerequisites: []
severity_boost: {}
---

# 5.2 Ensure Network Security is Enabled

## Description

Implementing network security for Amazon ElastiCache involves configuring your Virtual Private Cloud (VPC), security groups, and network access controls to control access to your ElastiCache clusters.

## Rationale

This helps ensure that the data is safe and protected from any threats and or misconfigurations within the network. This helps to keep a potential hacker getting into the system and compromising the data.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Create or Select a VPC
   - Sign in to the AWS Management Console and open the Amazon VPC console at https://console.aws.amazon.com/vpc/.
   - Create a new VPC or select an existing VPC where you want to deploy your ElastiCache cluster.

2. Create Subnets
   - In the VPC console, navigate to `Subnets` in the left-side menu.
   - Create or select the desired subnets within your VPC where you want to deploy your ElastiCache cluster.

3. Configure Security Groups
   - In the VPC console, navigate to `Security Groups` in the left-side menu.
   - Create a new security group or select an existing one to configure the security settings for your ElastiCache cluster.
   - Define inbound and outbound rules to control the traffic flow to and from your ElastiCache cluster.
     - Allow inbound traffic from trusted sources (e.g., specific IP ranges or security groups) on the necessary ports used by your ElastiCache cluster.
     - Define outbound rules based on your requirements, such as allowing outbound traffic to specific destinations or ports.
   - Associate the security group with the ElastiCache cluster when creating or modifying it.

4. Set up Network Access Control Lists (ACLs)
   - In the VPC console, navigate to `Network ACLs` in the left-side menu.
   - Create or select the appropriate network ACL associated with the subnets used by your ElastiCache cluster.
   - Configure inbound and outbound rules in the network ACL to allow or deny traffic to and from your ElastiCache cluster.
     - Define rules based on your security requirements, allowing only necessary protocols, ports, and IP ranges.
   - Associate the network ACL with the subnets used by your ElastiCache cluster.

5. Configure Route Tables
   - In the VPC console, navigate to `Route Tables` in the left-side menu.
   - Create or select the route table associated with the subnets used by your ElastiCache cluster.
   - Add or modify routes to ensure traffic to and from your ElastiCache cluster flows correctly.
     - Ensure that the route table has an appropriate route to the internet gateway or virtual private gateway if external connectivity is required.
   - Associate the route table with the subnets used by your ElastiCache cluster.

6. Verify Connectivity and Test
   - Launch an Amazon EC2 instance within the same VPC and subnet as your ElastiCache cluster or use an existing one.
   - Connect to the EC2 instance using SSH or other remote access methods.
   - Test the connectivity to your ElastiCache cluster by trying to connect to it using the appropriate client or utility.
   - Verify that the network security settings allow the necessary traffic and deny unauthorized access.

## Expected Result

ElastiCache clusters are deployed within a VPC with properly configured security groups, network ACLs, and route tables that restrict access to trusted sources only.

## Remediation

### Using AWS Console

Follow the same steps as the audit procedure to configure network security for ElastiCache clusters.

## Default Value

By default, ElastiCache clusters are created within a VPC but security groups, network ACLs, and route tables may need manual configuration for proper security.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture      |      | x    | x    |
| v7               | 11.7 Manage Network Infrastructure Through a Dedicated Network |      | x    | x    |

## Profile

Level 1 | Manual
