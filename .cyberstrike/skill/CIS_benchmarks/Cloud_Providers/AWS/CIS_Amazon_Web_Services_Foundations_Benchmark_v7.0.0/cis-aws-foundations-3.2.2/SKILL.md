---
name: cis-aws-foundations-3.2.2
description: "Ensure the Auto Minor Version Upgrade feature is enabled for RDS instances"
category: cis-storage
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, rds, patching, auto-upgrade, version-management]
cis_id: "3.2.2"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-3.2.1, cis-aws-foundations-3.2.3, cis-aws-foundations-3.2.4]
prerequisites: []
severity_boost: {}
---

# Ensure the Auto Minor Version Upgrade feature is enabled for RDS instances

## Description

Ensure that RDS database instances have the Auto Minor Version Upgrade flag enabled to automatically receive minor engine upgrades during the specified maintenance window. This way, RDS instances can obtain new features, bug fixes, and security patches for their database engines.

## Rationale

AWS RDS will occasionally deprecate minor engine versions and provide new ones for upgrades. When the last version number within a release is replaced, the changed version is considered minor. With the Auto Minor Version Upgrade feature enabled, version upgrades will occur automatically during the specified maintenance window, allowing your RDS instances to receive new features, bug fixes, and security patches for their database engines.

## Impact

Automatic minor version upgrades may introduce changes during maintenance windows. For critical production databases, consider testing upgrades in a staging environment first.

## Audit Procedure

### Using AWS Console

1. Log in to the AWS management console and navigate to the RDS dashboard at https://console.aws.amazon.com/rds/.
2. In the left navigation panel, click `Databases`.
3. Select the RDS instance that you want to examine.
4. Click on the `Maintenance and backups` panel.
5. Under the `Maintenance` section, search for the Auto Minor Version Upgrade status.
   - If the current status is `Disabled`, it means that the feature is not enabled, and the minor engine upgrades released will not be applied to the selected RDS instance.

### Using AWS CLI

1. Run the `describe-db-instances` command to list all RDS database names available in the selected AWS region:

```bash
aws rds describe-db-instances --region --query 'DBInstances[*].[DBInstanceIdentifier,AutoMinorVersionUpgrade]' --output table
```

2. The command output should return each database instance identifier.

3. Run the `describe-db-instances` command again using a RDS instance identifier returned earlier to determine the Auto Minor Version Upgrade status for the selected instance:

```bash
aws rds describe-db-instances --region <region-name> --db-instance-identifier <db-instance-identifier> --query 'DBInstances[*].AutoMinorVersionUpgrade'
```

4. The command output should return the current status of the feature. If the current status is set to `true`, the feature is enabled and the minor engine upgrades will be applied to the selected RDS instance.

## Expected Result

The `AutoMinorVersionUpgrade` parameter should return `true` for all RDS database instances.

## Remediation

### Using AWS Console

1. Log in to the AWS management console and navigate to the RDS dashboard at https://console.aws.amazon.com/rds/.
2. In the left navigation panel, click `Databases`.
3. Select the RDS instance that you want to update.
4. Click on the `Modify` button located at the top right side.
5. On the `Modify DB Instance: <instance identifier>` page, In the `Maintenance` section, select `Auto minor version upgrade` and click the `Yes` radio button.
6. At the bottom of the page, click `Continue`, and check `Apply Immediately` to apply the changes immediately, or select `Apply during the next scheduled maintenance window` to avoid any downtime.
7. Review the changes and click `Modify DB Instance`. The instance status should change from available to modifying and back to available. Once the feature is enabled, the `Auto Minor Version Upgrade` status should change to `Yes`.

### Using AWS CLI

1. Run the `describe-db-instances` command to list all RDS database instance names available in the selected AWS region:

```bash
aws rds describe-db-instances --region <region-name> --query 'DBInstances[*].DBInstanceIdentifier'
```

2. The command output should return each database instance identifier.

3. Run the `modify-db-instance` command to modify the configuration of a selected RDS instance. This command will apply the changes immediately. Remove `--apply-immediately` to apply changes during the next scheduled maintenance window and avoid any downtime:

```bash
aws rds modify-db-instance --region <region-name> --db-instance-identifier <db-instance-identifier> --auto-minor-version-upgrade --apply-immediately
```

4. The command output should reveal the new configuration metadata for the RDS instance, including the `AutoMinorVersionUpgrade` parameter value.

5. Run the `describe-db-instances` command to check if the Auto Minor Version Upgrade feature has been successfully enabled:

```bash
aws rds describe-db-instances --region <region-name> --db-instance-identifier <db-instance-identifier> --query 'DBInstances[*].AutoMinorVersionUpgrade'
```

6. The command output should return the feature's current status set to `true`, indicating that the feature is `enabled`, and that the minor engine upgrades will be applied to the selected RDS instance.

## Default Value

By default, new Amazon RDS instances have the Auto Minor Version Upgrade option enabled, unless explicitly disabled at creation or modification.

## References

1. https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_RDS_Managing.html
2. https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Upgrading.html
3. https://aws.amazon.com/rds/faqs/

## CIS Controls

| Controls Version | Control                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------- | ---- | ---- | ---- |
| v8               | 7.4 Perform Automated Application Patch Management   | x    | x    | x    |
| v7               | 3.5 Deploy Automated Software Patch Management Tools | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
|                             |         | M1051       |

## Profile

Level 1 | Automated
