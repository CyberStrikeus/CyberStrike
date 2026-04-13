---
name: cis-aws-database-9.8
description: "Ensure Neptune Database is not Publicly accessible"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, neptune, graph-database, public-access, network-security]
cis_id: "9.8"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-9.1, cis-aws-database-9.9, cis-aws-database-9.10]
prerequisites: []
severity_boost: {}
---

# 9.8 Ensure Neptune Database is not Publicly accessible (Manual)

## Description

Neptune databases must not be publicly accessible. This means the database's network configuration should prevent assignment of public IP addresses or exposure to the public internet, ensuring that connections are only permitted from trusted internal networks.

## Rationale

Restricting public access to databases greatly reduces the attack surface for malicious actors. Publicly accessible databases are highly vulnerable to unauthorized login attempts, exploitation of software vulnerabilities and data breaches. Enforcing private access restricts connectivity and enforces the principle of least privilege and network segmentation.

## Impact

If public access is not properly restricted on databases, data stored in the database is at risk of exposure to the internet, increasing the likelihood of data loss and service disruption.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console where the Aurora database cluster you are auditing resides.
2. Navigate to the Neptune Dashboard. You can find this under the Database category.
3. Select the DB instance name you wish to audit. This opens the details page for your specific Neptune DB instance.
4. Under the Connectivity & Security tab, check the value of Publicly accessible:
   - If Set to No, the instance is not publicly accessible; no further network verification is needed.
   - If Set to Yes, continue with additional steps to fully assess exposure.
5. In the Networking section under Connectivity & security, locate the Subnets for the database:
   - Right-click on the subnet link and open it in a new tab for further inspection.
6. With the subnet selected, review the attached Route Table:
   - Check for routes with Destination: 0.0.0.0/0 and Target: an Internet Gateway (ID starts with igw-).
   - If such a route exists, it enables access to the database from the public internet.

If the database is marked as "Publicly accessible: Yes" and the subnets contain a route to 0.0.0.0/0 via an Internet Gateway, the instance is exposed to the public internet.

### Using AWS CLI

Verify that public accessibility has been disabled:

```bash
aws neptune describe-db-instances \
  --db-instance-identifier <instance-identifier> \
  --query "DBInstances[0].{DBInstanceIdentifier:DBInstanceIdentifier,PubliclyAccessible:PubliclyAccessible}"
```

- Confirm PubliclyAccessible is now false.

## Expected Result

The `PubliclyAccessible` value should be `false` for all Neptune DB instances.

## Remediation

### Using AWS CLI

1. Disable public accessibility on a specific Neptune instance:

```bash
aws neptune modify-db-instance \
  --db-instance-identifier <instance-identifier> \
  --no-publicly-accessible \
  --apply-immediately
```

- `--no-publicly-accessible` disables public accessibility for the instance.
- `--apply-immediately` applies the change without waiting for the next maintenance window.

2. Verify that public accessibility has been disabled:

```bash
aws neptune describe-db-instances \
  --db-instance-identifier <instance-identifier> \
  --query "DBInstances[0].{DBInstanceIdentifier:DBInstanceIdentifier,PubliclyAccessible:PubliclyAccessible}"
```

- Confirm PubliclyAccessible is now false.

## Default Value

Neptune DB instances should not be publicly accessible by default when deployed within a VPC.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.12 Segment Data Processing and Storage Based on Sensitivity |      | x    | x    |
| v8               | 4 Secure Configuration of Enterprise Assets and Software      |      |      |      |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture     |      | x    | x    |

## Profile

Level 1 | Manual
