param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

if (-not $env:WINDOWS_SIGN_CERT) {
    Write-Host "Skipping Windows code signing (WINDOWS_SIGN_CERT not set)"
    exit 0
}

# WINDOWS_SIGN_CERT is either a path to a .pfx on disk (local signing) or a
# base64-encoded .pfx (CI, where the cert is a GitHub secret). Resolve to a file.
$certPath = $env:WINDOWS_SIGN_CERT
$temp = $null
if (-not (Test-Path -LiteralPath $certPath)) {
    $temp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "cyberstrike-sign-$([guid]::NewGuid()).pfx")
    [System.IO.File]::WriteAllBytes($temp, [System.Convert]::FromBase64String($certPath))
    $certPath = $temp
}

try {
    Write-Host "Signing: $FilePath"
    & signtool sign /f $certPath /p $env:WINDOWS_SIGN_PASSWORD /tr http://timestamp.digicert.com /td sha256 /fd sha256 $FilePath
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Code signing failed for $FilePath"
        exit 1
    }
    Write-Host "Signed: $FilePath"
}
finally {
    if ($temp -and (Test-Path -LiteralPath $temp)) { Remove-Item -LiteralPath $temp -Force }
}
