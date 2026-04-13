---
name: cis-aws-compute-5.9
description: "Ensure that your Lightsail buckets are not publicly accessible"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lightsail, buckets, public-access, permissions, storage]
cis_id: "5.9"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-5.7, cis-aws-compute-5.8, cis-aws-compute-5.10]
prerequisites: []
severity_boost: {}
---

# 5.9 Ensure that your Lightsail buckets are not publicly accessible (Manual)

## Description

You can make all objects private, public (read-only) or private while making individual objects public (read-only). By default when creating a bucket the permissions are set to "All objects are private".

## Rationale

When the Bucket access permissions are set to All objects are public (read-only) - All objects in the bucket are readable by anyone on the internet through the URL of the bucket.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select `Storage`.
5. All Lightsail buckets are listed here.
6. Underneath the bucket name and size there are 3 possible statements:

```
All objects are private
All objects are public (read-Only)
Individual objects can be public
```

7. If any buckets are set to `All objects are public (read-Only)` and or 'Individual objects can be public' refer to the remediation below.

### Using AWS CLI

1. Run `aws lightsail get-buckets`

```bash
aws lightsail get-buckets
```

This command will provide a list of Buckets tied to Lightsail.

2. Review the accessRules, getobject and allowPublicOverrides.

```json
"accessRules": {
    "getObject": "private",
    "allowPublicOverrides": false
}
```

4. If it reads "getObject": "public" or "allowPublicOverrides": true please make note "name" of the bucket also listed in the output.
5. Then refer to the remediation below.

## Expected Result

All Lightsail buckets should have access rules set to `"getObject": "private"` and `"allowPublicOverrides": false`, meaning all objects are private.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select `Storage`.
5. All Lightsail buckets are listed here.
6. Click on the bucket name that has `All objects are public (read-Only)` listed.
7. Click on `Permissions`
8. Click on `Change permissions`
9. Select `All objects are private`
10. Click `Save`
11. Repeat for any other Buckets within Lightsail that are set with `All objects are public (read-Only)` and/or `Individual objects can be made public and read only`

### Using AWS CLI

1. Run `aws lightsail update-bucket`

```bash
aws lightsail update-bucket --bucket-name <name from list in audit> --access-rules getObject="private",allowPublicOverrides=false
```

2. The confirmation that the change was made will print out after running that command.
3. Repeat for any other buckets listed in the audit.

## Default Value

By default when creating a bucket the permissions are set to "All objects are private".

## References

1. https://lightsail.aws.amazon.com/ls/docs/en_us/articles/amazon-lightsail-understanding-bucket-permissions

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | x | x | x |

## Profile

Level 1 | Manual
