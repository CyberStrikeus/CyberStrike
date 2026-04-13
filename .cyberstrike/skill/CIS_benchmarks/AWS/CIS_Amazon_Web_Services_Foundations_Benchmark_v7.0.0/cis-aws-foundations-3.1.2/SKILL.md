---
name: cis-aws-foundations-3.1.2
description: "Ensure MFA Delete is enabled on S3 buckets"
category: cis-storage
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, s3, mfa, delete-protection, versioning]
cis_id: "3.1.2"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-3.1.1, cis-aws-foundations-3.1.3, cis-aws-foundations-3.1.4]
prerequisites: []
severity_boost: {}
---

# Ensure MFA Delete is enabled on S3 buckets

## Description
Once MFA Delete is enabled on your sensitive and classified S3 bucket, it requires the user to provide two forms of authentication.

## Rationale
Adding MFA delete to an S3 bucket requires additional authentication when you change the version state of your bucket or delete an object version, adding another layer of security in the event your security credentials are compromised or unauthorized access is granted.

## Impact
Enabling MFA delete on an S3 bucket could require additional administrator oversight. Enabling MFA delete may impact other services that automate the creation and/or deletion of S3 buckets.

## Audit Procedure

### Using AWS Console
1. Login to the S3 console at https://console.aws.amazon.com/s3/.
2. Click the `check` box next to the name of the bucket you want to confirm.
3. In the window under `Properties`:
   - Confirm that Versioning is `Enabled`
   - Confirm that MFA Delete is `Enabled`

### Using AWS CLI
1. Run the `get-bucket-versioning` command:

```bash
aws s3api get-bucket-versioning --bucket my-bucket | grep MfaDelete
```

Example output:

```xml
<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Status>Enabled</Status>
  <MfaDelete>Enabled</MfaDelete>
</VersioningConfiguration>
```

If the console or CLI output does not show that Versioning and MFA Delete are `enabled`, please refer to the remediation below.

## Expected Result
Both Versioning and MFA Delete should be `Enabled` for the S3 bucket. The `get-bucket-versioning` command should return `MfaDelete: Enabled`.

## Remediation

### Using AWS Console
You cannot enable MFA Delete using the AWS Management Console; you must use the AWS CLI or API. You must use your 'root' account to enable MFA Delete on S3 buckets.

### Using AWS CLI
1. Run the s3api `put-bucket-versioning` command:

```bash
aws s3api put-bucket-versioning \
  --bucket my-bucket \
  --versioning-configuration Status=Enabled,MFADelete=Enabled \
  --mfa "arn:aws:iam::<account-id>:mfa/root-account-mfa-device <MFA-code>"
```

## Default Value
By default, S3 bucket versioning is disabled, and MFA Delete is not enabled. Both must be explicitly configured, and MFA Delete can only be enabled using the root account via CLI or API.

## References
1. https://docs.aws.amazon.com/AmazonS3/latest/dev/Versioning.html#MultiFactorAuthenticationDelete
2. https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingMFADelete.html
3. https://aws.amazon.com/blogs/security/securing-access-to-aws-using-mfa-part-3/
4. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa_lost-or-broken.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v8 | 6.5 Require MFA for Administrative Access | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1078.004 | TA0040 | M1032 |

## Profile
Level 2 | Manual
