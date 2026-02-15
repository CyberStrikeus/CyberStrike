---
name: ad-security
description: Active Directory security testing and attack techniques
tags: [ad, windows, kerberos, ldap, internal-network]
version: "1.0"
---

# Active Directory Security Testing

## Credential Access Techniques

| ID | Technique | Tool | Description |
|----|-----------|------|-------------|
| CA-01 | Kerberoasting | GetUserSPNs.py, Rubeus | Request TGS for service accounts |
| CA-02 | AS-REP Roasting | GetNPUsers.py, Rubeus | Attack accounts without preauth |
| CA-03 | DCSync | secretsdump.py, Mimikatz | Replicate DC credentials |
| CA-04 | LSASS Dump | Mimikatz, ProcDump | Extract credentials from memory |
| CA-05 | SAM/SYSTEM Dump | secretsdump.py | Extract local credentials |
| CA-06 | NTDS.dit Extraction | secretsdump.py | Offline DC credential dump |
| CA-07 | Cached Credentials | Mimikatz | Extract cached domain creds |
| CA-08 | DPAPI Secrets | Mimikatz, SharpDPAPI | Decrypt protected data |
| CA-09 | Credential Vault | Mimikatz | Windows credential manager |
| CA-10 | Browser Credentials | SharpChromium | Chrome/Edge saved passwords |
| CA-11 | LLMNR/NBT-NS Poisoning | Responder | Capture NTLMv2 hashes |
| CA-12 | NTLM Relay | ntlmrelayx.py | Relay captured authentication |
| CA-13 | Password Spraying | Spray, Kerbrute | Test common passwords |
| CA-14 | GPP Passwords | Get-GPPPassword | Decrypt Group Policy preferences |

## Privilege Escalation Techniques

| ID | Technique | Tool | Description |
|----|-----------|------|-------------|
| PE-01 | ACL Abuse | BloodHound, PowerView | WriteDACL, GenericAll abuse |
| PE-02 | GPO Abuse | SharpGPOAbuse | Modify group policy |
| PE-03 | AD CS ESC1 | Certipy | Template allows user SAN |
| PE-04 | AD CS ESC2 | Certipy | Any purpose EKU |
| PE-05 | AD CS ESC3 | Certipy | Enrollment agent abuse |
| PE-06 | AD CS ESC4 | Certipy | Template ACL abuse |
| PE-07 | AD CS ESC5 | Certipy | PKI object access control |
| PE-08 | AD CS ESC6 | Certipy | EDITF_ATTRIBUTESUBJECTALTNAME2 |
| PE-09 | AD CS ESC7 | Certipy | CA ACL abuse |
| PE-10 | AD CS ESC8 | Certipy | NTLM relay to HTTP enrollment |
| PE-11 | Constrained Delegation | Rubeus, getST.py | S4U2Self/S4U2Proxy abuse |
| PE-12 | Resource-Based Constrained Delegation | Rubeus | msDS-AllowedToActOnBehalfOfOtherIdentity |

## Lateral Movement Techniques

| ID | Technique | Tool | Description |
|----|-----------|------|-------------|
| LM-01 | Pass-the-Hash | Mimikatz, pth-winexe | Authenticate with NTLM hash |
| LM-02 | Pass-the-Ticket | Rubeus, Mimikatz | Inject Kerberos tickets |
| LM-03 | Overpass-the-Hash | Rubeus | Request TGT with NTLM hash |
| LM-04 | PSExec | Impacket, Sysinternals | Remote execution via SMB |
| LM-05 | WMI Execution | wmiexec.py | Execute commands via WMI |
| LM-06 | DCOM Execution | dcomexec.py | Distributed COM abuse |
| LM-07 | WinRM | evil-winrm | PowerShell remoting |
| LM-08 | RDP Hijacking | tscon.exe | Take over disconnected sessions |
| LM-09 | SMB Relay | ntlmrelayx.py | Relay auth to other hosts |
| LM-10 | SSH (Linux) | ssh | Lateral to Linux systems |

## Persistence Techniques

