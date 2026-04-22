---
name: cis-eks-v160-5.1.1
description: "Ensure Image Vulnerability Scanning using Amazon ECR image scanning or a third party provider (Automated)"
category: cis-eks
version: "1.6.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, ecr, image-scanning, vulnerability-scanning, container-security]
cis_id: "5.1.1"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1 Ensure Image Vulnerability Scanning using Amazon ECR image scanning or a third party provider (Automated)

## Profile Applicability

- Level 1

## Description

Scan images being deployed to Amazon EKS for vulnerabilities.

## Rationale

Vulnerabilities in software packages can be exploited by hackers or malicious users to obtain unauthorized access to local cloud resources. Amazon ECR and other third party products allow images to be scanned for known vulnerabilities.

## Impact

If you are utilizing AWS ECR, the following are common image scan failures. You can view errors like this in the Amazon ECR console by displaying the image details or through the API or AWS CLI by using the DescribeImageScanFindings API.

- **UnsupportedImageError:** You may get an UnsupportedImageError when attempting to scan an image that was built using an operating system that Amazon ECR doesn't support image scanning for. Amazon ECR supports package vulnerability scanning for major versions of Amazon Linux, Amazon Linux 2, Debian, Ubuntu, CentOS, Oracle Linux, Alpine, and RHEL Linux distributions. Amazon ECR does not support scanning images built from the Docker scratch image.
- **An UNDEFINED severity level is returned:** You may receive a scan finding that has a severity level of UNDEFINED. The following are the common causes for this:
  - The vulnerability was not assigned a priority by the CVE source.
  - The vulnerability was assigned a priority that Amazon ECR did not recognize.

To determine the severity and description of a vulnerability, you can view the CVE directly from the source.

## Audit Procedure

Please follow AWS ECR or your 3rd party image scanning provider's guidelines for enabling Image Scanning.

```bash
aws ecr describe-repositories --repository-names $REPO_NAME --region $REGION_CODE
```

## Remediation

To utilize AWS ECR for Image scanning please follow the steps below:

To create a repository configured for scan on push (AWS CLI):

```bash
aws ecr create-repository --repository-name $REPO_NAME --image-scanning-configuration scanOnPush=true --region $REGION_CODE
```

To edit the settings of an existing repository (AWS CLI):

```bash
aws ecr put-image-scanning-configuration --repository-name $REPO_NAME --image-scanning-configuration scanOnPush=true --region $REGION_CODE
```

Use the following steps to start a manual image scan using the AWS Management Console:

1. Open the Amazon ECR console at https://console.aws.amazon.com/ecr/repositories.
2. From the navigation bar, choose the Region to create your repository in.
3. In the navigation pane, choose Repositories.
4. On the Repositories page, choose the repository that contains the image to scan.
5. On the Images page, select the image to scan and then choose Scan.

## Default Value

Images are not scanned by Default.

## References

1. https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 7.5 Perform Automated Vulnerability Scans of Internal Enterprise Assets | | X | X |
| v8 | 7.6 Perform Automated Vulnerability Scans of Externally-Exposed Enterprise Assets | | X | X |
| v7 | 3.1 Run Automated Vulnerability Scanning Tools | | X | X |
| v7 | 3.2 Perform Authenticated Vulnerability Scanning | | X | X |
