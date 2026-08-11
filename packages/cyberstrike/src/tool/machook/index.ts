import z from "zod"
import { Tool } from "../tool"
import type { Finding, HookResult } from "./shared"

import { systemInfo, processEnum, networkEnum, userEnum, installedApps, securityFramework, launchdEnum } from "./recon"
import {
  keychainDump,
  chromeCreds,
  sshKeys,
  safariCreds,
  cloudCreds,
  gpgKeys,
  icloudTokens,
  mailCreds,
} from "./credential"
import { tccBypass, dylibHijack, launchdPlistAbuse, sudoMisconfig, authorizationDb, pkgAbuse } from "./privesc"
import {
  launchagentPersist,
  launchdaemonPersist,
  loginItems,
  cronPersist,
  bashrcPersist,
  periodicScripts,
} from "./persistence"
import { xprotectCheck, gatekeeperBypass, logClear, historyClear, timestomp, endpointSecurityBypass } from "./evasion"
import { keylogMac, dtraceExec, dtraceNet, dtraceFile, clipboardMonitor, screenCapture } from "./monitoring"
import { sshPivot, airdropAbuse, bonjourEnum, appleRemoteDesktop } from "./lateral"
import { dataStage, artifactEnum, cleanupMac } from "./exfil"

const PROGRAMS = {
  // ── Recon (7) ──
  system_info: {
    description: "Enumerate macOS system info — sw_vers, kernel, CPU, memory, disk, hardware model",
    args: "",
  },
  process_enum: {
    description: "List running processes with user context, root processes, listening ports, established connections",
    args: "",
  },
  network_enum: {
    description: "Network interfaces, routing, ARP, DNS, Wi-Fi info, hardware ports",
    args: "",
  },
  user_enum: {
    description: "Local users, groups, admin group membership, last logins, sudo access",
    args: "",
  },
  installed_apps: {
    description: "Installed applications, Homebrew packages, pip/npm packages — with cve-mcp version check CTA",
    args: "",
  },
  security_framework: {
    description: "SIP, Gatekeeper, FileVault, Firewall, XProtect/MRT, Endpoint Security extensions, MDM profiles",
    args: "",
  },
  launchd_enum: {
    description: "LaunchAgents/LaunchDaemons enumeration, third-party plist detection",
    args: "",
  },

  // ── Credential (8) ──
  keychain_dump: {
    description:
      "Extract passwords from macOS Keychain — login, system, application keychains including WiFi credentials",
    args: "[--keychain PATH]",
  },
  chrome_creds: {
    description: "Extract Chrome/Safari saved passwords, cookies, and autofill data from local browser storage",
    args: "[--browser chrome|safari|all]",
  },
  ssh_keys: {
    description: "Find SSH private keys, known_hosts, authorized_keys, and SSH agent identities for all users",
    args: "[--user USER]",
  },
  safari_creds: {
    description: "Safari history, bookmarks, downloads, extensions, LocalStorage, form autofill data",
    args: "",
  },
  cloud_creds: {
    description: "Harvest cloud credentials — AWS, GCP, Azure, Docker registry tokens, Kubernetes configs",
    args: "",
  },
  gpg_keys: {
    description: "GPG private keys, keyrings, gpg-agent status",
    args: "",
  },
  icloud_tokens: {
    description: "iCloud account tokens, Accounts.sqlite, Keychain database, MobileMeAccounts",
    args: "",
  },
  mail_creds: {
    description: "Mail account credentials and tokens from Mail.app and Accounts framework",
    args: "",
  },

  // ── Privesc (6) ──
  tcc_bypass: {
    description: "Bypass TCC framework — access camera, microphone, files, screen recording",
    args: "[--method direct|inject|reset]",
  },
  dylib_hijack: {
    description: "Find SUID/SGID binaries with weak dylib loading paths, check DYLD_INSERT_LIBRARIES availability",
    args: "",
  },
  launchd_plist_abuse: {
    description: "Find writable LaunchAgent/LaunchDaemon plists and writable binary paths for privilege escalation",
    args: "",
  },
  sudo_misconfig: {
    description: "Sudoers analysis — NOPASSWD, env_keep DYLD, wildcard abuse, sudo version CVE check",
    args: "",
  },
  authorization_db: {
    description: "macOS Authorization Database rights analysis for privilege escalation vectors",
    args: "",
  },
  pkg_abuse: {
    description: "Find trojaned .pkg files, writable installer scripts, package receipt analysis",
    args: "",
  },

  // ── Persistence (6) ──
  launchagent_persist: {
    description: "Create user-level LaunchAgent plist for persistence (survives reboot)",
    args: "--label NAME --command CMD [--interval SECONDS]",
  },
  launchdaemon_persist: {
    description: "Create root-level LaunchDaemon plist for persistence (requires root)",
    args: "--label NAME --command CMD [--interval SECONDS]",
  },
  login_items: {
    description: "Add login item via System Events — runs on user login",
    args: "--path APP_PATH [--hidden]",
  },
  cron_persist: {
    description: "Add crontab entry for scheduled persistence",
    args: "--command CMD [--schedule CRON_EXPR]",
  },
  bashrc_persist: {
    description: "Inject command into shell RC files (.zshrc, .bashrc, .bash_profile)",
    args: "--command CMD [--file .zshrc|.bashrc|.bash_profile|.zprofile]",
  },
  periodic_scripts: {
    description: "Create periodic script for daily/weekly/monthly persistence (requires root)",
    args: "--command CMD [--frequency daily|weekly|monthly]",
  },

  // ── Evasion (6) ──
  xprotect_check: {
    description:
      "Enumerate XProtect/MRT signatures, Gatekeeper/SIP/FileVault/Firewall status, installed apps for evasion planning",
    args: "",
  },
  gatekeeper_bypass: {
    description: "Remove com.apple.quarantine xattr to bypass Gatekeeper code signing checks",
    args: "--path PATH [--recursive]",
  },
  log_clear: {
    description: "Clear unified logging, audit logs, crash reports, and shell history",
    args: "",
  },
  history_clear: {
    description: "Targeted history clearing — shell, Python, Node, vim, recent items, Spotlight, clipboard",
    args: "[--clipboard]",
  },
  timestomp: {
    description: "Modify file timestamps (atime/mtime) to blend with surrounding files",
    args: "--path PATH [--reference REF_FILE] [--date DATETIME]",
  },
  endpoint_security_bypass: {
    description: "Enumerate Endpoint Security extensions, detect EDR products, check SIP/MDM for bypass vectors",
    args: "",
  },

  // ── Monitoring (6) ──
  keylog_mac: {
    description: "Capture keystrokes via osascript listener or ioreg HID monitor with application context",
    args: "[--duration SECONDS]",
  },
  dtrace_exec: {
    description: "Monitor process executions via DTrace probes (requires SIP disabled, ps-based fallback)",
    args: "[--duration SECONDS]",
  },
  dtrace_net: {
    description: "Monitor network connections via DTrace ip probes (requires SIP disabled, lsof fallback)",
    args: "[--duration SECONDS]",
  },
  dtrace_file: {
    description: "Monitor file access via DTrace open probes (requires SIP disabled, fs_usage fallback)",
    args: "[--duration SECONDS] [--pid PID]",
  },
  clipboard_monitor: {
    description: "Monitor clipboard changes over time — capture copied passwords, tokens, sensitive data",
    args: "[--duration SECONDS]",
  },
  screen_capture: {
    description: "Capture screenshot silently via screencapture command",
    args: "[--output PATH] [--delay SECONDS] [--window]",
  },

  // ── Lateral (4) ──
  ssh_pivot: {
    description: "SSH-based lateral movement — enumerate targets, execute commands, create tunnels",
    args: "--target HOST [--user USER] [--key PATH] [--command CMD] [--tunnel LOCAL:REMOTE]",
  },
  airdrop_abuse: {
    description: "AirDrop discoverability recon and nearby device scanning",
    args: "",
  },
  bonjour_enum: {
    description: "Bonjour/mDNS service discovery — SSH, HTTP, SMB, AFP, VNC, printers on local network",
    args: "",
  },
  apple_remote_desktop: {
    description: "Check Apple Remote Desktop/Screen Sharing status and access groups for lateral movement",
    args: "",
  },

  // ── Exfil & Cleanup (3) ──
  data_stage: {
    description: "Find and stage sensitive files (documents, keys, configs) for exfiltration",
    args: "[--type all|documents|keys|configs] [--output PATH]",
  },
  artifact_enum: {
    description: "Pre-cleanup audit — find all CyberStrike artifacts before cleanup",
    args: "",
  },
  cleanup_mac: {
    description:
      "Remove CyberStrike artifacts — LaunchAgents, processes, temp files, DTrace scripts, history. ALWAYS run before leaving",
    args: "",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS

const CWE_MAP: Record<string, string> = {
  "MAC-SYSINFO-001": "CWE-200",
  "MAC-PROCS-001": "CWE-200",
  "MAC-PROCS-002": "CWE-200",
  "MAC-NETWORK-001": "CWE-200",
  "MAC-USERS-001": "CWE-200",
  "MAC-USERS-002": "CWE-269",
  "MAC-APPS-001": "CWE-200",
  "MAC-SEC-001": "CWE-693",
  "MAC-SEC-002": "CWE-693",
  "MAC-SEC-003": "CWE-693",
  "MAC-LAUNCHD-001": "CWE-200",
  "MAC-LAUNCHD-002": "CWE-269",
  "MAC-KC": "CWE-522",
  "MAC-KC-WIFI": "CWE-522",
  "MAC-CHROME": "CWE-522",
  "MAC-SSH": "CWE-522",
  "MAC-SAFARI-001": "CWE-200",
  "MAC-CLOUD": "CWE-522",
  "MAC-GPG-001": "CWE-522",
  "MAC-ICLOUD-001": "CWE-522",
  "MAC-MAIL-001": "CWE-522",
  "MAC-TCC": "CWE-269",
  "MAC-DYLIB-001": "CWE-426",
  "MAC-DYLIB-002": "CWE-426",
  "MAC-LAUNCHD-PRIV-001": "CWE-732",
  "MAC-LAUNCHD-PRIV-002": "CWE-732",
  "MAC-SUDO-001": "CWE-269",
  "MAC-SUDO-002": "CWE-269",
  "MAC-SUDO-003": "CWE-269",
  "MAC-AUTHDB-001": "CWE-269",
  "MAC-PKG-001": "CWE-426",
  "MAC-PKG-002": "CWE-426",
  "MAC-PERSIST-001": "CWE-547",
  "MAC-PERSIST-002": "CWE-547",
  "MAC-PERSIST-003": "CWE-547",
  "MAC-PERSIST-004": "CWE-547",
  "MAC-PERSIST-005": "CWE-547",
  "MAC-PERSIST-006": "CWE-547",
  "MAC-XPROTECT-001": "CWE-693",
  "MAC-RECON-001": "CWE-200",
  "MAC-GK-001": "CWE-693",
  "MAC-LOG-001": "CWE-1254",
  "MAC-LOG-002": "CWE-1254",
  "MAC-HIST-001": "CWE-1254",
  "MAC-TIMESTOMP-001": "CWE-1254",
  "MAC-ES-001": "CWE-693",
  "MAC-ES-002": "CWE-693",
  "MAC-KEYLOG-001": "CWE-522",
  "MAC-DTRACE-EXEC-001": "CWE-200",
  "MAC-DTRACE-NET-001": "CWE-200",
  "MAC-DTRACE-FILE-001": "CWE-200",
  "MAC-CLIP-001": "CWE-200",
  "MAC-SCREEN-001": "CWE-200",
  "MAC-SSH-PIVOT-001": "CWE-78",
  "MAC-SSH-PIVOT-002": "CWE-78",
  "MAC-SSH-PIVOT-003": "CWE-78",
  "MAC-AIRDROP-001": "CWE-200",
  "MAC-BONJOUR-001": "CWE-200",
  "MAC-ARD-001": "CWE-269",
  "MAC-ARD-002": "CWE-269",
  "MAC-STAGE-001": "CWE-200",
  "MAC-ARTIFACT-001": "CWE-200",
  "MAC-CLEANUP-001": "CWE-1254",
}

const dispatch: Record<Program, (args: string[], timeout: number) => Promise<HookResult>> = {
  // Recon
  system_info: systemInfo,
  process_enum: processEnum,
  network_enum: networkEnum,
  user_enum: userEnum,
  installed_apps: installedApps,
  security_framework: securityFramework,
  launchd_enum: launchdEnum,
  // Credential
  keychain_dump: keychainDump,
  chrome_creds: chromeCreds,
  ssh_keys: sshKeys,
  safari_creds: safariCreds,
  cloud_creds: cloudCreds,
  gpg_keys: gpgKeys,
  icloud_tokens: icloudTokens,
  mail_creds: mailCreds,
  // Privesc
  tcc_bypass: tccBypass,
  dylib_hijack: dylibHijack,
  launchd_plist_abuse: launchdPlistAbuse,
  sudo_misconfig: sudoMisconfig,
  authorization_db: authorizationDb,
  pkg_abuse: pkgAbuse,
  // Persistence
  launchagent_persist: launchagentPersist,
  launchdaemon_persist: launchdaemonPersist,
  login_items: loginItems,
  cron_persist: cronPersist,
  bashrc_persist: bashrcPersist,
  periodic_scripts: periodicScripts,
  // Evasion
  xprotect_check: xprotectCheck,
  gatekeeper_bypass: gatekeeperBypass,
  log_clear: logClear,
  history_clear: historyClear,
  timestomp: timestomp,
  endpoint_security_bypass: endpointSecurityBypass,
  // Monitoring
  keylog_mac: keylogMac,
  dtrace_exec: dtraceExec,
  dtrace_net: dtraceNet,
  dtrace_file: dtraceFile,
  clipboard_monitor: clipboardMonitor,
  screen_capture: screenCapture,
  // Lateral
  ssh_pivot: sshPivot,
  airdrop_abuse: airdropAbuse,
  bonjour_enum: bonjourEnum,
  apple_remote_desktop: appleRemoteDesktop,
  // Exfil & Cleanup
  data_stage: dataStage,
  artifact_enum: artifactEnum,
  cleanup_mac: cleanupMac,
}

export const MachookTool = Tool.define("machook", {
  description: `Execute a macOS post-exploitation program. 46 programs across 8 categories: recon (7), credential (8), privesc (6), persistence (6), evasion (6), monitoring (6), lateral (4), exfil/cleanup (3). Most require root. DTrace programs require SIP disabled. Available: ${Object.keys(PROGRAMS).join(", ")}. ALWAYS run cleanup_mac before leaving.`,
  parameters: z.object({
    program: z.enum(Object.keys(PROGRAMS) as [string, ...string[]]).describe(
      "macOS post-exploitation program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(120).describe("Maximum execution time in seconds (default: 120)"),
  }),
  async execute(params) {
    if (process.platform !== "darwin") {
      return {
        title: `machook: ${params.program}`,
        output: `machook requires macOS. Current platform: ${process.platform}\n\nUse 'linuxhook' for Linux post-exploitation or 'winhook' for Windows.`,
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const program = params.program as Program
    const handler = dispatch[program]
    let result: HookResult
    try {
      result = await handler(params.args, params.timeout_seconds)
    } catch (e) {
      return {
        title: `machook: ${program}`,
        output: `[-] ${program} failed: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program, findings: [] as Finding[] },
      }
    }

    const enriched = result.findings.map((f) => {
      const prefix = f.checkId.replace(/-\d+$/, "")
      const cwe = CWE_MAP[f.checkId] || CWE_MAP[prefix]
      return cwe ? { ...f, cwe } : f
    })

    return {
      title: `machook: ${program}`,
      output: result.output,
      metadata: { program, findings: enriched },
    }
  },
})
