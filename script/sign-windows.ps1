param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

if (-not $env:WINDOWS_SIGN_CERT) {
    Write-Host "Skipping Windows code signing (WINDOWS_SIGN_CERT not set)"
    exit 0
}

Write-Host "Signing: $FilePath"
& signtool sign /f $env:WINDOWS_SIGN_CERT /p $env:WINDOWS_SIGN_PASSWORD /tr http://timestamp.digicert.com /td sha256 /fd sha256 $FilePath
if ($LASTEXITCODE -ne 0) {
    Write-Error "Code signing failed for $FilePath"
    exit 1
}
Write-Host "Signed: $FilePath"
