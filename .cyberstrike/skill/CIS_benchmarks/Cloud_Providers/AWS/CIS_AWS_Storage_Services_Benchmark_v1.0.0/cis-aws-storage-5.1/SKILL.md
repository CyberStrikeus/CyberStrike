---
name: cis-aws-storage-5.1
description: "Amazon Simple Storage Service (S3)"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, s3, object-storage, level-2]
cis_id: "5.1"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-5.2, cis-aws-storage-5.3]
prerequisites: []
severity_boost: {}
---

# 5.1 Amazon Simple Storage Service (Manual)

## Profile Applicability

- Level 2

## Description

Amazon Simple Storage Service (Amazon S3) is an object storage service that provides industry-leading scalability, data availability, security, and performance. It allows customers of all sizes and industries to store and protect any amount of data for virtually any use case, including data lakes, cloud-native applications, and mobile apps. With cost-effective storage classes and intuitive management features, you can optimize costs, organize data, and configure precise access controls to meet your specific business, organizational, and compliance requirements.

## Rationale

By utilizing S3, businesses of all sizes can efficiently store and protect large amounts of data, ensuring it is accessible when needed. The service's cost-effective storage classes and user-friendly management features help optimize costs and streamline data organization. Additionally, S3's fine-tuned access controls allow organizations to meet specific business, organizational, and compliance requirements, enhancing overall data management and security.

## Impact

Not implementing Amazon S3 or failing to properly configure it can result in:

- **Scalability Issues:** Inability to handle growing data volumes efficiently
- **Data Availability:** Reduced data durability and availability (S3 provides 99.999999999% durability)
- **Security Risks:** Lack of proper access controls and encryption
- **Compliance Violations:** Inability to meet data retention and protection requirements
- **Cost Inefficiency:** Missing out on cost optimization through storage classes
- **Data Management Challenges:** Difficulty organizing and retrieving data at scale

## Audit Procedure

### AWS Console

**Review S3 Service Understanding:**

1. Navigate to the Amazon S3 console: https://s3.console.aws.amazon.com/s3/
2. Review the key concepts:
   - **Buckets:** Containers for storing objects
   - **Objects:** Individual files stored in buckets with unique key names
   - **Keys:** Unique identifiers for objects within buckets
   - **Regions:** Geographic locations where buckets are created
   - **Versioning:** Ability to keep multiple versions of objects
   - **Bucket Policies:** JSON-based access control policies
   - **IAM Policies:** Identity-based permissions for S3 access
   - **Access Control Lists (ACLs):** Legacy access control method
   - **S3 Access Points:** Named network endpoints for simplified access management

**Verify S3 Features Implementation:**

1. **Data Privacy and Access Control:**
   - Buckets and objects are private by default
   - Verify explicit permissions are required for access
   - Check bucket policies, IAM policies, ACLs, and S3 Access Points configuration

2. **Versioning:**
   - Review buckets with versioning enabled
   - Verify versioning is used to keep multiple versions of objects
   - Confirm ability to restore accidentally deleted or overwritten objects

### AWS CLI

```bash
# List all S3 buckets
aws s3api list-buckets --query 'Buckets[].[Name,CreationDate]' --output table

# Get bucket location
aws s3api get-bucket-location --bucket <bucket-name>

# Check versioning status
aws s3api get-bucket-versioning --bucket <bucket-name>

# Review bucket policy
aws s3api get-bucket-policy --bucket <bucket-name> --output json

# Check bucket ACL
aws s3api get-bucket-acl --bucket <bucket-name>

# List access points
aws s3control list-access-points --account-id <account-id>

# Check public access block configuration
aws s3api get-public-access-block --bucket <bucket-name>

# Get bucket encryption
aws s3api get-bucket-encryption --bucket <bucket-name>
```

## Expected Result

Amazon S3 should be properly understood and implemented with:

- Buckets created in appropriate AWS regions
- Objects stored with unique key names
- Versioning enabled where appropriate for data protection
- Proper access controls configured (bucket policies, IAM policies, or S3 Access Points)
- Buckets and objects are private by default
- Public access blocked unless explicitly required
- Encryption enabled for data at rest

## Remediation

### Understanding S3 Key Concepts

**How Amazon S3 works:**

1. **Create a bucket and specify a bucket name and AWS Region:**
   - Bucket names must be globally unique
   - Choose region based on latency, cost, and regulatory requirements

2. **Upload data to bucket as objects:**
   - Each object has a key (unique identifier within bucket)
   - Objects can be up to 5 TB in size
   - Use folders (prefixes) for organization

3. **Configure features:**
   - **S3 Versioning:** Keep multiple versions of objects for recovery from accidental deletion or overwrite
   - **Bucket Policies:** JSON-based access control policies for buckets and objects
   - **IAM Policies:** Identity-based permissions for users and roles
   - **ACLs:** Legacy access control (prefer bucket policies or IAM policies)
   - **S3 Access Points:** Named network endpoints to simplify access management at scale

**Data Privacy:**

- Buckets and objects are **private by default**
- Explicit permissions required via:
  - Bucket policies
  - IAM policies
  - Access Control Lists (ACLs)
  - S3 Access Points

### AWS Console

1. Navigate to Amazon S3 console: https://s3.console.aws.amazon.com/s3/
2. Click "Create bucket"
3. Configure bucket settings:
   - Bucket name (globally unique)
   - Region
   - Versioning (recommended: Enabled)
   - Encryption (recommended: Enable with SSE-S3 or SSE-KMS)
   - Block Public Access (recommended: Enable all options)
   - Object Lock (optional, for compliance)

### AWS CLI

```bash
# Create S3 bucket
aws s3api create-bucket \
  --bucket <unique-bucket-name> \
  --region <region> \
  --create-bucket-configuration LocationConstraint=<region>

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket <bucket-name> \
  --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
  --bucket <bucket-name> \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'

# Block public access
aws s3api put-public-access-block \
  --bucket <bucket-name> \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Upload object
aws s3 cp <local-file> s3://<bucket-name>/<key-name>
```

## Default Value

By default:

- S3 service is available in all AWS accounts
- Buckets and objects are private
- Versioning is disabled (must be explicitly enabled)
- Encryption is not enabled by default (must be configured)
- No bucket policies are configured
- ACLs provide bucket owner full control

## References

1. https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v8               | 8.3 Ensure Adequate Audit Log Storage<br/>Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process.                                                                                                                                                                                                                                       | ●    | ●    | ●    |
| v7               | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers<br/>Only allow access to authorized cloud storage or email providers.                                                                                                                                                                                                                                                              |      | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

Level 2
