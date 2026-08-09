import z from "zod"
import { Tool } from "../tool"
import {
  setStealthState,
  setExecMethod,
  argVal,
  hasFlag,
  detectEnv,
  resolveExec,
  activeExec,
  resetEnvCache,
} from "./shared"
import type { Finding, HookResult, StealthMode, ExecMethod } from "./shared"

import {
  systemInfo,
  processEnum,
  networkEnum,
  userEnum,
  serviceEnum,
  packageEnum,
  containerDetect,
  securityFramework,
  interestingFiles,
  mountEnum,
  kernelModuleEnum,
  localReconLinux,
} from "./recon"
import {
  shadowDump,
  sshKeyHarvest,
  bashHistorySecrets,
  gnomeKeyringDump,
  kwalletDump,
  browserCredsLinux,
  envSecrets,
  procMemoryHarvest,
  gpgKeyExtract,
  cloudCredHarvest,
  dockerConfigCreds,
  gitCredHarvest,
  wifiCredsNm,
  kerberosKeytab,
  dbCredHarvest,
  vncPassword,
  mailSpoolHarvest,
  netrcHarvest,
  ldapCredHarvest,
  credentialFilesScan,
} from "./credential"
import {
  sudoMisconfig,
  suidSgidScan,
  capabilitiesAbuse,
  cronPrivesc,
  nfsNoRootSquash,
  pathHijack,
  ldPreloadAbuse,
  kernelExploitCheck,
  writablePasswd,
  pkexecCve,
  systemdUnitAbuse,
  dbusExploit,
  pipSetupAbuse,
  sharedLibHijack,
  logrotateRace,
  writableServiceBin,
  polkitBypass,
  snapPrivesc,
  dockerGroupEscape,
  lxdGroupEscape,
  pythonLibHijack,
  motdAbuse,
  wildcardInjection,
  mysqlUdf,
  ptraceScopeCheck,
} from "./privesc"
import {
  cronPersist,
  systemdPersist,
  bashrcPersist,
  sshAuthorizedKeys,
  ldSoPreload,
  sysvinitPersist,
  atJobPersist,
  udevRulesPersist,
  pamBackdoor,
  motdPersist,
  xdgAutostart,
  gitHookPersist,
  kernelModulePersist,
  aptHookPersist,
  dpkgTriggerPersist,
  socketActivation,
  userServicePersist,
  xinetdPersist,
  rcLocalPersist,
  logrotatePersist,
  sshRcPersist,
  ldConfigPersist,
} from "./persistence"
import {
  sshPivot,
  ansibleAbuse,
  puppetAbuse,
  saltAbuse,
  nfsMountAttack,
  rsyncExploit,
  sshTunnel,
  socatTunnel,
  internalScan,
  proxychainsSetup,
} from "./lateral"
import {
  logTamper,
  historyClear,
  timestomp,
  auditdEvade,
  selinuxBypass,
  apparmorBypass,
  rootkitDetect,
  processHide,
  fileHide,
  networkHide,
  syslogManipulate,
  stealthCheckLinux,
} from "./evasion"
import {
  dataStage,
  dnsTunnelExfil,
  icmpExfil,
  covertChannel,
  httpsExfil,
  cleanupLinux,
  artifactEnum,
  steganographyExfil,
} from "./exfil"
import {
  arpSpoof,
  dnsSpoof,
  packetCapture,
  portScanNative,
  mitmProxy,
  responderLinux,
  firewallEnum,
  trafficRedirect,
  wifiAttack,
} from "./network"

