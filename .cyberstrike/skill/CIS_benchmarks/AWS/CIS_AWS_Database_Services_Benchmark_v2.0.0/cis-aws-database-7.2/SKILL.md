---
name: cis-aws-database-7.2
description: "Ensure VPC Security is Configured"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, documentdb, vpc, security-groups, subnets]
cis_id: "7.2"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-7.1, cis-aws-database-7.3, cis-aws-database-7.5]
prerequisites: []
severity_boost: {}
---

# 7.2 Ensure VPC Security is Configured (Manual)

## Description

Creating a VPC, configuring subnets, and creating security groups help isolate your DocumentDB instances within your virtual network and control inbound and outbound traffic.

## Rationale

Setting up a Virtual Private Cloud (VPC) protects the private network that has been established from any external networks from interfering. It allows internal networks to communicate with one another with the network that has been established.

## Impact

Builds a strong connection between internal networks, has a strong connection with the internet, and it secures your data from getting into the hands of an unauthorized party.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon VPC Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/vpc/.

3. Create a VPC (Virtual Private Cloud)
   - Click on the `Create VPC` button to create a new VPC.
   - Provide the necessary details, such as VPC name, CIDR block, and additional configuration options.
   - Click on `Create` to create the VPC.

4. Configure VPC Subnets
   - Once the VPC is created, navigate to the `Subnets` section in the VPC console.
   - Click on the `Create subnet` button to create a new subnet.
   - Provide the necessary details, such as subnet name, VPC selection, and subnet CIDR block.
   - Repeat this step to create multiple subnets within your VPC, if required.

5. Create Security Groups
   - Navigate to the `Security Groups` section in the VPC console.
   - Click the `Create security group` button to create a new security group.
   - Provide a name and description for the security group.
   - Configure inbound and outbound rules to allow the necessary traffic to and from the DocumentDB instances.
   - Repeat this step to create additional security groups if needed.

6. Launch Amazon DocumentDB Cluster in VPC
   - Navigate to the service using the "Find Services" search bar or by directly accessing the console at https://console.aws.amazon.com/docdb/.
   - Click on `Create database` to create a new DocumentDB cluster.
   - Configure the necessary parameters, such as cluster name, instance specifications, and storage options.
   - In the `Network & Security` section, select the VPC and subnets you created earlier.
   - Choose the appropriate security group(s) to apply to the DocumentDB cluster.
   - Click `Create` to launch the DocumentDB cluster in the configured VPC.

7. Test Connectivity
   - Once the DocumentDB cluster is launched, validate that you can connect to it from authorized sources.
   - Use the appropriate database client or tools to establish a connection and verify connectivity.

8. Monitor and Update Security Groups
   - Regularly monitor and update the security groups associated with the DocumentDB cluster.
   - Modify the inbound and outbound rules to ensure appropriate access control and security.

## Expected Result

DocumentDB clusters are deployed within a VPC with properly configured subnets and security groups that restrict access to authorized sources only.

## Remediation

### Using AWS Console

The individual is required to create a subnet and configure their inbound and outbound access. Individuals are supposed to configure and route, ensuring the traffic is flowing smoothly without any interference. This control is important because it only allows authorized users to access their resources as they prefer.

## Default Value

Amazon DocumentDB must be deployed within a VPC. Default security groups may allow broader access than necessary.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | X | X |
| v7 | 11.7 Manage Network Infrastructure Through a Dedicated Network | | X | X |

## Profile

Level 1 | Manual
