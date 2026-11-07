param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

# Windows code signing via Azure Trusted Signing (#103). Signing happens in Azure's
# cloud HSM — there is no local .pfx. signtool loads the Trusted Signing dlib, which
# authenticates with a service principal (AZURE_* env, via DefaultAzureCredential) and
# signs the file against the configured account + certificate profile.
#
# Graceful skip unless fully configured, so dev/CI never breaks without the secrets.

$required = @(
    $env:AZURE_TENANT_ID, $env:AZURE_CLIENT_ID, $env:AZURE_CLIENT_SECRET,
    $env:TRUSTED_SIGNING_ENDPOINT, $env:TRUSTED_SIGNING_ACCOUNT, $env:TRUSTED_SIGNING_PROFILE
)
if ($required | Where-Object { [string]::IsNullOrEmpty($_) }) {
    Write-Host "Skipping Windows code signing (Azure Trusted Signing not configured)"
    exit 0
}

# Locate the Trusted Signing dlib. TRUSTED_SIGNING_DLIB wins; otherwise search the dir
# the workflow restored the nuget package into (version-agnostic).
$dlib = $env:TRUSTED_SIGNING_DLIB
if ([string]::IsNullOrEmpty($dlib) -or -not (Test-Path -LiteralPath $dlib)) {
    $dir = if ($env:TRUSTED_SIGNING_DLIB_DIR) { $env:TRUSTED_SIGNING_DLIB_DIR } else { "$env:RUNNER_TEMP\trusted-signing" }
    $found = Get-ChildItem -Path $dir -Recurse -Filter "Azure.CodeSigning.Dlib.dll" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $found) { Write-Error "Trusted Signing dlib (Azure.CodeSigning.Dlib.dll) not found under $dir"; exit 1 }
    $dlib = $found.FullName
}

# Locate signtool.exe from the installed Windows SDK (prefer x64, newest version).
$signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
if (-not $signtool) {
    $signtool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter "signtool.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "\\x64\\" } | Sort-Object FullName -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $signtool) { Write-Error "signtool.exe not found"; exit 1 }

# Trusted Signing metadata consumed by the dlib.
$metaFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "trusted-signing-$([guid]::NewGuid()).json")
@{
    Endpoint               = $env:TRUSTED_SIGNING_ENDPOINT
    CodeSigningAccountName = $env:TRUSTED_SIGNING_ACCOUNT
    CertificateProfileName = $env:TRUSTED_SIGNING_PROFILE
} | ConvertTo-Json | Set-Content -LiteralPath $metaFile -Encoding ascii

try {
    Write-Host "Signing (Azure Trusted Signing): $FilePath"
    & $signtool sign /v /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 `
        /dlib $dlib /dmdf $metaFile $FilePath
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Code signing failed for $FilePath"
        exit 1
    }
    Write-Host "Signed: $FilePath"
}
finally {
    if (Test-Path -LiteralPath $metaFile) { Remove-Item -LiteralPath $metaFile -Force }
}
