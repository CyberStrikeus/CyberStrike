# WSTG-CONF-11: Test Cloud Storage

## Test ID
WSTG-CONF-11

## Test Name
Test Cloud Storage

## High-Level Description

Cloud storage services (AWS S3, Azure Blob Storage, Google Cloud Storage) are commonly used to store application data, backups, and static assets. Misconfigured access controls can expose sensitive data to unauthorized users or allow arbitrary file uploads. This test identifies publicly accessible buckets, overly permissive ACLs, and other cloud storage misconfigurations.

---

## What to Check

### Access Control Issues

- [ ] Publicly readable buckets/containers
- [ ] Publicly writable buckets/containers
- [ ] Unauthenticated listing permissions
- [ ] Overly permissive ACLs
- [ ] Missing encryption
- [ ] Exposed sensitive data
- [ ] Backup files in public buckets

### Cloud Providers

| Provider | Service | URL Pattern |
|----------|---------|-------------|
| AWS | S3 | `bucket.s3.amazonaws.com` |
| Azure | Blob Storage | `account.blob.core.windows.net` |
| Google | Cloud Storage | `storage.googleapis.com/bucket` |
| DigitalOcean | Spaces | `bucket.region.digitaloceanspaces.com` |

---

## How to Test

### Step 1: Identify Cloud Storage Usage

```bash
# Check for S3 references in source code
curl -s https://target.com | grep -oP 's3\.amazonaws\.com[^"'"'"' ]*'
curl -s https://target.com | grep -oP '[a-z0-9-]+\.s3\.[a-z0-9-]+\.amazonaws\.com'

# Check for Azure Blob
curl -s https://target.com | grep -oP '[a-z0-9]+\.blob\.core\.windows\.net[^"'"'"' ]*'

# Check for Google Cloud Storage
curl -s https://target.com | grep -oP 'storage\.googleapis\.com/[^"'"'"' ]*'
curl -s https://target.com | grep -oP 'storage\.cloud\.google\.com/[^"'"'"' ]*'
```

### Step 2: Test AWS S3 Buckets

#### Basic Access Tests

```bash
# Test read access (unauthenticated)
curl -s https://bucket-name.s3.amazonaws.com/

# List bucket contents
curl -s "https://bucket-name.s3.amazonaws.com/?list-type=2"

# Try to read specific object
curl -s https://bucket-name.s3.amazonaws.com/test.txt

# Test write access
curl -X PUT -d "test" https://bucket-name.s3.amazonaws.com/test.txt
```

#### AWS CLI Tests

```bash
# List bucket contents (no auth)
aws s3 ls s3://bucket-name --no-sign-request

# List with authenticated access
aws s3 ls s3://bucket-name

# Try to copy file
aws s3 cp test.txt s3://bucket-name/ --no-sign-request

# Try to download
aws s3 cp s3://bucket-name/file.txt ./downloaded.txt --no-sign-request

# Check bucket ACL
aws s3api get-bucket-acl --bucket bucket-name --no-sign-request
```

### Step 3: Test Azure Blob Storage

```bash
# List containers
curl -s "https://account.blob.core.windows.net/?comp=list"

# List blobs in container
curl -s "https://account.blob.core.windows.net/container?restype=container&comp=list"

# Access specific blob
curl -s "https://account.blob.core.windows.net/container/blob.txt"

# Check for anonymous access
az storage blob list --account-name account --container-name container --auth-mode anonymous
```

### Step 4: Test Google Cloud Storage

```bash
# List bucket
curl -s "https://storage.googleapis.com/bucket-name"
curl -s "https://storage.googleapis.com/storage/v1/b/bucket-name/o"

# Access object
curl -s "https://storage.googleapis.com/bucket-name/object.txt"

# gsutil commands
gsutil ls gs://bucket-name
gsutil cp gs://bucket-name/file.txt ./
```

### Step 5: Bucket Enumeration

```bash
# Common naming patterns
company="targetcompany"
patterns=(
    "$company"
    "${company}-dev"
    "${company}-staging"
    "${company}-prod"
    "${company}-backup"
    "${company}-uploads"
    "${company}-data"
    "${company}-assets"
    "${company}-media"
    "${company}-logs"
)

for bucket in "${patterns[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://${bucket}.s3.amazonaws.com")
    if [ "$status" != "404" ]; then
        echo "[FOUND] $bucket - Status: $status"
    fi
done
```

### Step 6: Check for Sensitive Data

```bash
# If bucket is accessible, look for sensitive files
sensitive_files=(
    "backup.sql"
    "database.sql"
    "dump.sql"
    "users.csv"
    "credentials.txt"
    "config.json"
    ".env"
    "id_rsa"
    "private.key"
)

for file in "${sensitive_files[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://bucket.s3.amazonaws.com/$file")
    if [ "$status" == "200" ]; then
        echo "[CRITICAL] Sensitive file found: $file"
    fi
done
```

---

## Tools

### AWS Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **AWS CLI** | Official AWS CLI | `aws s3 ls s3://bucket` |
| **S3Scanner** | S3 bucket scanner | `s3scanner scan --bucket bucket-name` |
| **AWSBucketDump** | Dump S3 buckets | `python AWSBucketDump.py -l buckets.txt` |
| **Bucket Finder** | Enumerate buckets | `bucket_finder.rb wordlist` |

### Multi-Cloud Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **CloudBrute** | Multi-cloud enum | `cloudbrute -d target.com` |
| **cloud_enum** | Cloud resource enum | `python3 cloud_enum.py -k target` |
| **Grayhat Warfare** | Bucket search | Online service |

