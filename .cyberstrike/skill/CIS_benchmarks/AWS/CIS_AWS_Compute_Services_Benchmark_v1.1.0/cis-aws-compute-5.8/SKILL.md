---
name: cis-aws-compute-5.8
description: "Ensure Lightsail instances are attached to the buckets"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lightsail, buckets, storage, resource-access, instances]
cis_id: "5.8"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-5.7, cis-aws-compute-5.9, cis-aws-compute-5.10]
prerequisites: []
severity_boost: {}
---

# 5.8 Ensure Lightsail instances are attached to the buckets (Manual)

## Description

Attaching an Amazon Lightsail instance to a Lightsail storage bucket gives it full programmatic access to the bucket and its objects.

## Rationale

When you attach instances to buckets, you don't have to manage credentials like access keys. Resource access is ideal if you're configuring software or a plugin on your instance to upload files directly to your bucket. For example, if you want to configure a WordPress instance to store media files on a bucket configuration with bucket storage resource access allows for that securely.

## Impact

You can attach instances that are in a running state only. Additionally, the instances have to be in the same AWS Region as the bucket or the buckets have to be in the same region as the instances.

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select `Storage`.
5. All Lightsail buckets are listed here.
6. Click on a bucket name
7. Click `Permissions`.
8. Scroll down to `Resource access` and confirm that your instance is attached.
9. If the instance using this Storage bucket is not attached refer to the remediation below.

### Using AWS CLI

1. Run `aws lightsail get-buckets`

```bash
aws lightsail get-buckets
```

This command will provide a list of Buckets tied to Lightsail.

2. If there are no buckets listed then refer to the remediation below.

## Expected Result

Lightsail instances that need bucket access should be attached to their respective storage buckets via resource access, eliminating the need for access key management.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Confirm that the `instance` you want to connect to the Storage bucket is in a `running` state
5. If it is move on to Step 6. If it is not click on the instance name, then click on `Start`. Wait for the status to read `Running`
6. Select `Storage`.
7. All Lightsail buckets are listed here.
8. Click on the bucket you want to associate with the instances.
9. Click `Permissions`.
10. Scroll down to `Resource access`.
11. Click on `Attach instance`
12. Click on `Choose an instance`
13. Select the instance
14. Click Attach
15. Repeat this for any other instances and buckets that need to be attached.

### Using AWS CLI

1. Run `aws lightsail create-bucket`

```bash
aws lightsail create-bucket --bucket-name test-cli-bucket2 --bundle-id small_1_0
```

This command will create a bucket.
If you want to review the bundle size ids run this command.

```bash
aws lightsail get-bucket-bundles
```

Example output:
```json
"bundles": [
    {
        "bundleId": "small_1_0",
        "name": "Object Storage 5GB",
        "price": 1.0,
        "storagePerMonthInGb": 5,
        "transferPerMonthInGb": 25,
        "isActive": true
    },
    {
        "bundleId": "medium_1_0",
        "name": "Object Storage 100GB",
        "price": 3.0,
        "storagePerMonthInGb": 100,
        "transferPerMonthInGb": 250,
        "isActive": true
    },
    {
        "bundleId": "large_1_0",
        "name": "Object Storage 250GB",
        "price": 5.0,
        "storagePerMonthInGb": 250,
        "transferPerMonthInGb": 500,
        "isActive": true
    }
]
```

Change the "bundleId" to the size of storage you need.
Repeat and create all the S3 buckets that you need for Lightsail.

## Default Value

Lightsail instances are not attached to buckets by default. Bucket attachment must be configured manually.

## References

1. https://lightsail.aws.amazon.com/ls/docs/en_us/articles/amazon-lightsail-configuring-bucket-resource-access

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x | x | x |
| v8 | 3.11 Encrypt Sensitive Data at Rest - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. | | x | x |
| v7 | 1.7 Deploy Port Level Access Control - Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network. The authentication system shall be tied into the hardware asset inventory data to ensure only authorized devices can connect to the network. | | x | x |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts - Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities. | x | x | x |

## Profile

Level 1 | Manual