| ID | Technique | Tool | Description |
|----|-----------|------|-------------|
| PS-01 | Golden Ticket | Mimikatz, ticketer.py | Forge TGT with KRBTGT hash |
| PS-02 | Silver Ticket | Mimikatz, ticketer.py | Forge TGS for specific service |
| PS-03 | Diamond Ticket | Rubeus | Modify legitimate TGT |
| PS-04 | Skeleton Key | Mimikatz | Master password on DC |
| PS-05 | AdminSDHolder | PowerView | Persistent admin rights |
| PS-06 | DCShadow | Mimikatz | Rogue domain controller |
| PS-07 | SID History | Mimikatz | Add privileged SID to history |
| PS-08 | Machine Account | Powermad | Add computer to domain |

## Enumeration Commands

### BloodHound Collection
```bash
# SharpHound (Windows)
SharpHound.exe -c All --zipfilename bloodhound.zip

# BloodHound.py (Linux)
bloodhound-python -d domain.local -u user -p pass -ns 10.0.0.1 -c all

# NetExec BloodHound
nxc ldap 10.0.0.1 -u user -p pass --bloodhound --collection All
```

### LDAP Enumeration
```bash
# Get domain info
ldapsearch -x -H ldap://10.0.0.1 -D "user@domain.local" -w 'pass' -b "DC=domain,DC=local"

# Find users with SPN (Kerberoastable)
ldapsearch -x -H ldap://10.0.0.1 -D "user@domain.local" -w 'pass' \
  -b "DC=domain,DC=local" "(&(objectClass=user)(servicePrincipalName=*))" sAMAccountName

# Find users without preauth (AS-REP Roastable)
ldapsearch -x -H ldap://10.0.0.1 -D "user@domain.local" -w 'pass' \
  -b "DC=domain,DC=local" "(&(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=4194304))"
```

### NetExec Commands
```bash
# Enumerate users
nxc smb 10.0.0.1 -u user -p pass --users

# Enumerate groups
nxc smb 10.0.0.1 -u user -p pass --groups

# Find shares
nxc smb 10.0.0.1 -u user -p pass --shares

# Check for admin access
nxc smb 10.0.0.0/24 -u user -p pass

# Password spray
nxc smb 10.0.0.1 -u users.txt -p 'Spring2024!' --no-bruteforce
```

## Attack Paths

### Path 1: Domain User to Domain Admin
```
User Credential
    │
    ├─► Kerberoast SPN accounts
    │   └─► Crack service account password
    │       └─► Service account is Domain Admin
    │
    ├─► BloodHound Path Finding
    │   └─► ACL chain to DA group
    │       └─► WriteDACL → GenericAll → Add to DA
    │
    └─► AD CS Misconfiguration
        └─► ESC1: Request cert as DA
            └─► Authenticate as DA
```

### Path 2: Compromised Workstation to DC
```
Local Admin on Workstation
    │
    ├─► LSASS dump → cached domain creds
    │   └─► Domain user credential
    │       └─► Continue as Path 1
    │
    ├─► Find admin sessions
    │   └─► Lateral move to server
    │       └─► Dump DA credentials
    │
    └─► Unconstrained Delegation
        └─► Coerce DC authentication
            └─► Capture TGT → DCSync
```

## Important Impacket Tools

| Tool | Purpose |
|------|---------|
| GetUserSPNs.py | Kerberoasting |
| GetNPUsers.py | AS-REP Roasting |
| secretsdump.py | Dump secrets (DCSync, SAM, LSA) |
| smbexec.py | SMB-based execution |
| wmiexec.py | WMI-based execution |
| psexec.py | PSExec-style execution |
| ntlmrelayx.py | NTLM relay attacks |
| getST.py | Request service tickets |
| ticketer.py | Create Golden/Silver tickets |
| lookupsid.py | SID enumeration |
| samrdump.py | SAM Remote interface dump |

## Detection Evasion Considerations

| Action | Detection | Evasion |
|--------|-----------|---------|
| Kerberoasting | 4769 events (RC4) | Use AES encryption |
| DCSync | 4662 events | Time-based, limit frequency |
| Pass-the-Hash | 4624 Type 3 with NTLM | Overpass-the-Hash (Kerberos) |
| BloodHound | LDAP queries | Reduce collection scope |
| Mimikatz | AV signatures | BOF, custom tools |