const PROGRAMS = {
  // environment detection
  detect_env: {
    description: "Detect Linux environment: shell, tools, root, kernel, SELinux/AppArmor, container. Run FIRST.",
    args: "",
  },
  // recon
  system_info: {
    description: "System enumeration: kernel, distro, hostname, CPU, memory, disk, network interfaces",
    args: "",
  },
  process_enum: {
    description: "Enumerate running processes with PID, user, command, and parent process info",
    args: "[--full] [--tree]",
  },
  network_enum: {
    description: "Network enumeration: interfaces, routes, DNS, ARP table, listening ports, connections",
    args: "[--connections] [--routes]",
  },
  user_enum: {
    description: "Enumerate users, groups, sudoers, logged-in users, and recent logins",
    args: "[--all]",
  },
  service_enum: {
    description: "Enumerate running services: systemd units, sysvinit, xinetd, listening daemons",
    args: "[--all] [--failed]",
  },
  package_enum: {
    description: "List installed packages with versions for vulnerability correlation",
    args: "[--count N]",
  },
  container_detect: {
    description: "Detect container/VM environment: Docker, LXC, Kubernetes, WSL, VMware, VirtualBox",
    args: "",
  },
  security_framework: {
    description: "Check security frameworks: SELinux, AppArmor, firewall, audit, Fail2ban status",
    args: "",
  },
  interesting_files: {
    description: "Find interesting files: configs, scripts, SUID, world-writable, recent modifications",
    args: "[--depth N] [--path PATH]",
  },
  mount_enum: {
    description: "Enumerate mounts, fstab entries, NFS shares, and filesystem permissions",
    args: "",
  },
  kernel_module_enum: {
    description: "List loaded kernel modules and check for suspicious or vulnerable modules",
    args: "[--suspicious]",
  },
  local_recon_linux: {
    description: "Comprehensive local recon — runs all recon handlers and aggregates results",
    args: "[--quick]",
  },
  // credential harvesting
  shadow_dump: {
    description: "Read /etc/shadow for password hashes — requires root or shadow group membership",
    args: "",
  },
  ssh_key_harvest: {
    description: "Harvest SSH private keys from all user home directories and common locations",
    args: "[--user USER]",
  },
  bash_history_secrets: {
    description: "Search shell history files for passwords, tokens, API keys, and credentials",
    args: "[--user USER] [--all]",
  },
  gnome_keyring_dump: {
    description: "Extract secrets from GNOME Keyring using secret-tool or D-Bus interface",
    args: "",
  },
  kwallet_dump: {
    description: "Extract secrets from KDE KWallet password manager",
    args: "",
  },
  browser_creds_linux: {
    description: "Extract saved passwords and cookies from Chrome, Firefox, and Chromium browsers",
    args: "[--browser chrome|firefox|all]",
  },
  env_secrets: {
    description: "Search environment variables and .env files for secrets, tokens, and credentials",
    args: "[--proc] [--files]",
  },
  proc_memory_harvest: {
    description: "Extract credentials from /proc/*/maps and process memory — requires root",
    args: "[--pid PID] [--pattern REGEX]",
  },
  gpg_key_extract: {
    description: "Export GPG private keys and keyring data from all user directories",
    args: "[--user USER]",
  },
  cloud_cred_harvest: {
    description: "Harvest cloud credentials: AWS, GCP, Azure, DigitalOcean, Kubernetes configs",
    args: "[--provider aws|gcp|azure|all]",
  },
  docker_config_creds: {
    description: "Extract Docker registry credentials from ~/.docker/config.json files",
    args: "",
  },
  git_cred_harvest: {
    description: "Harvest Git credentials from .git-credentials, .gitconfig, and credential helpers",
    args: "",
  },
  wifi_creds_nm: {
    description: "Extract WiFi passwords from NetworkManager connection profiles — requires root",
    args: "",
  },
  kerberos_keytab: {
    description: "Extract Kerberos keytab files and ticket cache for credential reuse",
    args: "",
  },
  db_cred_harvest: {
    description: "Harvest database credentials from config files: MySQL, PostgreSQL, MongoDB, Redis",
    args: "[--type mysql|postgres|mongo|redis|all]",
  },
  vnc_password: {
    description: "Extract VNC passwords from ~/.vnc/passwd and other VNC config locations",
    args: "",
  },
  mail_spool_harvest: {
    description: "Search mail spools and maildir for credentials, tokens, and sensitive data",
    args: "[--user USER]",
  },
  netrc_harvest: {
    description: "Extract credentials from .netrc and .curlrc files across user directories",
    args: "",
  },
  ldap_cred_harvest: {
    description: "Extract LDAP bind credentials from ldap.conf, sssd.conf, and related configs",
    args: "",
  },
  credential_files_scan: {
    description: "Broad scan for credential files: private keys, certificates, password stores",
    args: "[--depth N] [--path PATH]",
  },
  // privilege escalation
  sudo_misconfig: {
    description: "Check sudo configuration for privilege escalation: NOPASSWD, GTFOBins binaries",
    args: "",
  },
  suid_sgid_scan: {
    description: "Find SUID/SGID binaries and check against GTFOBins for privesc opportunities",
    args: "[--path PATH]",
  },
  capabilities_abuse: {
    description: "Find binaries with Linux capabilities (cap_setuid, cap_dac_override, etc.) for privesc",
    args: "",
  },
  cron_privesc: {
    description: "Check cron jobs for writable scripts, wildcard injection, and PATH abuse",
    args: "",
  },
  nfs_no_root_squash: {
    description: "Check NFS exports for no_root_squash — allows remote root SUID binary creation",
    args: "",
  },
  path_hijack: {
    description: "Check PATH for writable directories that could hijack SUID/service binary lookups",
    args: "",
  },
  ld_preload_abuse: {
    description: "Check LD_PRELOAD/LD_LIBRARY_PATH injection opportunities via sudo/SUID",
    args: "",
  },
  kernel_exploit_check: {
    description: "Check kernel version against known exploits: DirtyPipe, DirtyCow, OverlayFS, etc.",
    args: "",
  },
  writable_passwd: {
    description: "Check if /etc/passwd or /etc/shadow is writable — allows adding root user",
    args: "",
  },
  pkexec_cve: {
    description: "Check for CVE-2021-4034 (PwnKit) pkexec privilege escalation vulnerability",
    args: "",
  },
  systemd_unit_abuse: {
    description: "Find writable systemd unit files and timer files for privilege escalation",
    args: "",
  },
  dbus_exploit: {
    description: "Check D-Bus services for privilege escalation via misconfigured policies",
    args: "",
  },
  pip_setup_abuse: {
    description: "Check pip/setuptools for arbitrary code execution via setup.py or pip install",
    args: "",
  },
  shared_lib_hijack: {
    description: "Find shared library hijacking opportunities via missing libraries in RPATH/RUNPATH",
    args: "",
  },
  logrotate_race: {
    description: "Check logrotate for race condition privilege escalation (CVE-2016-1247 pattern)",
    args: "",
  },
  writable_service_bin: {
    description: "Find writable binaries referenced by systemd services or init scripts",
    args: "",
  },
  polkit_bypass: {
    description: "Check PolicyKit for privilege escalation via CVE-2021-3560 or misconfigured rules",
    args: "",
  },
  snap_privesc: {
    description: "Check snap for privilege escalation via dirty_sock or writable snap directories",
    args: "",
  },
  docker_group_escape: {
    description: "Check Docker group membership for container escape to host root",
    args: "",
  },
  lxd_group_escape: {
    description: "Check LXD/LXC group membership for privilege escalation via container escape",
    args: "",
  },
  python_lib_hijack: {
    description: "Check Python library paths for writable directories enabling import hijacking",
    args: "",
  },
  motd_abuse: {
    description: "Check /etc/update-motd.d/ for writable scripts that run as root on login",
    args: "",
  },
  wildcard_injection: {
    description: "Check for wildcard injection in cron/scripts using tar, rsync, chown with *",
    args: "",
  },
  mysql_udf: {
    description: "Check MySQL for UDF (User Defined Function) privilege escalation to OS commands",
    args: "",
  },
  ptrace_scope_check: {
    description: "Check ptrace_scope setting — 0 allows attaching to any process for credential theft",
    args: "",
  },
  // persistence
  cron_persist: {
    description: "Install cron-based persistence via crontab or /etc/cron.d/ drop-in files",
    args: "--cmd COMMAND [--schedule CRON_EXPR] [--user USER]",
  },
  systemd_persist: {
    description: "Create systemd service or timer for persistent execution across reboots",
    args: "--cmd COMMAND [--name NAME] [--timer INTERVAL]",
  },
  bashrc_persist: {
    description: "Add persistence payload to .bashrc, .bash_profile, .profile, or .zshrc",
    args: "--cmd COMMAND [--user USER] [--file bashrc|profile|zshrc]",
  },
  ssh_authorized_keys: {
    description: "Add SSH public key to authorized_keys for persistent remote access",
    args: "--key 'ssh-rsa ...' [--user USER]",
  },
  ld_so_preload: {
    description: "Add shared library to /etc/ld.so.preload for process injection persistence",
    args: "--lib /path/to/lib.so",
  },
  sysvinit_persist: {
    description: "Create SysV init script in /etc/init.d/ for boot persistence",
    args: "--cmd COMMAND [--name NAME]",
  },
  at_job_persist: {
    description: "Schedule persistence via at job — survives cron removal",
    args: "--cmd COMMAND [--time TIME]",
  },
  udev_rules_persist: {
    description: "Create udev rule that triggers payload on device events",
    args: "--cmd COMMAND [--trigger SUBSYSTEM]",
  },
  pam_backdoor: {
    description: "Install PAM backdoor module for authentication bypass — requires root",
    args: "--password PASSWORD [--module pam_unix]",
  },
  motd_persist: {
    description: "Add persistence to /etc/update-motd.d/ — executes on each SSH login",
    args: "--cmd COMMAND",
  },
  xdg_autostart: {
    description: "Create XDG autostart .desktop entry for GUI session persistence",
    args: "--cmd COMMAND [--name NAME]",
  },
  git_hook_persist: {
    description: "Install Git hook (post-checkout, post-merge) for developer-targeted persistence",
    args: "--cmd COMMAND --repo /path/to/repo [--hook post-checkout]",
  },
  kernel_module_persist: {
    description: "Load kernel module for rootkit-level persistence — requires root",
    args: "--module /path/to/module.ko [--name NAME]",
  },
  apt_hook_persist: {
    description: "Create APT hook in /etc/apt/apt.conf.d/ — triggers on package operations",
    args: "--cmd COMMAND [--name NAME]",
  },
  dpkg_trigger_persist: {
    description: "Create dpkg trigger for persistence on package install/upgrade events",
    args: "--cmd COMMAND [--package PACKAGE]",
  },
  socket_activation: {
    description: "Create systemd socket-activated service for on-demand persistence",
    args: "--cmd COMMAND --port PORT [--name NAME]",
  },
  user_service_persist: {
    description: "Create user-level systemd service — no root required",
    args: "--cmd COMMAND [--name NAME]",
  },
  xinetd_persist: {
    description: "Create xinetd service for network-triggered persistence",
    args: "--cmd COMMAND --port PORT [--name NAME]",
  },
  rc_local_persist: {
    description: "Add command to /etc/rc.local for boot persistence (legacy systems)",
    args: "--cmd COMMAND",
  },
  logrotate_persist: {
    description: "Add persistence via logrotate postrotate/prerotate scripts",
    args: "--cmd COMMAND [--log /var/log/syslog]",
  },
  ssh_rc_persist: {
    description: "Add persistence to ~/.ssh/rc — executes on each SSH login for that user",
    args: "--cmd COMMAND [--user USER]",
  },
  ld_config_persist: {
    description: "Add library path to /etc/ld.so.conf.d/ for shared library injection persistence",
    args: "--path /path/to/libs [--name NAME]",
  },
  // lateral movement
  ssh_pivot: {
    description: "Pivot to remote host via SSH using harvested keys, credentials, or agent forwarding",
    args: "--target HOST [--user USER] [--key PATH] [--cmd COMMAND]",
  },
  ansible_abuse: {
    description: "Abuse Ansible for lateral movement via ad-hoc commands or playbook execution",
    args: "--target HOST [--cmd COMMAND] [--inventory PATH]",
  },
  puppet_abuse: {
    description: "Abuse Puppet agent/master trust for lateral movement and code execution",
    args: "[--target HOST]",
  },
  salt_abuse: {
    description: "Abuse SaltStack master for lateral movement via salt command execution",
    args: "--target MINION [--cmd COMMAND]",
  },
  nfs_mount_attack: {
    description: "Mount NFS shares and exploit no_root_squash for SUID binary deployment",
    args: "--target HOST --share PATH [--mount PATH]",
  },
  rsync_exploit: {
    description: "Exploit rsync for file transfer to/from remote hosts — check anonymous access",
    args: "--target HOST [--module MODULE] [--path PATH]",
  },
  ssh_tunnel: {
    description: "Create SSH tunnels (local, remote, dynamic/SOCKS) for network pivoting",
    args: "--target HOST --type local|remote|dynamic [--lport PORT] [--rhost HOST] [--rport PORT]",
  },
  socat_tunnel: {
    description: "Create socat tunnels for port forwarding and traffic relaying",
    args: "--lport PORT --rhost HOST --rport PORT [--type tcp|udp]",
  },
  internal_scan: {
    description: "Scan internal network for live hosts and open ports using bash/nc/python",
    args: "--subnet CIDR [--ports PORTS] [--threads N]",
  },
  proxychains_setup: {
    description: "Configure proxychains for pivoting through SOCKS proxy",
    args: "--proxy HOST:PORT [--type socks4|socks5] [--config PATH]",
  },
  // defense evasion
  log_tamper: {
    description: "Tamper with log files: clear entries, remove specific lines, truncate logs",
    args: "[--file PATH] [--pattern REGEX] [--clear]",
  },
  history_clear: {
    description: "Clear shell history for all shells: bash, zsh, fish, and in-memory history",
    args: "[--user USER] [--all]",
  },
  timestomp: {
    description: "Modify file timestamps (atime, mtime, ctime) to match surrounding files",
    args: "--file PATH [--reference REF_FILE] [--time TIMESTAMP]",
  },
  auditd_evade: {
    description: "Evade auditd: stop service, remove rules, clear audit logs — requires root",
    args: "[--stop] [--clear-rules] [--clear-logs]",
  },
  selinux_bypass: {
    description: "Bypass SELinux: set permissive, change context, exploit policy misconfigs",
    args: "[--permissive] [--context CONTEXT]",
  },
  apparmor_bypass: {
    description: "Bypass AppArmor: set complain mode, remove profiles, exploit gaps",
    args: "[--complain PROFILE] [--disable PROFILE]",
  },
  rootkit_detect: {
    description: "Detect rootkits: check /proc anomalies, hidden processes, kernel module hooks",
    args: "[--deep]",
  },
  process_hide: {
    description: "Hide process from /proc listing using mount namespace or LD_PRELOAD tricks",
    args: "--pid PID [--method mount|preload]",
  },
  file_hide: {
    description: "Hide files using extended attributes, dot prefix, or bind mount techniques",
    args: "--file PATH [--method xattr|dot|mount]",
  },
  network_hide: {
    description: "Hide network connections from netstat/ss output using LD_PRELOAD or raw sockets",
    args: "--port PORT [--method preload|raw]",
  },
  syslog_manipulate: {
    description: "Manipulate syslog/journald: redirect, filter, or suppress specific log messages",
    args: "[--filter PATTERN] [--redirect PATH] [--stop]",
  },
  stealth_check_linux: {
    description: "Check operational security: artifacts left, logs generated, detection indicators",
    args: "",
  },
  // exfiltration
  data_stage: {
    description: "Stage data for exfiltration: compress, encrypt, split into chunks",
    args: "--path PATH [--outdir DIR] [--chunk-size SIZE] [--encrypt KEY]",
  },
  dns_tunnel_exfil: {
    description: "Exfiltrate data via DNS queries — encodes data in subdomain labels",
    args: "--file PATH --domain DOMAIN [--chunk-size N]",
  },
  icmp_exfil: {
    description: "Exfiltrate data via ICMP echo requests — requires root for raw sockets",
    args: "--file PATH --target HOST [--chunk-size N]",
  },
  covert_channel: {
    description: "Create covert channels: TCP sequence numbers, HTTP headers, DNS TXT records",
    args: "--type tcp|http|dns --target HOST [--data DATA]",
  },
  https_exfil: {
    description: "Exfiltrate data via HTTPS POST to a controlled endpoint",
    args: "--file PATH --url URL [--chunk-size N] [--headers KEY=VALUE]",
  },
  cleanup_linux: {
    description: "Clean up artifacts: temp files, logs, history, staged data. Run BEFORE leaving target.",
    args: "[--thorough] [--keep-access]",
  },
  artifact_enum: {
    description: "Enumerate artifacts left on the system: temp files, tools, logs, persistence",
    args: "[--verbose]",
  },
  steganography_exfil: {
    description: "Hide data in image files using LSB steganography for covert exfiltration",
    args: "--file PATH --image PATH [--output PATH]",
  },
  // network attacks
  arp_spoof: {
    description: "ARP spoofing for MITM positioning — poison ARP cache of target and gateway",
    args: "--target IP --gateway IP [--interface IFACE]",
  },
  dns_spoof: {
    description: "DNS spoofing via ARP+iptables or hosts file manipulation",
    args: "--domain DOMAIN --ip IP [--interface IFACE]",
  },
  packet_capture: {
    description: "Capture network packets using tcpdump with filters for credential extraction",
    args: "[--interface IFACE] [--filter FILTER] [--duration SECONDS] [--output PCAP]",
  },
  port_scan_native: {
    description: "Port scan using bash /dev/tcp, nc, or python sockets — no nmap required",
    args: "--target HOST [--ports RANGE] [--threads N]",
  },
  mitm_proxy: {
    description: "Set up MITM proxy using iptables + mitmproxy/sslstrip for traffic interception",
    args: "--target IP [--port PORT] [--ssl-strip]",
  },
  responder_linux: {
    description: "LLMNR/NBT-NS/mDNS poisoning for credential capture on Linux networks",
    args: "[--interface IFACE] [--analyze]",
  },
  firewall_enum: {
    description: "Enumerate firewall rules: iptables, nftables, ufw, firewalld — find gaps",
    args: "[--type iptables|nftables|ufw|firewalld|all]",
  },
  traffic_redirect: {
    description: "Redirect traffic using iptables DNAT/SNAT rules for pivoting or interception",
    args: "--from PORT --to HOST:PORT [--interface IFACE]",
  },
  wifi_attack: {
    description: "WiFi attacks: deauth, handshake capture, evil twin using aircrack-ng suite",
    args: "--interface IFACE [--target BSSID] [--attack deauth|handshake|evil-twin]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS

const dispatch: Record<Program, (args: string[], timeout: number) => Promise<HookResult>> = {
  // environment
  detect_env: async (_args, timeout) => {
    const env = await detectEnv(timeout)
    const output = [
      "=== Linux Environment Detection ===",
      "",
      `Shell: ${env.shell}`,
      `Bash: ${env.bashAvailable ? "available" : "NOT available"}`,
      `sh: ${env.shAvailable ? "available" : "NOT available"}`,
      `Python3: ${env.python3Available ? "available" : "NOT available"}`,
      `Perl: ${env.perlAvailable ? "available" : "NOT available"}`,
      `Busybox: ${env.busyboxAvailable ? "available" : "NOT available"}`,
      "",
      `Root: ${env.isRoot ? "YES (uid=0)" : `NO (uid=${env.uid})`}`,
      `Sudo: ${env.sudoAvailable ? (env.sudoNopasswd ? "available (NOPASSWD)" : "available (requires password)") : "NOT available"}`,
      "",
      `Kernel: ${env.kernelVersion} (${env.kernelMajor}.${env.kernelMinor})`,
      `Distro: ${env.distro} ${env.distroVersion}`,
      `Arch: ${env.arch}`,
      "",
      `SELinux: ${env.selinuxStatus}`,
      `AppArmor: ${env.apparmorStatus}`,
      `Container: ${env.inContainer ? `YES (${env.containerType})` : "NO"}`,
      `Init: ${env.initSystem}`,
      `Package Manager: ${env.packageManager}`,
      "",
      `curl: ${env.hasCurl ? "yes" : "no"}  wget: ${env.hasWget ? "yes" : "no"}  nc: ${env.hasNetcat ? "yes" : "no"}`,
      `socat: ${env.hasSocat ? "yes" : "no"}  nmap: ${env.hasNmap ? "yes" : "no"}  gcc: ${env.hasGcc ? "yes" : "no"}`,
      "",
      `Recommended exec: ${env.recommendedExec}`,
    ]
    return {
      output: output.join("\n"),
      findings: [
        {
          checkId: "ENV-001",
          provider: "linuxhook",
          severity: "INFO",
          status: "IDENTIFIED",
          resource: "environment",
          title: "Linux environment detected",
          details: `${env.distro} ${env.distroVersion}, kernel ${env.kernelVersion}, ${env.isRoot ? "root" : `uid=${env.uid}`}, ${env.selinuxStatus === "enforcing" ? "SELinux enforcing" : env.apparmorStatus === "enforcing" ? "AppArmor enforcing" : "no MAC enforcing"}`,
          remediation: "Use detected environment info to select appropriate tools and execution methods",
        },
      ],
    }
  },
  // recon
  system_info: systemInfo,
  process_enum: processEnum,
  network_enum: networkEnum,
  user_enum: userEnum,
  service_enum: serviceEnum,
  package_enum: packageEnum,
  container_detect: containerDetect,
  security_framework: securityFramework,
  interesting_files: interestingFiles,
  mount_enum: mountEnum,
  kernel_module_enum: kernelModuleEnum,
  local_recon_linux: localReconLinux,
  // credential harvesting
  shadow_dump: shadowDump,
  ssh_key_harvest: sshKeyHarvest,
  bash_history_secrets: bashHistorySecrets,
  gnome_keyring_dump: gnomeKeyringDump,
  kwallet_dump: kwalletDump,
  browser_creds_linux: browserCredsLinux,
  env_secrets: envSecrets,
  proc_memory_harvest: procMemoryHarvest,
  gpg_key_extract: gpgKeyExtract,
  cloud_cred_harvest: cloudCredHarvest,
  docker_config_creds: dockerConfigCreds,
  git_cred_harvest: gitCredHarvest,
  wifi_creds_nm: wifiCredsNm,
  kerberos_keytab: kerberosKeytab,
  db_cred_harvest: dbCredHarvest,
  vnc_password: vncPassword,
  mail_spool_harvest: mailSpoolHarvest,
  netrc_harvest: netrcHarvest,
  ldap_cred_harvest: ldapCredHarvest,
  credential_files_scan: credentialFilesScan,
  // privilege escalation
  sudo_misconfig: sudoMisconfig,
  suid_sgid_scan: suidSgidScan,
  capabilities_abuse: capabilitiesAbuse,
  cron_privesc: cronPrivesc,
  nfs_no_root_squash: nfsNoRootSquash,
  path_hijack: pathHijack,
  ld_preload_abuse: ldPreloadAbuse,
  kernel_exploit_check: kernelExploitCheck,
  writable_passwd: writablePasswd,
  pkexec_cve: pkexecCve,
  systemd_unit_abuse: systemdUnitAbuse,
  dbus_exploit: dbusExploit,
  pip_setup_abuse: pipSetupAbuse,
  shared_lib_hijack: sharedLibHijack,
  logrotate_race: logrotateRace,
  writable_service_bin: writableServiceBin,
  polkit_bypass: polkitBypass,
  snap_privesc: snapPrivesc,
  docker_group_escape: dockerGroupEscape,
  lxd_group_escape: lxdGroupEscape,
  python_lib_hijack: pythonLibHijack,
  motd_abuse: motdAbuse,
  wildcard_injection: wildcardInjection,
  mysql_udf: mysqlUdf,
  ptrace_scope_check: ptraceScopeCheck,
  // persistence
  cron_persist: cronPersist,
  systemd_persist: systemdPersist,
  bashrc_persist: bashrcPersist,
  ssh_authorized_keys: sshAuthorizedKeys,
  ld_so_preload: ldSoPreload,
  sysvinit_persist: sysvinitPersist,
  at_job_persist: atJobPersist,
  udev_rules_persist: udevRulesPersist,
  pam_backdoor: pamBackdoor,
  motd_persist: motdPersist,
  xdg_autostart: xdgAutostart,
  git_hook_persist: gitHookPersist,
  kernel_module_persist: kernelModulePersist,
  apt_hook_persist: aptHookPersist,
  dpkg_trigger_persist: dpkgTriggerPersist,
  socket_activation: socketActivation,
  user_service_persist: userServicePersist,
  xinetd_persist: xinetdPersist,
  rc_local_persist: rcLocalPersist,
  logrotate_persist: logrotatePersist,
  ssh_rc_persist: sshRcPersist,
  ld_config_persist: ldConfigPersist,
  // lateral movement
  ssh_pivot: sshPivot,
  ansible_abuse: ansibleAbuse,
  puppet_abuse: puppetAbuse,
  salt_abuse: saltAbuse,
  nfs_mount_attack: nfsMountAttack,
  rsync_exploit: rsyncExploit,
  ssh_tunnel: sshTunnel,
  socat_tunnel: socatTunnel,
  internal_scan: internalScan,
  proxychains_setup: proxychainsSetup,
  // defense evasion
  log_tamper: logTamper,
  history_clear: historyClear,
  timestomp: timestomp,
  auditd_evade: auditdEvade,
  selinux_bypass: selinuxBypass,
  apparmor_bypass: apparmorBypass,
  rootkit_detect: rootkitDetect,
  process_hide: processHide,
  file_hide: fileHide,
  network_hide: networkHide,
  syslog_manipulate: syslogManipulate,
  stealth_check_linux: stealthCheckLinux,
  // exfiltration
  data_stage: dataStage,
  dns_tunnel_exfil: dnsTunnelExfil,
  icmp_exfil: icmpExfil,
  covert_channel: covertChannel,
  https_exfil: httpsExfil,
  cleanup_linux: cleanupLinux,
  artifact_enum: artifactEnum,
  steganography_exfil: steganographyExfil,
  // network attacks
  arp_spoof: arpSpoof,
  dns_spoof: dnsSpoof,
  packet_capture: packetCapture,
  port_scan_native: portScanNative,
  mitm_proxy: mitmProxy,
  responder_linux: responderLinux,
  firewall_enum: firewallEnum,
  traffic_redirect: trafficRedirect,
  wifi_attack: wifiAttack,
}

const CWE_MAP: Record<string, string> = {
  // Credentials
  "LNX-SHADOW": "CWE-522",
  "LNX-SSH": "CWE-522",
  "LNX-HISTORY": "CWE-312",
  "LNX-KEYRING": "CWE-522",
  "LNX-KWALLET": "CWE-522",
  "LNX-BROWSER": "CWE-312",
  "LNX-ENV": "CWE-312",
  "LNX-PROC": "CWE-522",
  "LNX-GPG": "CWE-522",
  "LNX-CLOUD": "CWE-522",
  "LNX-DOCKER": "CWE-522",
  "LNX-GIT": "CWE-522",
  "LNX-WIFI": "CWE-312",
  "LNX-KRB": "CWE-522",
  "LNX-DB": "CWE-522",
  "LNX-VNC": "CWE-312",
  "LNX-MAIL": "CWE-200",
  "LNX-NETRC": "CWE-312",
  "LNX-LDAP": "CWE-522",
  "LNX-CRED": "CWE-522",
  // Privesc
  "LNX-SUDO": "CWE-269",
  "LNX-SUID": "CWE-269",
  "LNX-CAP": "CWE-269",
  "LNX-CRON": "CWE-269",
  "LNX-NFS": "CWE-269",
  "LNX-PATH": "CWE-426",
  "LNX-LDPRELOAD": "CWE-426",
  "LNX-KERNEL": "CWE-269",
  "LNX-PASSWD": "CWE-732",
  "LNX-PKEXEC": "CWE-269",
  "LNX-SYSTEMD": "CWE-269",
  "LNX-DBUS": "CWE-269",
  "LNX-PIP": "CWE-426",
  "LNX-SHLIB": "CWE-426",
  "LNX-LOGROTATE": "CWE-362",
  "LNX-WRITSVC": "CWE-732",
  "LNX-POLKIT": "CWE-269",
  "LNX-SNAP": "CWE-269",
  "LNX-DOCKERGRP": "CWE-269",
  "LNX-LXDGRP": "CWE-269",
  "LNX-PYLIB": "CWE-426",
  "LNX-MOTD": "CWE-269",
  "LNX-WILDCARD": "CWE-78",
  "LNX-MYSQLUDF": "CWE-269",
  "LNX-PTRACE": "CWE-269",
  // Persistence
  "LNX-CRONP": "CWE-269",
  "LNX-SYSDP": "CWE-269",
  "LNX-BASHRC": "CWE-269",
  "LNX-AUTHKEYS": "CWE-269",
  "LNX-LDSOPRELOAD": "CWE-269",
  "LNX-INITP": "CWE-269",
  "LNX-ATJOB": "CWE-269",
  "LNX-UDEV": "CWE-269",
  "LNX-PAM": "CWE-269",
  "LNX-MOTDP": "CWE-269",
  "LNX-XDG": "CWE-269",
  "LNX-GITHOOK": "CWE-269",
  "LNX-KMOD": "CWE-269",
  "LNX-APT": "CWE-269",
  "LNX-DPKG": "CWE-269",
  "LNX-SOCKET": "CWE-269",
  "LNX-USERSVC": "CWE-269",
  "LNX-XINETD": "CWE-269",
  "LNX-RCLOCAL": "CWE-269",
  "LNX-LOGROT": "CWE-269",
  "LNX-SSHRC": "CWE-269",
  "LNX-LDCONF": "CWE-269",
  // Lateral Movement
  "LNX-SSHPIVOT": "CWE-78",
  "LNX-ANSIBLE": "CWE-78",
  "LNX-PUPPET": "CWE-78",
  "LNX-SALT": "CWE-78",
  "LNX-NFSMNT": "CWE-269",
  "LNX-RSYNC": "CWE-78",
  "LNX-TUNNEL": "CWE-918",
  "LNX-PORTSCAN": "CWE-200",
  // Evasion
  "LNX-LOGTAMP": "CWE-1254",
  "LNX-HISTCLR": "CWE-1254",
  "LNX-TIMESTOMP": "CWE-1254",
  "LNX-AUDITD": "CWE-693",
  "LNX-SELINUX": "CWE-693",
  "LNX-APPARMOR": "CWE-693",
  "LNX-ROOTKIT": "CWE-693",
  "LNX-HIDE": "CWE-693",
  "LNX-NETHIDE": "CWE-693",
  "LNX-SYSLOG": "CWE-693",
  "LNX-STEALTH": "CWE-693",
  // Exfiltration
  "LNX-STAGE": "CWE-200",
  "LNX-DNSTUN": "CWE-200",
  "LNX-ICMPEX": "CWE-200",
  "LNX-COVERT": "CWE-200",
  "LNX-HTTPEX": "CWE-200",
  "LNX-CLEANUP": "CWE-1254",
  "LNX-ARTIFACT": "CWE-200",
  "LNX-STEGO": "CWE-200",
  // Network
  "LNX-ARP": "CWE-350",
  "LNX-DNSSPOOF": "CWE-350",
  "LNX-PCAP": "CWE-319",
  "LNX-MITM": "CWE-294",
  "LNX-RESPONDER": "CWE-350",
  "LNX-FW": "CWE-693",
  "LNX-REDIRECT": "CWE-693",
  "LNX-WIFIATT": "CWE-319",
  // Recon
  "LNX-SYSINFO": "CWE-200",
  "LNX-PROCS": "CWE-200",
  "LNX-NETWORK": "CWE-200",
  "LNX-USERS": "CWE-200",
  "LNX-SERVICES": "CWE-200",
  "LNX-PACKAGES": "CWE-200",
  "LNX-CONTAINER": "CWE-200",
  "LNX-SECFW": "CWE-200",
  "LNX-FILES": "CWE-200",
  "LNX-MOUNTS": "CWE-200",
  "LNX-KMODULES": "CWE-200",
  "LNX-RECON": "CWE-200",
  ENV: "CWE-693",
}

function resolveCwe(checkId: string): string | undefined {
  for (const prefix of Object.keys(CWE_MAP).sort((a, b) => b.length - a.length)) {
    if (checkId.startsWith(prefix)) return CWE_MAP[prefix]
  }
  return undefined
}

const BASH_FAILURE_PATTERNS = [
  "command not found",
  "Permission denied",
  "No such file or directory",
  "Operation not permitted",
  "cannot execute binary file",
  "not found",
  "syntax error",
]

function isBashFailure(output: string): boolean {
  if (!output.trim()) return true
  const lower = output.toLowerCase()
  return BASH_FAILURE_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}

const envChangingPrograms = new Set(["selinux_bypass", "apparmor_bypass", "auditd_evade"])

export const LinuxhookTool = Tool.define("linuxhook", {
  description: `Execute a Linux post-exploitation program. Covers credential harvesting (/etc/shadow, SSH keys, cloud creds, browser, env, GPG, keytab), privilege escalation (sudo, SUID, capabilities, kernel exploits, Docker/LXD group, polkit, snap), persistence (cron, systemd, SSH keys, PAM, ld.so.preload, udev, apt hooks), defense evasion (log tamper, auditd, SELinux/AppArmor bypass, process/file/network hiding), lateral movement (SSH pivot, Ansible/Puppet/Salt, NFS, tunnels), network attacks (ARP/DNS spoof, MITM, packet capture, port scan), and exfiltration (DNS tunnel, ICMP, HTTPS, steganography). Requires root for many programs. ALWAYS run detect_env first. If bash is unavailable use --exec sh or --exec python3. Auto-fallback retries with sh when bash fails. Available programs: ${Object.keys(PROGRAMS).join(", ")}. ALWAYS run cleanup_linux before leaving a target.`,
  parameters: z.object({
    program: z
      .enum(Object.keys(PROGRAMS) as [string, ...string[]])
      .describe("Program name. Run with no args to see usage. Full list in tool description."),
    args: z
      .array(z.string())
      .describe(
        "Arguments to pass to the program. Use --stealth <mode> for evasion: base64 (echo|base64 -d|bash), memfd (fileless via Python3 memfd_create), shm (/dev/shm tmpfs exec). Use --exec <method> for execution engine: bash (default), sh (POSIX), python3, perl, busybox, auto (detect best available)",
      ),
    timeout_seconds: z.number().optional().default(120).describe("Maximum execution time in seconds (default: 120)"),
  }),
  async execute(params) {
    if (process.platform !== "linux") {
      return {
        title: `linuxhook: ${params.program}`,
        output: `linuxhook requires Linux. Current platform: ${process.platform}\n\nUse 'winhook' for Windows or 'machook' for macOS.`,
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    setStealthState(argVal(params.args, "--stealth") as StealthMode | undefined)
    const requestedExec = (argVal(params.args, "--exec") as ExecMethod) || "bash"

    if (requestedExec === "auto") {
      const env = await detectEnv(params.timeout_seconds)
      setExecMethod(resolveExec("auto", env))
    } else {
      setExecMethod(requestedExec)
    }

    const program = params.program as Program
    const handler = dispatch[program]
    let result = await handler(params.args, params.timeout_seconds)

    if (activeExec === "bash" && isBashFailure(result.output)) {
      const env = await detectEnv(params.timeout_seconds)
      const fallback = resolveExec("auto", env)
      if (fallback !== "bash") {
        setExecMethod(fallback)
        const retry = await handler(params.args, params.timeout_seconds)
        result = {
          output: `[!] Bash failed — auto-fallback to ${fallback}\n\n${retry.output}`,
          findings: retry.findings,
        }
      }
    }

    if (envChangingPrograms.has(program)) resetEnvCache()

    setStealthState(undefined)
    setExecMethod("bash")

    const enriched = result.findings.map((f) => ({
      ...f,
      severity: f.severity.toLowerCase(),
      cwe: f.cwe || resolveCwe(f.checkId),
    }))
    const output =
      enriched.length > 0
        ? result.output +
          "\n\n=== FINDINGS (" +
          enriched.length +
          ") ===\n" +
          enriched
            .map(
              (f, i) =>
                `[${i + 1}] ${f.severity} — ${f.title}${f.cwe ? ` (${f.cwe})` : ""}\n    Check: ${f.checkId} | Status: ${f.status} | Resource: ${f.resource}\n    ${f.details}\n    Remediation: ${f.remediation}`,
            )
            .join("\n") +
          "\n\nCall report_vulnerability for each finding: severity (lowercase), title, description=details, recommendation=remediation" +
          (enriched.some((f) => f.cwe) ? ", cwe_id from parentheses above" : "") +
          "."
        : result.output

    return {
      title: `linuxhook: ${program}`,
      output,
      metadata: { program, findings: enriched },
    }
  },
})
