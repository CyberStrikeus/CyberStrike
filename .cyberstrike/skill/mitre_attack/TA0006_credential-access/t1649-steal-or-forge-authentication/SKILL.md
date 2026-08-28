---
name: "T1649_steal-or-forge-authentication-certificates"
description: "Adversaries may steal or forge certificates used for authentication to access remote systems or resources."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1649
  - credential-access
  - windows
  - linux
  - macos
  - identity-provider
technique_id: "T1649"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
  - Linux
  - macOS
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1649"
tech_stack:
  - windows
  - linux
  - macos
  - identity
cwe_ids:
  - CWE-522
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1649 Steal or Forge Authentication Certificates

## High-Level Description

Adversaries may steal or forge certificates used for authentication to access remote systems or resources. Digital certificates are often used to sign and encrypt messages and/or files. Certificates are also used as authentication material. For example, Entra ID device certificates and Active Directory Certificate Services (AD CS) certificates bind to an identity and can be used as credentials for domain accounts.

Authentication certificates can be both stolen and forged. For example, AD CS certificates can be stolen from encrypted storage (in the Registry or files), misplaced certificate files (i.e. Unsecured Credentials), or directly from the Windows certificate store via various crypto APIs. With appropriate enrollment rights, users and/or machines within a domain can also request and/or manually renew certificates from enterprise certificate authorities (CA). This enrollment process defines various settings and permissions associated with the certificate. Of note, the certificate’s extended key usage (EKU) values define signing, encryption, and authentication use cases, while the certificate’s subject alternative name (SAN) values define the certificate owner’s alternate names.

Abusing certificates for authentication credentials may enable other behaviors such as Lateral Movement. Certificate-related misconfigurations may also enable opportunities for Privilege Escalation, by way of allowing users to impersonate or assume privileged accounts or permissions via the identities (SANs) associated with a certificate. These abuses may also enable Persistence via stealing or forging certificates that can be used as Valid Accounts for the duration of the certificate's validity, despite user password resets. Authentication certificates can also be stolen and forged for machine accounts.

Adversaries who have access to root (or subordinate) CA certificate private keys (or mechanisms protecting/managing these keys) may also establish Persistence by forging arbitrary authentication certificates for the victim domain (known as “golden” certificates). Adversaries may also target certificates and related services in order to access other forms of credentials, such as Golden Ticket ticket-granting tickets (TGT) or NTLM plaintext.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows, Linux, macOS, Identity Provider

## What to Check

- [ ] Identify if Steal or Forge Authentication Certificates technique is applicable to target environment
- [ ] Check Windows systems for indicators of Steal or Forge Authentication Certificates
- [ ] Check Linux systems for indicators of Steal or Forge Authentication Certificates
- [ ] Check macOS systems for indicators of Steal or Forge Authentication Certificates
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Staging Local Certificates via Export-Certificate

Export all user certificates and add to a compressed archive.

**Supported Platforms:** windows

```powershell
$archive="$env:PUBLIC\T1649\atomic_certs.zip"
$exfilpath="$env:PUBLIC\T1649\certs"
Add-Type -assembly "system.io.compression.filesystem"
Remove-Item $(split-path $exfilpath) -Recurse -Force -ErrorAction Ignore
mkdir $exfilpath | Out-Null
foreach ($cert in (gci Cert:\CurrentUser\My)) { Export-Certificate -Cert $cert -FilePath $exfilpath\$($cert.FriendlyName).cer}
[io.compression.zipfile]::CreateFromDirectory($exfilpath, $archive)
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Steal or Forge Authentication Certificates by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1649 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1015 Active Directory Configuration

Ensure certificate authorities (CA) are properly secured, including treating CA servers (and other resources hosting CA certificates) as tier 0 assets. Harden abusable CA settings and attributes.

For example, consider disabling the usage of AD CS certificate SANs within relevant authentication protocol settings to enforce strict user mappings and prevent certificates from authenticating as other identifies. Also consider enforcing CA Certificate Manager approval for the templates that include SAN as an issuance requirement.

### M1042 Disable or Remove Feature or Program

Consider disabling old/dangerous authentication protocols (e.g. NTLM), as well as unnecessary certificate features, such as potentially vulnerable AD CS web and other enrollment server roles.

### M1041 Encrypt Sensitive Information

Ensure certificates as well as associated private keys are appropriately secured. Consider utilizing additional hardware credential protections such as trusted platform modules (TPM) or hardware security modules (HSM). Enforce HTTPS and enable Extended Protection for
Authentication.

### M1047 Audit

Check and remediate unneeded existing authentication certificates as well as common abusable misconfigurations of CA settings and permissions, such as AD CS certificate enrollment permissions and published overly permissive certificate templates (which define available settings for created certificates). For example, available AD CS certificate templates can be checked via the Certificate Authority MMC snap-in (`certsrv.msc`). `certutil.exe` can also be used to examine various information within an AD CS CA database.

## Detection

### Detection Strategy for Steal or Forge Authentication Certificates

## Risk Assessment

| Finding                                                         | Severity | Impact            |
| --------------------------------------------------------------- | -------- | ----------------- |
| Steal or Forge Authentication Certificates technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [GitHub GhostPack Certificates](https://github.com/GhostPack/SharpDPAPI#certificates)
- [Microsoft AD CS Overview](<https://docs.microsoft.com/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/hh831740(v=ws.11)>)
- [Medium Certified Pre Owned](https://posts.specterops.io/certified-pre-owned-d95910965cd2)
- [SpecterOps Certified Pre Owned](https://web.archive.org/web/20220818094600/https://specterops.io/assets/resources/Certified_Pre-Owned.pdf)
- [O365 Blog Azure AD Device IDs](https://o365blog.com/post/deviceidentity/)
- [GitHub CertStealer](https://github.com/TheWover/CertStealer)
- [APT29 Deep Look at Credential Roaming](https://www.mandiant.com/resources/blog/apt29-windows-credential-roaming)
- [Atomic Red Team - T1649](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1649)
- [MITRE ATT&CK - T1649](https://attack.mitre.org/techniques/T1649)
