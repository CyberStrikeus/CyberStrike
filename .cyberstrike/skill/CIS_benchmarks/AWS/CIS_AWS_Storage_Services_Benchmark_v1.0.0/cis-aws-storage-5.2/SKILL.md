---
name: cis-aws-storage-5.2
description: "Ensure direct data addition to S3"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, s3, data-upload, access-point, level-2]
cis_id: "5.2"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-5.1, cis-aws-storage-5.3]
prerequisites: [cis-aws-storage-5.1]
severity_boost: {}
---

# 5.2 Ensure direct data addition to S3 (Manual)

## Profile Applicability
- Level 2

## Description

Your bucket name must be unique and not already in use on AWS. Click on your bucket name, and in the right corner, you will find an option to upload data directly to your S3 bucket. You can choose the file option to upload individual files, images, or even entire folders.

## Rationale

Accessing the upload option within your bucket simplifies the process of adding data, making it easy to manage and organize your files. This streamlined approach allows for efficient data storage, retrieval, and management within the AWS S3 environment, enhancing overall operational efficiency.

## Impact

Without direct data upload capability:
- **Operational Inefficiency:** Manual data transfer processes become more complex
- **User Experience:** Reduced ease of use for data management
- **Data Management:** Difficulty organizing and uploading files at scale
- **Access Control:** May bypass proper access point configurations if not using recommended methods

## Audit Procedure

### AWS Console

**Access Point in S3 Bucket:**

Access points are named network endpoints that are attached to buckets which simplify managing data access at scale in S3. To see if any of the access points attached to this bucket grant public or cross-account access, go to IAM Access Analyzer for S3.

1. Navigate to your S3 bucket
2. Click on the bucket name
3. Review the upload functionality:
   - Verify upload button is available in the right corner
   - Check for proper access controls before uploading
4. Review Access Points (if configured):
   - Navigate to the "Access Points" tab
   - Verify access points are properly configured
   - Check IAM Access Analyzer for S3 findings
5. Verify bucket configuration:
   - Unique bucket name (not used anywhere on AWS)
   - Proper VPC configuration (Virtual Private Cloud)
   - Appropriate subnet selection
   - Endpoint policy configuration (if using access points)

### AWS CLI

```bash
# List objects in bucket to verify upload capability
aws s3 ls s3://<bucket-name>/

# Upload a test file
aws s3 cp <local-file> s3://<bucket-name>/<key-name>

# Verify upload succeeded
aws s3 ls s3://<bucket-name>/<key-name>

# List access points for the bucket
aws s3control list-access-points \
  --account-id <account-id> \
  --bucket <bucket-name>

# Describe specific access point
aws s3control get-access-point \
  --account-id <account-id> \
  --name <access-point-name>

# Check for public access through access points
aws s3control get-access-point-policy-status \
  --account-id <account-id> \
  --name <access-point-name>
```

## Expected Result

S3 bucket should allow direct data upload with:
- Unique bucket name globally across AWS
- Upload functionality available through console or CLI
- Proper access controls configured
- Access points (if used) properly configured with appropriate permissions
- No public or unintended cross-account access through access points
- Files can be uploaded individually or in folders
- Upload process is streamlined and efficient

## Remediation

### AWS Console

**Upload Data to S3 Bucket:**

1. Navigate to your S3 bucket
2. Click on your bucket name
3. In the right corner, find the upload option
4. Choose the file option to upload:
   - Individual files
   - Images
   - Entire folders
5. Select files and upload

**Configure Access Point (Optional but Recommended for Scale):**

1. **Enter a name for the access point.** The name must be unique within the AWS account and Region
2. **Choose the VPC (Virtual Private Cloud) and subnet** where you want the access point to be accessible. This determines the network traffic routing for the access point
3. **Optionally, you can configure additional settings** such as permissions, bucket policy, and endpoint policy for the access point
4. **Review the settings, and click on "Create access point"** to create the access point

### AWS CLI

**Upload Files to S3:**

```bash
# Upload single file
aws s3 cp <local-file> s3://<bucket-name>/<key-name>

# Upload directory (recursive)
aws s3 cp <local-directory>/ s3://<bucket-name>/<prefix>/ --recursive

# Upload with server-side encryption
aws s3 cp <local-file> s3://<bucket-name>/<key-name> \
  --server-side-encryption AES256

# Sync local directory with S3 bucket
aws s3 sync <local-directory>/ s3://<bucket-name>/<prefix>/
```

**Create Access Point:**

```bash
# Create access point
aws s3control create-access-point \
  --account-id <account-id> \
  --name <access-point-name> \
  --bucket <bucket-name> \
  --vpc-configuration VpcId=<vpc-id>

# Set access point policy
aws s3control put-access-point-policy \
  --account-id <account-id> \
  --name <access-point-name> \
  --policy file://access-point-policy.json

# Verify access point creation
aws s3control get-access-point \
  --account-id <account-id> \
  --name <access-point-name>
```

**Example Access Point Policy (access-point-policy.json):**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::<account-id>:role/<role-name>"
      },
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:<region>:<account-id>:accesspoint/<access-point-name>/object/*"
    }
  ]
}
```

## Default Value

By default:
- S3 buckets support direct upload through console and CLI
- No access points are configured
- Bucket policies and IAM policies control access
- Standard S3 endpoints are used

## References

1. https://docs.aws.amazon.com/redshift/latest/dg/tutorial-loading-data-upload-files.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v8 | 8.3 Ensure Adequate Audit Log Storage<br/>Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process. | ● | ● | ● |
| v7 | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers<br/>Only allow access to authorized cloud storage or email providers. | | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |

## Profile
Level 2
