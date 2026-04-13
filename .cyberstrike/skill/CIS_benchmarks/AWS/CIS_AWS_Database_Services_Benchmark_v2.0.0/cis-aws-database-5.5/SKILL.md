---
name: cis-aws-database-5.5
description: "Ensure Virtual Private Cloud (VPC) is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, vpc, network-security, subnets]
cis_id: "5.5"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.2]
prerequisites: []
severity_boost: {}
---

# 5.5 Ensure Virtual Private Cloud (VPC) is Enabled

## Description
Implementing VPC security best practices for Amazon ElastiCache involves configuring your Virtual Private Cloud (VPC) and associated resources to enhance the security of your ElastiCache clusters.

## Rationale
This ensures that only authorized users can access their platforms and prevents any mistakes that can lead to a data breach due to the level of security.

## Impact
N/A

## Audit Procedure

### Using AWS Console
1. Create or Select a VPC
   - Sign in to the AWS Management Console and open the Amazon VPC console at https://console.aws.amazon.com/vpc/.
   - Create a new VPC or select an existing VPC to host your ElastiCache clusters.

2. Configure Subnets
   - In the VPC console, navigate to `Subnets` in the left-side menu.
   - Create or select the subnets within your VPC where you want to deploy your ElastiCache clusters.
   - Ensure you have private subnets for your ElastiCache clusters to avoid exposing them to the public internet.

3. Define Security Groups
   - In the VPC console, navigate to `Security Groups` in the left-side menu.
   - Create a new security group or select an existing one for your ElastiCache clusters.
   - Configure inbound and outbound rules in the security group to control traffic access.
     - Allow inbound access only from trusted sources or specific IP ranges required for your applications.
     - Restrict outbound access to necessary destinations and protocols.
   - Associate the security group with your ElastiCache clusters.

4. Configure Network Access Control Lists (ACLs)
   - In the VPC console, navigate to `Network ACLs` in the left-side menu.
   - Create or select the network ACLs associated with the subnets used by your ElastiCache clusters.
   - Configure inbound and outbound rules in the network ACLs to control traffic access.
     - Define rules based on your security requirements, allowing only necessary protocols, ports, and IP ranges.
     - Deny unnecessary or unwanted traffic.
   - Associate the network ACLs with the subnets used by your ElastiCache clusters.

5. Configure Routing
   - In the VPC console, navigate to `Route Tables` in the left-side menu.
   - Create or select the route table associated with the subnets used by your ElastiCache clusters.
   - Add or modify routes to ensure traffic flows correctly to and from your ElastiCache clusters.
   - Ensure that the route table has appropriate routes to the internet gateway or virtual private gateway if external connectivity is required.
   - Associate the route table with the subnets used by your ElastiCache clusters.

6. Review and Update Network Security Settings
   - Regularly review and update your VPC security configurations, including security groups, network ACLs, and routing, to align with your security requirements.
   - Remove any unnecessary or excessive permissions from security groups and tighten inbound and outbound access as needed.
   - Stay informed about AWS security best practices and recommendations to enhance your network security.

## Expected Result
ElastiCache clusters are deployed in a VPC with private subnets, properly configured security groups, network ACLs, and route tables.

## Remediation
The individual is required to create a subnet and configure their inbound and outbound access. Individuals are supposed to configure their ACL and routing ensuring the traffic is flowing smoothly without any interference. This control is important because it only allows authorized user to access their resources as they prefer.

### Using AWS Console
Follow the same steps as the audit procedure to configure VPC security for ElastiCache clusters.

## Default Value
By default, ElastiCache clusters are created within a VPC, but proper subnet, security group, and ACL configuration requires manual setup.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | x | x |
| v7 | 11.7 Manage Network Infrastructure Through a Dedicated Network | | x | x |

## Profile
Level 1 | Manual
