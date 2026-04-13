---
name: cis-aws-foundations-2.18
description: "Ensure that IAM External Access Analyzer is enabled for all regions"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, access-analyzer, external-access, cross-account, resource-policies]
cis_id: "2.18"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.14, cis-aws-foundations-2.21]
prerequisites: []
severity_boost: {}
---

# Ensure that IAM External Access Analyzer is enabled for all regions

## Description
Enable IAM External Access Analyzer for all resources in each active AWS region.

IAM Access Analyzer is a service that analyzes resource policies to identify resources that can be accessed from outside the account. After the analyzer is enabled, scan results are displayed in the console showing accessible resources. These results help determine whether unintended access is permitted, making it easier for administrators to monitor least privilege access. Access Analyzer analyzes only policies applied to resources within the same AWS region.

## Rationale
IAM External Access Analyzer helps identify resources in your account or organization that are shared with external entities. This allows detection of unintended access to resources and data. It continuously monitors policies for services such as S3 buckets, KMS keys, Lambda functions, and SQS queues.

## Impact
If IAM External Access Analyzer is not enabled, unintended external access to resources may go undetected, increasing the risk of data exposure or unauthorized access.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam
2. Under `Access analyzer` choose `Analyzer Settings`
3. On the `Analyzer Settings` page, review the list of analyzers
4. Identify analyzers where the `Finding type` is `External Access`
5. Repeat these steps for each active region, as analyzers are region-specific

### Using AWS CLI

1. Run the following command:

```bash
aws accessanalyzer list-analyzers --type <ACCOUNT|ORGANIZATION> --region <region_name> | grep status
```

2. Ensure that at least one Analyzer's `status` is set to `ACTIVE`

3. To check all regions:

```bash
for r in $(aws ec2 describe-regions --query "Regions[].RegionName" --output text); do
  echo "=== $r ==="
  aws accessanalyzer list-analyzers --region "$r" --type ACCOUNT --query "analyzers[].status" --output text
done
```

4. Ensure each region returns at least one `ACTIVE` analyzer

## Expected Result
Every active AWS region should have at least one IAM External Access Analyzer with `ACTIVE` status. The analyzer should be configured with `Finding type` set to `External Access`.

## Remediation

### Using AWS Console

Perform the following to enable IAM Access Analyzer for IAM policies:

1. Open the IAM console at https://console.aws.amazon.com/iam/
2. Choose `Access analyzer`
3. Select `Create analyzer`
4. Select `External access` analyzer
5. Confirm the region
6. Optionally provide a name and tags
7. Select `Create analyzer`
8. Repeat for each active region

### Using AWS CLI

1. Create an analyzer in a region:

```bash
aws accessanalyzer list-analyzers --type <ACCOUNT|ORGANIZATION> --region <region_name> | grep status
```

2. Repeat for each region as required

## Default Value
By default, IAM External Access Analyzer is not enabled in any region. An analyzer must be explicitly created in each region.

## References
1. https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html
2. https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-getting-started.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/accessanalyzer/get-analyzer.html
4. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/accessanalyzer/create-analyzer.html

## Additional Information
- IAM Access Analyzer is region-specific and must be enabled in each region
- For multi-account environments, consider using an `ORGANIZATION` analyzer to centralize findings
- Some AWS regions are enabled by default, while others must be manually enabled

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | x | x | x |

## Profile
Level 1 | Automated
