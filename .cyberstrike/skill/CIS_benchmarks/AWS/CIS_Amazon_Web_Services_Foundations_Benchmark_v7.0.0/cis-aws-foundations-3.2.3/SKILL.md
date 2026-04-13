---
name: cis-aws-foundations-3.2.3
description: "Ensure that RDS instances are not publicly accessible"
category: cis-storage
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, rds, public-access, network-security, vpc]
cis_id: "3.2.3"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-3.2.1, cis-aws-foundations-3.2.2, cis-aws-foundations-3.2.4]
prerequisites: []
severity_boost: {}
---

# Ensure that RDS instances are not publicly accessible

## Description
Ensure and verify that the RDS database instances provisioned in your AWS account restrict unauthorized access in order to minimize security risks. To restrict access to any RDS database instance, you must disable the Publicly Accessible flag for the database and update the VPC security group associated with the instance.

## Rationale
Ensure that no public-facing RDS database instances are provisioned in your AWS account, and restrict unauthorized access in order to minimize security risks. When the RDS instance allows unrestricted access (0.0.0.0/0), anyone and anything on the Internet can establish a connection to your database, which can increase the opportunity for malicious activities such as brute force attacks, PostgreSQL injections, or DoS/DDoS attacks.

## Impact
Disabling public accessibility may require application reconfiguration to use private endpoints or VPN connections. Ensure all applications connecting to the RDS instance can reach it through private networking before making changes.

## Audit Procedure

### Using AWS Console
1. Log in to the AWS management console and navigate to the RDS dashboard at https://console.aws.amazon.com/rds/.
2. Under the navigation panel, on the RDS dashboard, click `Databases`.
3. Select the RDS instance that you want to examine.
4. Click `Instance Name` from the dashboard, under `Connectivity and Security`.
5. In the `Security` section, check if the Publicly Accessible flag status is set to `No`.
6. Follow the steps below to check database subnet access:
   - In the `networking` section, click the subnet link under `Subnets`.
   - The link will redirect you to the VPC Subnets page.
   - Select the subnet listed on the page and click the `Route Table` tab from the dashboard bottom panel.
   - If the route table contains any entries with the destination CIDR block set to `0.0.0.0/0` and an `Internet Gateway` attached, the selected RDS database instance was provisioned inside a public subnet; therefore, it is not running within a logically isolated environment and can be accessed from the Internet.
7. Repeat steps 3-6 to determine the configuration of other RDS database instances provisioned in the current region.
8. Change the AWS region from the navigation bar and repeat the audit process for other regions.

### Using AWS CLI
1. Run the `describe-db-instances` command to list all available RDS database names in the selected AWS region:

```bash
aws rds describe-db-instances --region <region-name> --query 'DBInstances[*].DBInstanceIdentifier'
```

2. The command output should return each database instance `identifier`.

3. Run the `describe-db-instances` command again, using the `PubliclyAccessible` parameter as a query filter to reveal the status of the database instance's Publicly Accessible flag:

```bash
aws rds describe-db-instances --region us-east-1 --query 'DBInstances[*].[DBInstanceIdentifier,PubliclyAccessible]' --output table
```

4. Check the Publicly Accessible parameter status. If the Publicly Accessible flag is set to `Yes`, then the selected RDS database instance is publicly accessible and insecure. Follow the steps mentioned below to check database subnet access.

5. Run the `describe-db-instances` command again using the RDS database instance identifier that you want to check, along with the appropriate filtering to describe the VPC subnet(s) associated with the selected instance:

```bash
aws ec2 describe-route-tables --filters "Name=association.subnet-id,Values=" --query "RouteTables[].Routes[?GatewayId!='null']"
```

   - If the command returns the route table associated with the database instance subnet ID, check the values of the `GatewayId` and `DestinationCidrBlock` attributes returned in the output. If the route table contains any entries with the `GatewayId` value set to `igw-xxxxxxxx` and the `DestinationCidrBlock` value set to `0.0.0.0/0`, the selected RDS database instance was provisioned within a public subnet.
   - Or, if the command returns empty results, the route table is implicitly associated with the subnet; therefore, the audit process continues with the next step.

6. Run the `describe-route-tables` command using the ID of the subnet returned in the previous step to describe the routes of the VPC route table associated with the selected subnet:

```bash
aws ec2 describe-route-tables --region <region-name> --filters "Name=association.subnet-id,Values=<subnet-id>" --query 'RouteTables[*].Routes[]'
```

