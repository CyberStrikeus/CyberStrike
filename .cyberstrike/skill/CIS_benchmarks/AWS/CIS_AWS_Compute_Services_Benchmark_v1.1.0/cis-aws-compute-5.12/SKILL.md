---
name: cis-aws-compute-5.12
description: "Change the auto-generated password for Windows based instances"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lightsail, windows, passwords, rdp, authentication, credentials]
cis_id: "5.12"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-5.2, cis-aws-compute-5.5, cis-aws-compute-5.11]
prerequisites: []
severity_boost: {}
---

# 5.12 Change the auto-generated password for Windows based instances (Manual)

## Description

When you create a Windows Server-based instance, Lightsail randomly generates a long password that is hard to guess. You use this password uniquely with your new instance. You can use the default password to connect quickly to your instance using remote desktop (RDP). You are always logged in as the Administrator on your Lightsail instance.

## Rationale

Like any password it should be changed from the default and over time. The randomly generated password can be hard to remember and if anyone gains access to your AWS Lightsail environment they can utilize that to access your instances. For this reason you should change the password to something you can remember.

## Impact

If you change your password from the unique, default password, be sure to use a strong password. You should avoid passwords that are based on names or dictionary words, or repeating sequences of characters.

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Windows Instance` you want to review.
5. Make sure the instance status is `running`.
6. Connect to the `instance` using `Connect using RDP`.
7. Log in using the credentials provided within the Lightsail console set for this instance.
8. If you are successful and based on your password change policy it is required that you change/update the password refer to the remediation below.

### Using AWS CLI

N/A - This is a manual process requiring RDP connection to the Windows instance.

## Expected Result

The auto-generated default password should be changed to a strong custom password that complies with the organization's password policy.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Windows Instance` you want to review.
5. Make sure the instance status is `running`.
6. Connect to the `instance` using `Connect using RDP`.
7. Log in using the credentials provided within the Lightsail console set for this instance.
8. Use the Windows Server password manager to change your password securely by press `Ctrl + Alt + Del`
9. Then choose `Change a password`.
   ** Be sure to keep a record of your password, because Lightsail doesn't store the new password you are setting.
10. Type in the `New Password`
11. Click `Save`

### Using AWS CLI

N/A - This is a manual process requiring RDP connection to the Windows instance.

## Additional Information

You can use either the Lightsail-generated password or your own custom password with the browser-based RDP client in Lightsail. If you use a custom password, you will be prompted for your password every time you log in. It can be easier but not necessarily more secure to use the Lightsail-generated default password with the browser-based RDP client if you want quick access to your instance.

## Default Value

Lightsail randomly generates a long, unique password for each Windows Server-based instance at creation time.

## References

N/A

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v7 | 4.2 Change Default Passwords - Before deploying any new asset, change all default passwords to have values consistent with administrative level accounts. | x | x | x |

## Profile

Level 1 | Manual
