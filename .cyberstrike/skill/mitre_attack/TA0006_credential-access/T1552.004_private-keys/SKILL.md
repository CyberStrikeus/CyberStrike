---
name: "T1552.004_private-keys"
description: "Adversaries may search for private key certificate files on compromised systems for insecurely stored credentials."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1552.004
  - credential-access
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1552.004"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1552/004"
tech_stack:
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1552
  - T1552.001
  - T1552.002
  - T1552.003
  - T1552.005
  - T1552.006
  - T1552.007
  - T1552.008
prerequisites:
  - T1552
severity_boost:
  T1552: "Chain with T1552 for deeper attack path"
  T1552.001: "Chain with T1552.001 for deeper attack path"
  T1552.002: "Chain with T1552.002 for deeper attack path"
---

# T1552.004 Private Keys

> **Sub-technique of:** T1552

## High-Level Description

Adversaries may search for private key certificate files on compromised systems for insecurely stored credentials. Private cryptographic keys and certificates are used for authentication, encryption/decryption, and digital signatures. Common key and certificate file extensions include: .key, .pgp, .gpg, .ppk., .p12, .pem, .pfx, .cer, .p7b, .asc.

Adversaries may also look in common key directories, such as <code>~/.ssh</code> for SSH keys on \* nix-based systems or <code>C:&#92;Users&#92;(username)&#92;.ssh&#92;</code> on Windows. Adversary tools may also search compromised systems for file extensions relating to cryptographic keys and certificates.

When a device is registered to Entra ID, a device key and a transport key are generated and used to verify the device’s identity. An adversary with access to the device may be able to export the keys in order to impersonate the device.

On network devices, private keys may be exported via Network Device CLI commands such as `crypto pki export`.

Some private keys require a password or passphrase for operation, so an adversary may also use Input Capture for keylogging or attempt to Brute Force the passphrase off-line. These private keys can be used to authenticate to Remote Services like SSH or for use in decrypting other collected files such as email.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Private Keys technique is applicable to target environment
- [ ] Check Linux systems for indicators of Private Keys
- [ ] Check macOS systems for indicators of Private Keys
- [ ] Check Network Devices systems for indicators of Private Keys
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Private Keys

Find private keys on the Windows file system.
File extensions include: .key, .pgp, .gpg, .ppk., .p12, .pem, pfx, .cer, .p7b, .asc

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
dir c:\ /b /s .key | findstr /e .key
```

### Atomic Test 2: Discover Private SSH Keys

Discover private SSH keys on a FreeBSD, macOS or Linux system.

**Supported Platforms:** linux, macos

```bash
find #{search_path} -name id_rsa 2>/dev/null >> #{output_file}
exit 0
```

### Atomic Test 3: Copy Private SSH Keys with CP

Copy private SSH keys on a Linux system to a staging folder using the `cp` command.

**Supported Platforms:** linux

```bash
mkdir #{output_folder}
find #{search_path} -name id_rsa 2>/dev/null -exec cp --parents {} #{output_folder} \;
exit 0
```

### Atomic Test 4: Copy Private SSH Keys with CP (freebsd)

Copy private SSH keys on a FreeBSD system to a staging folder using the `cp` command.

**Supported Platforms:** linux

```bash
mkdir #{output_folder}
find #{search_path} -name id_rsa 2>/dev/null -exec gcp --parents {} #{output_folder} \;
```

**Dependencies:**

- Install GNU cp from coreutils package.

### Atomic Test 5: Copy Private SSH Keys with rsync

Copy private SSH keys on a Linux or macOS system to a staging folder using the `rsync` command.

**Supported Platforms:** macos, linux

```bash
mkdir #{output_folder}
find #{search_path} -name id_rsa 2>/dev/null -exec rsync -R {} #{output_folder} \;
exit 0
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Private Keys by examining the target platforms (Linux, macOS, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1552.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies

Use strong passphrases for private keys to make cracking difficult.

### M1022 Restrict File and Directory Permissions

Ensure permissions are properly set on folders containing sensitive private keys to prevent unintended access. Additionally, on Cisco devices, set the `nonexportable` flag during RSA key pair generation.

### M1047 Audit

Ensure only authorized keys are allowed access to critical resources and audit access lists regularly.

### M1041 Encrypt Sensitive Information

When possible, store keys on separate cryptographic hardware instead of on the local system. For example, on Windows systems use a TPM to secure keys and other sensitive credential material.

## Detection

### Detect Suspicious Access to Private Key Files and Export Attempts Across Platforms

## Risk Assessment

| Finding                           | Severity | Impact            |
| --------------------------------- | -------- | ----------------- |
| Private Keys technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Palo Alto Prince of Persia](https://researchcenter.paloaltonetworks.com/2016/06/unit42-prince-of-persia-game-over/)
- [cisco_deploy_rsa_keys](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/sec_conn_pki/configuration/xe-17/sec-pki-xe-17-book/sec-deploy-rsa-pki.html#GUID-1CB802D8-9DE3-447F-BECE-CF22F5E11436)
- [AADInternals Azure AD Device Identities](https://aadinternals.com/post/deviceidentity/)
- [Kaspersky Careto](https://web.archive.org/web/20141031134104/http://kasperskycontenthub.com/wp-content/uploads/sites/43/vlpdfs/unveilingthemask_v1.0.pdf)
- [Microsoft Primary Refresh Token](https://learn.microsoft.com/en-us/azure/active-directory/devices/concept-primary-refresh-token)
- [Wikipedia Public Key Crypto](https://en.wikipedia.org/wiki/Public-key_cryptography)
- [Atomic Red Team - T1552.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1552.004)
- [MITRE ATT&CK - T1552.004](https://attack.mitre.org/techniques/T1552/004)
