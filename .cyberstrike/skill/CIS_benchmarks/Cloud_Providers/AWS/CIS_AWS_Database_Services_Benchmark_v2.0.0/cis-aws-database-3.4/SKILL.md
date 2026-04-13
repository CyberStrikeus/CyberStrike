---
name: cis-aws-database-3.4
description: "Ensure to Configure Security Groups"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, security-groups, network-security, firewall]
cis_id: "3.4"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.3, cis-aws-database-3.12]
prerequisites: []
severity_boost: {}
---

# 3.4 Ensure to Configure Security Groups (Manual)

## Description

Configuring security groups benefits the user because it helps manage networks within the database and gives only certain permission for traffic that leaves and enters the database.

## Rationale

Security groups act as virtual firewalls that control inbound and outbound traffic to RDS instances. Proper configuration ensures only authorized access.

## Impact

Allows certain users to access the instance and it only allows them to work within that network.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon RDS Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/rds/.

3. Select the RDS Instance
   - Choose the Amazon RDS instance for which you want to configure security groups. Click on the instance name to access its details page.

4. Navigate to the `Connectivity & Security` Section
   - In the instance details page, navigate to the `Connectivity & Security` or "Security" section.

5. View and Modify Existing Security Groups
   - Under the `Security` section, you will see the existing security groups associated with the RDS instance.
   - Take note of the existing security groups and their inbound and outbound rules.

6. Create a New Security Group
   - If you need to create a new security group for the RDS instance
   - Click the `Create New Security Group` button.
   - Provide a name and description for the new security group.
   - Configure the inbound and outbound rules to control network traffic to and from the RDS instance.
   - Click "Create" to create the new security group.

7. Modify Security Group Rules
   - To modify the rules of an existing security group, click on the security group name or the `Modify` button next to it.
   - You can add, edit, or delete inbound and outbound rules on the security group details page.
   - Specify each rule's source IP addresses, port ranges, and protocols.
   - Click `Save` or `Apply Changes` to update the security group rules.

8. Associate Security Groups
   - To associate a security group with the RDS instance, navigate to the `Connectivity & Security` or `Security` section of the instance details page.
   - Click `Modify` next to the `VPC security groups` option.
   - Select the desired security groups from the list.
   - Click `Save` or `Apply Changes` to associate them with the RDS instance.

9. Verify and Test Security Group Configuration
   - Review the security group settings to match your network access requirements.
   - Test the connectivity to the RDS instance by attempting to access it from authorized IP addresses or applications.

10. Monitor and Update Security Groups
    - Regularly monitor the network traffic and access patterns to your RDS instance.
    - Update the security group rules as needed to reflect changes in your network access requirements.

## Expected Result

Security groups should be configured with the principle of least privilege, allowing only necessary inbound traffic from trusted sources on required ports.

## Remediation

### Using AWS Console

Follow the audit steps above to review and configure security groups. Remove overly permissive rules (e.g., 0.0.0.0/0) and restrict access to specific IP ranges and ports.

## Default Value

The default security group allows all outbound traffic and restricts inbound traffic to the same security group.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Manual