### Azure/GCP Tools

| Tool | Description |
|------|-------------|
| **Azure CLI** | `az storage blob list` |
| **gsutil** | `gsutil ls gs://bucket` |
| **MicroBurst** | Azure security toolkit |

---

## Example Commands/Payloads

### Comprehensive Cloud Storage Scanner

```bash
#!/bin/bash
TARGET=$1

echo "=== CLOUD STORAGE SCANNER ==="
echo "Target: $TARGET"
echo ""

# Generate bucket name variations
variations=(
    "$TARGET"
    "${TARGET}-dev"
    "${TARGET}-prod"
    "${TARGET}-staging"
    "${TARGET}-backup"
    "${TARGET}-uploads"
    "${TARGET}-assets"
    "${TARGET}-data"
    "${TARGET}-media"
    "${TARGET}backup"
    "${TARGET}dev"
    "${TARGET}prod"
)

# Test AWS S3
echo "[+] Testing AWS S3 buckets..."
for bucket in "${variations[@]}"; do
    # Test bucket existence and access
    response=$(curl -s -o /dev/null -w "%{http_code}" "https://${bucket}.s3.amazonaws.com")

    case $response in
        200)
            echo "  [OPEN] $bucket - Publicly accessible!"
            # Try to list
            aws s3 ls "s3://${bucket}" --no-sign-request 2>/dev/null | head -5
            ;;
        403)
            echo "  [EXISTS] $bucket - Access denied (bucket exists)"
            ;;
        404)
            # Not found, skip
            ;;
        *)
            echo "  [?] $bucket - Status: $response"
            ;;
    esac
done

# Test Azure Blob
echo ""
echo "[+] Testing Azure Blob Storage..."
for account in "${variations[@]}"; do
    response=$(curl -s -o /dev/null -w "%{http_code}" "https://${account}.blob.core.windows.net/?comp=list")
    if [ "$response" != "000" ] && [ "$response" != "404" ]; then
        echo "  [CHECK] $account.blob.core.windows.net - Status: $response"
    fi
done

# Test GCP Storage
echo ""
echo "[+] Testing Google Cloud Storage..."
for bucket in "${variations[@]}"; do
    response=$(curl -s -o /dev/null -w "%{http_code}" "https://storage.googleapis.com/${bucket}")
    if [ "$response" == "200" ]; then
        echo "  [OPEN] $bucket - Publicly accessible!"
    elif [ "$response" == "403" ]; then
        echo "  [EXISTS] $bucket - Access denied"
    fi
done

echo ""
echo "[+] Scan complete"
```

### S3Scanner Usage

```bash
# Install
pip install s3scanner

# Scan single bucket
s3scanner scan --bucket bucket-name

# Scan from file
s3scanner scan --buckets-file buckets.txt

# Dump accessible buckets
s3scanner dump --bucket bucket-name --out-dir ./dump/
```

---

## Remediation Guide

### 1. AWS S3 Best Practices

```json
// Bucket Policy - Deny public access
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "DenyPublicAccess",
            "Effect": "Deny",
            "Principal": "*",
            "Action": "s3:*",
            "Resource": [
                "arn:aws:s3:::bucket-name",
                "arn:aws:s3:::bucket-name/*"
            ],
            "Condition": {
                "Bool": {
                    "aws:SecureTransport": "false"
                }
            }
        }
    ]
}
```

```bash
# Enable S3 Block Public Access
aws s3api put-public-access-block \
    --bucket bucket-name \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable default encryption
aws s3api put-bucket-encryption \
    --bucket bucket-name \
    --server-side-encryption-configuration \
    '{"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}'
```

### 2. Azure Blob Security

```bash
# Disable public access
az storage account update \
    --name accountname \
    --resource-group rg \
    --allow-blob-public-access false
```

### 3. GCP Cloud Storage

```bash
# Remove public access
gsutil iam ch -d allUsers gs://bucket-name
gsutil iam ch -d allAuthenticatedUsers gs://bucket-name

# Enable uniform bucket-level access
gsutil uniformbucketlevelaccess set on gs://bucket-name
```

### 4. General Recommendations

- Enable "Block Public Access" at account level
- Use bucket policies to restrict access
- Enable encryption at rest
- Enable access logging
- Regular security audits
- Use pre-signed URLs for temporary access

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Publicly readable bucket with sensitive data | 9.8 | Critical |
| Publicly writable bucket | 9.8 | Critical |
| Publicly listable bucket | 7.5 | High |
| Bucket exists (enumeration) | 3.7 | Low |

**Critical Finding Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-284** | Improper Access Control | Misconfigured bucket ACLs |
| **CWE-200** | Information Exposure | Public data disclosure |
| **CWE-306** | Missing Authentication | Unauthenticated access |

---

## References

- [OWASP WSTG - Test Cloud Storage](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/11-Test_Cloud_Storage)
- [AWS S3 Security Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
- [Grayhat Warfare - Open S3 Buckets](https://buckets.grayhatwarfare.com/)

---

## Checklist

```
[ ] Cloud storage URLs identified in application
[ ] AWS S3 buckets tested (read/write/list)
[ ] Azure Blob Storage tested
[ ] Google Cloud Storage tested
[ ] Bucket enumeration performed
[ ] Sensitive files checked
[ ] ACL/permissions reviewed
[ ] Encryption status verified
[ ] Logging enabled
[ ] Public access settings reviewed
[ ] Findings documented
```
