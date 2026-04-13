---
name: cis-aws-foundations-3.2.4
description: "Ensure Multi-AZ deployments are used for enhanced availability in Amazon RDS"
category: cis-storage
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, rds, multi-az, high-availability, disaster-recovery]
cis_id: "3.2.4"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-3.2.1, cis-aws-foundations-3.2.2, cis-aws-foundations-3.2.3]
prerequisites: []
severity_boost: {}
---

# Ensure Multi-AZ deployments are used for enhanced availability in Amazon RDS

## Description
Amazon RDS offers Multi-AZ deployments that provide enhanced availability and durability for your databases, using synchronous replication to replicate data to a standby instance in a different Availability Zone (AZ). In the event of an infrastructure failure, Amazon RDS automatically fails over to the standby to minimize downtime and ensure business continuity.

## Rationale
Database availability is crucial for maintaining service uptime, particularly for applications that are critical to the business. Implementing Multi-AZ deployments with Amazon RDS ensures that your databases are protected against unplanned outages due to hardware failures, network issues, or other disruptions. This configuration enhances both the availability and durability of your database, making it a highly recommended practice for production environments.

## Impact
Multi-AZ deployments may increase costs due to the additional resources required to maintain a standby instance; however, the benefits of increased availability and reduced risk of downtime outweigh these costs for critical applications.

## Audit Procedure

### Using AWS Console
1. Login to the AWS Management Console and open the RDS dashboard at AWS RDS Console.
2. In the navigation pane, under `Databases`, select the RDS instance you want to examine.
3. Click the `Instance Name` to see details, then navigate to the `Configuration` tab.
4. Under the `Availability` section, check the `Multi-AZ` status.
   - If Multi-AZ deployment is enabled, it will display `Yes`.
   - If it is disabled, the status will display `No`.
5. Repeat steps 2-4 to verify the Multi-AZ status of other RDS instances in the same region.
6. Change the region from the top of the navigation bar and repeat the audit for other regions.

### Using AWS CLI
1. Run the following command to list all RDS instances in the selected AWS region:

```bash
aws rds describe-db-instances --region <region-name> --query 'DBInstances[*].DBInstanceIdentifier'
```

2. Run the following command using the instance identifier returned earlier to check the Multi-AZ status:

```bash
aws rds describe-db-instances --region --query 'DBInstances[*].[DBInstanceIdentifier,MultiAZ]' --output table
```

   - If the output is `True`, Multi-AZ is enabled.
   - If the output is `False`, Multi-AZ is not enabled.

3. Repeat steps 1 and 2 to audit each RDS instance, and change regions to verify in other regions.

## Expected Result
The `MultiAZ` parameter should return `True` for all production RDS database instances, indicating that Multi-AZ deployment is enabled for high availability.

## Remediation

### Using AWS Console
1. Login to the AWS Management Console and open the RDS dashboard at AWS RDS Console.
2. In the left navigation pane, click on `Databases`.
3. Select the database instance that needs Multi-AZ deployment to be enabled.
4. Click the `Modify` button at the top right.
5. Scroll down to the `Availability & Durability` section.
6. Under `Multi-AZ deployment`, select `Yes` to enable.
7. Review the changes and click `Continue`.
8. On the `Review` page, choose `Apply immediately` to make the change without waiting for the next maintenance window, or `Apply during the next scheduled maintenance window`.
9. Click `Modify DB Instance` to apply the changes.

### Using AWS CLI
1. Run the following command to modify the RDS instance and enable Multi-AZ:

```bash
aws rds modify-db-instance --region <region-name> --db-instance-identifier <db-name> --multi-az --apply-immediately
```

2. Confirm that the Multi-AZ deployment is enabled by running the following command:

```bash
aws rds describe-db-instances --region <region-name> --db-instance-identifier <db-name> --query 'DBInstances[*].MultiAZ'
```

   - The output should return `True`, indicating that Multi-AZ is enabled.

3. Repeat the procedure for other instances as necessary.

## Default Value
By default, Amazon RDS instances are created as Single-AZ deployments. Multi-AZ must be explicitly enabled during instance creation or modification.

## References
1. https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html
2. https://aws.amazon.com/rds/features/multi-az/
3. https://aws.amazon.com/rds/faqs/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | x | x |
| v7 | 2.10 Physically or Logically Segregate High Risk Applications | | | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| | | M1030 |

## Profile
Level 1 | Manual
