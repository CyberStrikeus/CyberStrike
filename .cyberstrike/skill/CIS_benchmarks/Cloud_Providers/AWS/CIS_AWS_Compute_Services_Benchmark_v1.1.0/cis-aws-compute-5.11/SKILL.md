---
name: cis-aws-compute-5.11
description: "Ensure your Windows Server based lightsail instances are updated with the latest security patches"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lightsail, windows, patching, security-updates, windows-update]
cis_id: "5.11"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-5.1, cis-aws-compute-5.12]
prerequisites: []
severity_boost: {}
---

# 5.11 Ensure your Windows Server based lightsail instances are updated with the latest security patches (Manual)

## Description

Windows server based Lightsail instances are still managed by the consumer and any security updates or patches have to be installed and maintained by the user.

## Rationale

Windows Server-based Lightsail instances need to be updated with the latest security patches so they are not vulnerable to attacks. Be sure your server is configured to download and install updates.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Windows Instance` you want to review.
5. Make sure the instance status is `running`.
6. Connect to the `instance` using `Connect using RDP`.
7. Log in using the credentials you have set for this instance.
8. Open a command prompt
9. Type sconfig, and then press Enter.

```
Windows Update Settings are at number 5 and by default are set to Automatic.
```

If this is the current setting continue with step 10. If this is not the current setting refer to the remediation below and start at step 10.

10. To determine if any updates are required, type 6, and then press Enter.
11. Type A to search for (A)ll updates in the new command window, and then press Enter.

If any updates are required refer to the remediation below and start at step 14.

### Using AWS CLI

N/A - This is a manual process requiring RDP connection to the Windows instance.

## Expected Result

Windows Update Settings should be set to Automatic (number 5 in sconfig), and all available security patches should be installed.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Windows Instance` you want to review.
5. Make sure the instance status is `running`.
6. Connect to the `instance` using `Connect using RDP`.
7. Log in using the credentials you have set for this instance.
8. Open a command prompt
9. Type sconfig, and then press Enter.

```
Windows Update Settings are at number 5 and by default are set to Automatic.
```

If this is not the current setting continue with step 10. If this is the current setting skip to step 12

10. Type 5, and then press Enter.
11. Type A for `Automatic` and then press Enter. Wait until the setting is saved and you return back to the server configuration menu.
12. Type 6, and then press Enter.
13. Type A to search for (A)ll updates in the new command window, and then press Enter.
14. Type A again to install (A)ll updates, and then press Enter.

When finished, you see a message with the installation results and more instructions (if those apply).

### Using AWS CLI

N/A - This is a manual process requiring RDP connection to the Windows instance.

## Default Value

Windows Update Settings are at number 5 and by default are set to Automatic.

## References

N/A

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 7.4 Perform Automated Application Patch Management - Perform application updates on enterprise assets through automated patch management on a monthly, or more frequent, basis.                                                        | x    | x    | x    |
| v7               | 3.5 Deploy Automated Software Patch Management Tools - Deploy automated software update tools in order to ensure that third-party software on all systems is running the most recent security updates provided by the software vendor. | x    | x    | x    |

## Profile

Level 1 | Manual
