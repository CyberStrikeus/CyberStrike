---
name: cis-aws-foundations-6.7
description: "Ensure that the EC2 Metadata Service only allows IMDSv2"
category: cis-networking
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, networking, ec2, imdsv2, metadata, ssrf]
cis_id: "6.7"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-6.1.1, cis-aws-foundations-6.1.2]
prerequisites: []
severity_boost: {}
---

# Ensure that the EC2 Metadata Service only allows IMDSv2

## Description
When enabling the Metadata Service on AWS EC2 instances, users have the option of using either Instance Metadata Service Version 1 (IMDSv1; a request/response method) or Instance Metadata Service Version 2 (IMDSv2; a session-oriented method).

## Rationale
Instance metadata is data about your instance that you can use to configure or manage the running instance. Instance metadata is divided into categories, such as host name, events, and security groups.

When enabling the Metadata Service on AWS EC2 instances, users have the option of using either Instance Metadata Service Version 1 (IMDSv1; a request/response method) or Instance Metadata Service Version 2 (IMDSv2; a session-oriented method). With IMDSv2, every request is now protected by session authentication. A session begins and ends a series of requests that software running on an EC2 instance uses to access the locally stored EC2 instance metadata and credentials.

Allowing Version 1 of the service may open EC2 instances to Server-Side Request Forgery (SSRF) attacks, so Amazon recommends utilizing Version 2 for better instance security.

## Impact
None specified.

## Audit Procedure

### Using AWS Console
1. Sign in to the AWS Management Console and navigate to the EC2 dashboard at https://console.aws.amazon.com/ec2/.
2. In the left navigation panel, under the `Instances` section, choose `Instances`.
3. Select the EC2 instance that you want to examine.
4. Check the `IMDSv2` status, and ensure that it is set to `Required`.

### Using AWS CLI
1. Run the `describe-instances` command using appropriate filters to list the IDs of all existing EC2 instances currently available in the selected region:

```bash
aws ec2 describe-instances --region <region> --output table --query "Reservations[*].Instances[*].InstanceId"
```

The command output should return a table with the requested instance IDs.

2. Run the `describe-instances` command using the instance ID returned in the previous step and apply custom filtering to determine whether the selected instance is using IMDSv2:

```bash
aws ec2 describe-instances --region <region> --instance-ids <instance-id> --query "Reservations[*].Instances[*].MetadataOptions" --output table
```

3. Ensure that for all EC2 instances, `HttpTokens` is set to `required` and `State` is set to `applied`.

4. Repeat steps 2 and 3 to verify the other EC2 instances provisioned within the current region.

5. Repeat steps 1-4 to perform the audit process for other AWS regions.

6. Alternatively, the following command can be used to identify instances still using IMDSv1:

```bash
aws ec2 describe-instances --region <region> --query "Reservations[].Instances[?MetadataOptions.HttpTokens=='optional'][] | [].{ID: InstanceId, Tokens: MetadataOptions.HttpTokens, State: MetadataOptions.State}" --output table
```

## Expected Result
For all EC2 instances, `HttpTokens` should be set to `required` and `State` should be `applied`, indicating that only IMDSv2 is allowed.

## Remediation

### Using AWS Console
1. Sign in to the AWS Management Console and navigate to the EC2 dashboard at https://console.aws.amazon.com/ec2/.
2. In the left navigation panel, under the `INSTANCES` section, choose `Instances`.
3. Select the EC2 instance that you want to examine.
4. Choose `Actions` > `Instance Settings` > `Modify instance metadata options`.
5. Set `Instance metadata service` to `Enable`.
6. Set `IMDSv2` to `Required`.
7. Repeat steps 1-6 to perform the remediation process for other EC2 instances in all applicable AWS region(s).

### Using AWS CLI
1. Run the `describe-instances` command, applying the appropriate filters to list the IDs of all existing EC2 instances currently available in the selected region:

```bash
aws ec2 describe-instances --region <region-name> --output table --query "Reservations[*].Instances[*].InstanceId"
```

2. The command output should return a table with the requested instance IDs.

3. Run the `modify-instance-metadata-options` command with an instance ID obtained from the previous step to update the Instance Metadata Version:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-tokens required --region <region-name>
```

4. Repeat steps 1-3 to perform the remediation process for other EC2 instances in the same AWS region.

5. Change the region by updating `--region` and repeat the process for other regions.

## Default Value
By default, new EC2 instances support both IMDSv1 and IMDSv2. IMDSv1 (less secure) remains enabled unless explicitly restricted, so IMDSv2 must be manually required.

## References
1. https://aws.amazon.com/blogs/security/defense-in-depth-open-firewalls-reverse-proxies-ssrf-vulnerabilities-ec2-instance-metadata-service/
2. https://docs.aws.amazon.com/cli/latest/reference/ec2/describe-instances.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 5.2 Maintain Secure Images | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1190 | TA0001 | M1051 |

## Profile
Level 1 | Automated
