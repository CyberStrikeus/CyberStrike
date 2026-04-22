---
name: "T1553.004_install-root-certificate"
description: "Adversaries may install a root certificate on a compromised system to avoid warnings when connecting to adversary controlled web servers."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1553.004
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1553.004"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1553/004"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1553
  - T1553.001
  - T1553.002
  - T1553.003
  - T1553.005
  - T1553.006
prerequisites:
  - T1553
severity_boost:
  T1553: "Chain with T1553 for deeper attack path"
  T1553.001: "Chain with T1553.001 for deeper attack path"
  T1553.002: "Chain with T1553.002 for deeper attack path"
---

# T1553.004 Install Root Certificate

> **Sub-technique of:** T1553

## High-Level Description

Adversaries may install a root certificate on a compromised system to avoid warnings when connecting to adversary controlled web servers. Root certificates are used in public key cryptography to identify a root certificate authority (CA). When a root certificate is installed, the system or application will trust certificates in the root's chain of trust that have been signed by the root certificate. Certificates are commonly used for establishing secure TLS/SSL communications within a web browser. When a user attempts to browse a website that presents a certificate that is not trusted an error message will be displayed to warn the user of the security risk. Depending on the security settings, the browser may not allow the user to establish a connection to the website.

Installation of a root certificate on a compromised system would give an adversary a way to degrade the security of that system. Adversaries have used this technique to avoid security warnings prompting users when compromised systems connect over HTTPS to adversary controlled web servers that spoof legitimate websites in order to collect login credentials.

Atypical root certificates have also been pre-installed on systems by the manufacturer or in the software supply chain and were used in conjunction with malware/adware to provide Adversary-in-the-Middle capability for intercepting information transmitted over secure TLS/SSL communications.

Root certificates (and their associated chains) can also be cloned and reinstalled. Cloned certificate chains will carry many of the same metadata characteristics of the source and can be used to sign malicious code that may then bypass signature validation tools (ex: Sysinternals, antivirus, etc.) used to block execution and/or uncover artifacts of Persistence.

In macOS, the Ay MaMi malware uses <code>/usr/bin/security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /path/to/malicious/cert</code> to install a malicious certificate as a trusted root certificate into the system keychain.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Install Root Certificate technique is applicable to target environment
- [ ] Check Linux systems for indicators of Install Root Certificate
- [ ] Check macOS systems for indicators of Install Root Certificate
- [ ] Check Windows systems for indicators of Install Root Certificate
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Install root CA on CentOS/RHEL

Creates a root CA with openssl

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
openssl genrsa -out #{key_filename} 4096
openssl req -x509 -new -nodes -key #{key_filename} -sha256 -days 365 -subj "/C=US/ST=Denial/L=Springfield/O=Dis/CN=www.example.com" -out #{cert_filename}
cp #{cert_filename} /etc/pki/ca-trust/source/anchors/
update-ca-trust
```

### Atomic Test 2: Install root CA on FreeBSD

Creates a root CA with openssl

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
openssl genrsa -out #{key_filename} 4096
openssl req -x509 -new -nodes -key #{key_filename} -sha256 -days 365 -subj "/C=US/ST=Denial/L=Springfield/O=Dis/CN=www.example.com" -out #{cert_filename}
cp #{cert_filename} /usr/local/share/certs/
certctl rehash
```

### Atomic Test 3: Install root CA on Debian/Ubuntu

Creates a root CA with openssl

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
mv #{cert_filename} /usr/local/share/ca-certificates
sudo update-ca-certificates
```

**Dependencies:**
- Verify the certificate exists. It generates if not on disk.

### Atomic Test 4: Install root CA on macOS

Creates a root CA with openssl

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo security add-trusted-cert -d -r trustRoot -k "/Library/Keychains/System.keychain" "#{cert_filename}"
```

**Dependencies:**
- Verify the certificate exists. It generates if not on disk.

### Atomic Test 5: Install root CA on Windows

Creates a root CA with Powershell

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$cert = Import-Certificate -FilePath #{pfx_path} -CertStoreLocation Cert:\LocalMachine\My
Move-Item -Path $cert.PSPath -Destination "Cert:\LocalMachine\Root"
```

**Dependencies:**
- Verify the certificate exists. It generates if not on disk.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Install Root Certificate by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1553.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1054 Software Configuration
HTTP Public Key Pinning (HPKP) is one method to mitigate potential Adversary-in-the-Middle situations where and adversary uses a mis-issued or fraudulent certificate to intercept encrypted communications by enforcing use of an expected certificate.

### M1028 Operating System Configuration
Windows Group Policy can be used to manage root certificates and the <code>Flags</code> value of <code>HKLM\\SOFTWARE\\Policies\\Microsoft\\SystemCertificates\\Root\\ProtectedRoots</code> can be set to 1 to prevent non-administrator users from making further root installations into their own HKCU certificate store.


## Detection

### Detection Strategy for Subvert Trust Controls via Install Root Certificate.


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Install Root Certificate technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Operation Emmental](https://www.youtube.com/watch?v=gchKFumYHWc)
- [SpectorOps Code Signing Dec 2017](https://posts.specterops.io/code-signing-certificate-cloning-attacks-and-defenses-6f98657fc6ec)
- [Kaspersky Superfish](https://www.kaspersky.com/blog/lenovo-pc-with-adware-superfish-preinstalled/7712/)
- [objective-see ay mami 2018](https://objective-see.com/blog/blog_0x26.html)
- [Microsoft Sigcheck May 2017](https://docs.microsoft.com/sysinternals/downloads/sigcheck)
- [Tripwire AppUNBlocker](https://www.tripwire.com/state-of-security/off-topic/appunblocker-bypassing-applocker/)
- [Wikipedia Root Certificate](https://en.wikipedia.org/wiki/Root_certificate)
- [Atomic Red Team - T1553.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1553.004)
- [MITRE ATT&CK - T1553.004](https://attack.mitre.org/techniques/T1553/004)
