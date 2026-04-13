---
name: cis-aws-database-9.1
description: "Ensure Network Security is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, neptune, graph-database, network-security, vpc]
cis_id: "9.1"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-9.2, cis-aws-database-9.3, cis-aws-database-9.4, cis-aws-database-9.5]
prerequisites: []
severity_boost: {}
---

# 9.1 Ensure Network Security is Enabled (Manual)

## Description
This helps ensure that all the necessary security measurements are taken to prevent a cyber-attack. Such as utilizing VPC, creating certain inbound and outbound rules, and ACLs.

## Rationale
Network security is fundamental to protecting Neptune database clusters from unauthorized access and network-based attacks.

## Impact
Provides privacy and lets the user customize their security preferences. Prevents private network from interfering with public networks.

## Audit Procedure

### Using AWS Console
1. Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.
2. Open the Amazon Neptune Console - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/neptune/.
3. Select the Neptune Cluster:
   - Choose the Amazon Neptune cluster for which you want to configure network security.
   - Click on the cluster name to access its details page.
4. Configure Security Groups:
   - In the cluster details page, navigate to the `Connectivity & Security` or `Network & Security` section.
   - Under `Security Groups`, click on `Manage security groups`.
   - Click on `Create new security group` or select an existing security group associated with your Neptune cluster.
   - Configure inbound and outbound rules within the security group to control network traffic.
     - For inbound rules, specify the allowed source IP addresses or security groups and the necessary ports for accessing the Neptune cluster.
     - For outbound rules, define the allowed destination IP addresses or security groups and the required ports for outbound connections from the Neptune cluster.
   - Save the security group settings.
5. Configure Network Access Control Lists (ACLs):
   - In the cluster details page, navigate to the `Connectivity & Security` or `Network & Security` section.
   - Under `Network Access Control Lists (ACLs)`, click on `Manage network ACLs`.
   - Create a new network ACL or select an existing one associated with your Amazon Neptune cluster.
   - Configure inbound and outbound rules within the network ACL to control network traffic at the subnet level.
   - Define rules based on IP address ranges, protocols, and ports to allow or deny specific traffic.
   - Consider security best practices and compliance requirements when configuring the network ACL rules.
   - Save the network ACL settings.
6. Verify Network Security Configuration:
   - Review the security group and network ACL settings to ensure they align with your security requirements.
   - Confirm that the inbound and outbound rules only allow necessary traffic and deny unauthorized access.
   - Verify that your Neptune cluster's security groups and network ACLs are correctly configured.
7. Test Network Connectivity:
   - Launch an Amazon EC2 instance within the same VPC and subnet as your Neptune cluster, or use an existing one.
   - Connect to the EC2 instance using SSH or other remote access methods.
   - Test the network connectivity to your Neptune cluster by attempting to connect to it using the appropriate client or utility.
   - Ensure that the network security settings allow the necessary traffic and deny unauthorized access.

## Expected Result
Security groups and network ACLs should be properly configured to allow only authorized traffic to and from the Neptune cluster.

## Remediation

### Using AWS Console
Follow the audit steps above to configure security groups and network ACLs for your Neptune cluster.

## Default Value
Neptune clusters are deployed within a VPC. Security groups and network ACLs require manual configuration.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | x | x |
| v7 | 11.7 Manage Network Infrastructure Through a Dedicated Network | | x | x |

## Profile
Level 1 | Manual
