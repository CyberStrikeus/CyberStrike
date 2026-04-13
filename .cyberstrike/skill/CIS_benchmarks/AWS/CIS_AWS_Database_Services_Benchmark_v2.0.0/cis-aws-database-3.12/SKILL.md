---
name: cis-aws-database-3.12
description: "Ensure Database is not Publicly accessible"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, public-access, network-security, exposure]
cis_id: "3.12"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.3, cis-aws-database-3.4]
prerequisites: []
severity_boost: {}
---

# 3.12 Ensure Database is not Publicly accessible (Manual)

## Description

RDS databases must not be publicly accessible. This means the database's network configuration should prevent assignment of public IP addresses or exposure to the public internet, ensuring that connections are only permitted from trusted internal networks.

## Rationale

Restricting public access to databases greatly reduces the attack surface for malicious actors. Publicly accessible databases are highly vulnerable to unauthorized login attempts, exploitation of software vulnerabilities and data breaches. Enforcing private access restricts connectivity and enforces the principle of least privilege and network segmentation.

## Impact

If public access is not properly restricted on databases, data stored in the database is at risk of exposure to the internet, increasing the likelihood of data loss and service disruption.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console where the RDS database cluster you are auditing resides.

2. Navigate to the Amazon Aurora and RDS Dashboard.
   - You can find this under the Database category.

3. Select the DB instance name you wish to audit.
   - This opens the details page for your specific RDS DB instance.

4. Under the Connectivity & security tab, check the value of Publicly accessible:
   - If Set to No, the instance is not publicly accessible; no further network verification is needed.
   - If Set to Yes, continue with additional steps to fully assess exposure.

5. In the Networking section under Connectivity & security, locate the Subnets for the database:
   - Right-click on the subnet link and open it in a new tab for further inspection.

6. With the subnet selected, review the attached Route Table:
   - Check for routes with Destination: 0.0.0.0/0 and Target: an Internet Gateway (ID starts with igw-).
   - If such a route exists, it enables access to the database from the public internet.

If the database is marked as "Publicly accessible: Yes" and the subnets contain a route to 0.0.0.0/0 via an Internet Gateway, the instance is exposed to the public internet.

### Using AWS CLI

List your RDS cluster's DB instances with:

```bash
aws rds describe-db-instances --query "DBInstances[?DBClusterIdentifier=='<your-cluster-identifier>'].DBInstanceIdentifier"
```

For each DB instance, verify the PubliclyAccessible setting:

```bash
aws rds describe-db-instances --db-instance-identifier <db-instance-identifier> --query "DBInstances[0].PubliclyAccessible"
```

## Expected Result

All RDS instances should have `PubliclyAccessible` set to `No` (false). Subnets associated with RDS instances should not have routes to the internet via an Internet Gateway.

## Remediation

### Using AWS CLI

1. List your RDS cluster's DB instances with:

```bash
aws rds describe-db-instances --query "DBInstances[?DBClusterIdentifier=='<your-cluster-identifier>'].DBInstanceIdentifier"
```

- Replace with your actual RDS cluster identifier.

2. For each DB instance, run the following command:

```bash
aws rds modify-db-instance --db-instance-identifier <db-instance-identifier> --no-publicly-accessible --apply-immediately
```

- Replace with the name of your DB instance. The --apply-immediately flag ensures the change is applied right away.

3. Verify changes - confirm that "Publicly Accessible" is now set to "No" for each DB instance:

```bash
aws rds describe-db-instances --db-instance-identifier <db-instance-identifier> --query "DBInstances[0].PubliclyAccessible"
```

### Using AWS Console

Navigate to the RDS instance, click Modify, set "Publicly accessible" to "No", and apply the change immediately.

## Default Value

When creating an RDS instance, the default value for "Publicly accessible" depends on the subnet group configuration.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.12 Segment Data Processing and Storage Based on Sensitivity | | x | x |
| v8 | 4 Secure Configuration of Enterprise Assets and Software | | | |
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | x | x |

## Profile

Level 1 | Manual