7. Run the `describe-db-instances` command again using the RDS database instance identifier that you want to check, along with the appropriate filtering to describe the VPC ID associated with the selected instance:

```bash
aws rds describe-db-instances --region <region-name> --db-instance-identifier <db-instance-name> --query 'DBInstances[*].DBSubnetGroup.VpcId'
```

8. Now run the `describe-route-tables` command using the ID of the VPC returned in the previous step to describe the routes of the VPC's main route table that is implicitly associated with the selected subnet:

```bash
aws ec2 describe-route-tables --region <region-name> --filters "Name=vpc-id,Values=<vpc-id>" "Name=association.main,Values=true" --query 'RouteTables[*].Routes[]'
```

   - The command output returns the VPC main route table implicitly associated with the database instance subnet ID. Check the values of the `GatewayId` and `DestinationCidrBlock` attributes returned in the output. If the route table contains any entries with the `GatewayId` value set to `igw-xxxxxxxx` and the `DestinationCidrBlock` value set to `0.0.0.0/0`, the selected RDS database instance was provisioned inside a public subnet; therefore, it is not running within a logically isolated environment and does not adhere to AWS security best practices.

## Expected Result
The `PubliclyAccessible` flag should be set to `No` (or `False`) for all RDS instances. Additionally, the RDS instances should be deployed in private subnets without routes to Internet Gateways.

## Remediation

### Using AWS Console
1. Log in to the AWS management console and navigate to the RDS dashboard at https://console.aws.amazon.com/rds/.
2. Under the navigation panel, on the RDS dashboard, click `Databases`.
3. Select the RDS instance that you want to update.
4. Click `Modify` from the dashboard top menu.
5. On the Modify DB Instance panel, under the `Connectivity` section, click on `Additional connectivity configuration` and update the value for `Publicly Accessible` to `Not publicly accessible` to restrict public access.
6. Follow the below steps to update subnet configurations:
   - Select the `Connectivity and security` tab, and click the VPC attribute value inside the `Networking` section.
   - Select the `Details` tab from the VPC dashboard's bottom panel and click the Route table configuration attribute value.
   - On the Route table details page, select the Routes tab from the dashboard's bottom panel and click `Edit routes`.
   - On the Edit routes page, update the Destination of Target which is set to `igw-xxxxx` and click `Save` routes.
7. On the Modify DB Instance panel, click `Continue`, and in the Scheduling of modifications section, perform one of the following actions based on your requirements:
   - Select `Apply during the next scheduled maintenance window` to apply the changes automatically during the next scheduled maintenance window.
   - Select `Apply immediately` to apply the changes right away. With this option, any pending modifications will be asynchronously applied as soon as possible, regardless of the maintenance window setting for this RDS database instance.
8. Repeat steps 3-7 for each RDS instance in the current region.
9. Change the AWS region from the navigation bar to repeat the process for other regions.

### Using AWS CLI
1. Run the `describe-db-instances` command to list all available RDS database identifiers in the selected AWS region:

```bash
aws rds describe-db-instances --region <region-name> --query 'DBInstances[*].DBInstanceIdentifier'
```

2. The command output should return each database instance identifier.

3. Run the `modify-db-instance` command to modify the configuration of a selected RDS instance, disabling the `Publicly Accessible` flag for that instance. This command uses the `apply-immediately` flag. If you want to avoid any downtime, the `--no-apply-immediately` flag can be used:

```bash
aws rds modify-db-instance --region <region-name> --db-instance-identifier <db-instance-identifier> --no-publicly-accessible --apply-immediately
```

4. The command output should reveal the `PubliclyAccessible` configuration under pending values, to be applied at the specified time.

5. Updating the Internet Gateway destination via the AWS CLI is not currently supported. To update information about the Internet Gateway, please use the AWS Console procedure.

6. Repeat steps 1-5 for each RDS instance provisioned in the current region.

7. Change the AWS region by using the --region filter to repeat the process for other regions.

## Default Value
By default, new Amazon RDS instances are created with the Publicly Accessible setting disabled. However, this option can be explicitly enabled during instance creation or modification.

## References
1. https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.html
2. https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Scenario2.html
3. https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
4. https://aws.amazon.com/rds/faqs/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1530 | TA0010 | M1037, M1054 |

## Profile
Level 1 | Automated
