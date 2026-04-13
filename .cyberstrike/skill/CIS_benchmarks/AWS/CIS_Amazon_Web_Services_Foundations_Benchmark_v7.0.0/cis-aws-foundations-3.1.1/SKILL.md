---
name: cis-aws-foundations-3.1.1
description: "Ensure S3 Bucket Policy is set to deny HTTP requests"
category: cis-storage
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, s3, encryption, tls, https, bucket-policy]
cis_id: "3.1.1"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-3.1.2, cis-aws-foundations-3.1.3, cis-aws-foundations-3.1.4]
prerequisites: []
severity_boost: {}
---

# Ensure S3 Bucket Policy is set to deny HTTP requests

## Description

At the Amazon S3 bucket level, permissions can be configured through a bucket policy to ensure objects are accessible only through HTTPS.

## Rationale

By default, Amazon S3 allows both HTTP and HTTPS requests. To ensure that access to S3 objects is only permitted through HTTPS, you must explicitly deny HTTP requests. Bucket policies that allow HTTPS requests without explicitly denying HTTP requests do not meet this requirement.

## Impact

If HTTP access is not explicitly denied, data transmitted to and from S3 buckets may be exposed to interception or man-in-the-middle attacks.

## Audit Procedure

### Using AWS Console

1. Login to the AWS Management Console and open the Amazon S3 console using https://console.aws.amazon.com/s3/
2. Select the target bucket
3. Select the 'Permissions' tab
4. Select `Bucket policy`
5. Ensure a policy exists that explicitly denies HTTP requests using one of the following conditions:

**Option 1: Deny non-HTTPS requests**

```json
{
  "Sid": "<optional>",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": "arn:aws:s3:::<bucket_name>/*",
  "Condition": {
    "Bool": {
      "aws:SecureTransport": "false"
    }
  }
}
```

**Option 2: Enforce minimum TLS version**

```json
{
  "Sid": "<optional>",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": ["arn:aws:s3:::<bucket_name>", "arn:aws:s3:::<bucket_name>/*"],
  "Condition": {
    "NumericLessThan": {
      "s3:TlsVersion": "1.2"
    }
  }
}
```

6. Repeat for all S3 buckets

### Using AWS CLI

1. List all of the S3 Buckets:

```bash
aws s3 ls
```

2. For each bucket, run:

```bash
aws s3api get-bucket-policy --bucket <bucket_name> | grep aws:SecureTransport
```

or

```bash
aws s3api get-bucket-policy --bucket <bucket_name> | grep s3:TlsVersion
```

3. Verify the policy includes either:
   - `"aws:SecureTransport": "false"` with `"Effect": "Deny"`
   - or a TLS version restriction using `"s3:TlsVersion"`

4. If no policy is returned, the bucket allows both HTTP and HTTPS requests by default

## Expected Result

Each S3 bucket should have a bucket policy that explicitly denies HTTP requests either by using the `aws:SecureTransport` condition set to `false` with a `Deny` effect, or by enforcing a minimum TLS version using the `s3:TlsVersion` condition.

## Remediation

### Using AWS Console

1. Sign in to the AWS Management Console and open the Amazon S3 console
2. Select the bucket
3. Select the `Permissions` tab
4. Select `Bucket policy`
5. Add one of the following statements to the policy

**Deny HTTP requests:**

```json
{
  "Sid": "<optional>",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": "arn:aws:s3:::<bucket_name>/*",
  "Condition": {
    "Bool": {
      "aws:SecureTransport": "false"
    }
  }
}
```

**Enforce TLS version:**

```json
{
  "Sid": "<optional>",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": ["arn:aws:s3:::<bucket_name>", "arn:aws:s3:::<bucket_name>/*"],
  "Condition": {
    "NumericLessThan": {
      "s3:TlsVersion": "1.2"
    }
  }
}
```

6. Save the policy
7. Repeat for all relevant buckets

**Using AWS Policy Generator:**

1. Repeat steps 1-4 above
2. Click on `Policy Generator` at the bottom of the Bucket Policy editor
3. Select `S3 Bucket Policy` as the policy type
4. Configure the statement:
   - `Effect` = Deny
   - `Principal` = \*
   - `AWS Service` = Amazon S3
   - `Actions` = \*
   - `Amazon Resource Name` = <ARN of the S3 Bucket>
5. Select `Generate Policy`
6. Copy the generated policy and add it to the bucket policy

### Using AWS CLI

1. Export the existing policy, if one exists:

```bash
aws s3api get-bucket-policy --bucket <bucket_name> --query Policy --output text > policy.json
```

If the bucket does not already have a policy, create a new `policy.json` file containing a valid bucket policy document.

2. Modify `policy.json` to include one of the following deny statements within the `Statement` array.

**Option 1: Deny HTTP requests**

```json
{
  "Sid": "<optional>",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": "arn:aws:s3:::<bucket_name>/*",
  "Condition": {
    "Bool": {
      "aws:SecureTransport": "false"
    }
  }
}
```

**Option 2: Enforce minimum TLS version**

```json
{
  "Sid": "<optional>",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": ["arn:aws:s3:::<bucket_name>", "arn:aws:s3:::<bucket_name>/*"],
  "Condition": {
    "NumericLessThan": {
      "s3:TlsVersion": "1.2"
    }
  }
}
```

3. Apply the modified policy back to the S3 bucket:

```bash
aws s3api put-bucket-policy --bucket <bucket_name> --policy file://policy.json
```

## Default Value

By default, Amazon S3 accepts both HTTP and HTTPS requests. No bucket policy is applied to deny unencrypted (HTTP) access unless explicitly configured.

## References

1. https://aws.amazon.com/premiumsupport/knowledge-center/s3-bucket-policy-for-config-rule/
2. https://aws.amazon.com/blogs/security/how-to-use-bucket-policies-and-apply-defense-in-depth-to-help-secure-your-amazon-s3-data/
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3api/get-bucket-policy.html

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1040                       | TA0006, TA0007 | M1041       |

## Profile

Level 2 | Automated
