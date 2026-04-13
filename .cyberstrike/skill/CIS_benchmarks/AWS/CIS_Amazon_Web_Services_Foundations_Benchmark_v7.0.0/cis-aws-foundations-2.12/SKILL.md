---
name: cis-aws-foundations-2.12
description: "Ensure access keys are rotated every 90 days or less"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, access-keys, key-rotation, credentials]
cis_id: "2.12"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.11, cis-aws-foundations-2.13]
prerequisites: []
severity_boost: {}
---

# Ensure access keys are rotated every 90 days or less

## Description
Access keys consist of an access key ID and secret access key, which are used to sign programmatic requests to AWS. IAM users require access keys to make programmatic calls via the AWS CLI, SDKs, or APIs. It is recommended that all access keys be rotated regularly and at least every 90 days.

## Rationale
Rotating access keys reduces the window of opportunity for a compromised or exposed key to be used. Regular rotation also limits the risk associated with lost, stolen, or improperly stored credentials.

## Impact
Long-lived access keys increase the risk of unauthorized access if compromised, as they may remain valid indefinitely without detection.

## Audit Procedure

### Using AWS Console
1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam
2. Click on `Users`
3. For each user, go to `Security Credentials`
4. Review each key under `Access Keys`
5. For each key with `Status = Active`, ensure the `Created` date is within `90 days`

### Using AWS CLI

1. Run the following commands:

```bash
aws iam generate-credential-report
aws iam get-credential-report --query 'Content' --output text | base64 -d
```

2. Review the following fields:

- `access_key_1_last_rotated`
- `access_key_2_last_rotated`

3. Ensure all active keys have been rotated within `90 days`

## Expected Result
All active access keys should have a `last_rotated` date within the last 90 days. No access key should be older than 90 days.

## Remediation

### Using AWS Console
Perform the following to rotate access keys:

1. Sign in to the AWS Management Console and open the IAM console (https://console.aws.amazon.com/iam)
2. Click on `Users`
3. Select the user
4. Navigate to `Security credentials`

Rotate Access Keys:

5. Click `Create access` key
6. Update all applications and tools to use the new access key
7. After confirming successful use of the new key:
- Deactivate the old key
- Delete the old key when no longer needed

### Using AWS CLI

1. Create a new access key:

```bash
aws iam create-access-key --user-name <user-name>
```

2. Update all applications and tools to use the new access key

3. Check usage of the old key:

```bash
aws iam get-access-key-last-used --access-key-id <access-key-id>
```

4. Deactivate the old key:

```bash
aws iam update-access-key --access-key-id <access-key-id> --status Inactive --user-name <user-name>
```

5. After confirming no usage, delete the old key:

```bash
aws iam delete-access-key --access-key-id <access-key-id> --user-name <user-name>
```

## Default Value
By default, AWS does not enforce access key rotation. Access keys remain valid until manually deactivated or deleted.

## References
1. CCE-78902-4
2. https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#rotate-credentials
3. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_finding-unused.html
4. https://docs.aws.amazon.com/general/latest/gr/managing-aws-access-keys.html
5. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.1 Establish and Maintain an Inventory of Accounts - Establish and maintain an inventory of all accounts managed in the enterprise. The inventory must include both user and administrator accounts. The inventory, at a minimum, should contain the person's name, username, start/stop dates, and department. Validate that all active accounts are authorized, on a recurring schedule at a minimum quarterly, or more frequently. | x | x | x |
| v7 | 16.1 Maintain an Inventory of Authentication Systems - Maintain an inventory of each of the organization's authentication systems, including those located onsite or at a remote service provider. | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1078.004 | TA0006 | M1018 |

## Profile
Level 1 | Automated
