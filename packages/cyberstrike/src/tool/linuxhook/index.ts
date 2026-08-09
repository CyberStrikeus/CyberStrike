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
  system_info: {
    description: "Comprehensive Linux system enumeration — hostname, kernel, distro, architecture, uptime, CPU, memory, disk, environment variables, and installed shells",
    args: "[--verbose]",
  },
  process_enum: {
    description: "Enumerate running processes with PID, user, CPU/mem usage, command line — highlight root processes, security tools, interesting services",
    args: "[--tree] [--filter USER]",
  },
  network_enum: {
    description: "Network reconnaissance — interfaces, IP addresses, routes, DNS, ARP cache, listening ports, established connections, iptables rules",
    args: "[--full]",
  },
  user_enum: {
    description: "User and group enumeration — /etc/passwd, /etc/group, sudo group members, logged-in users, last logins, home directories, SSH authorized keys",
    args: "[--verbose]",
  },
  service_enum: {
    description: "Enumerate systemd/sysvinit services — running, enabled, failed units, timers, sockets, and custom service files",
    args: "[--all]",
  },
  package_enum: {
    description: "Installed package enumeration via apt/yum/dnf/pacman/apk — detect outdated/vulnerable packages, development tools, compilers",
    args: "[--vulnerable-only]",
  },
  container_detect: {
    description: "Detect container/VM environment — Docker, LXC, Kubernetes pod, WSL, systemd-nspawn, OpenVZ, cgroups analysis, namespace isolation check",
    args: "",
  },
  security_framework: {
    description: "Enumerate security posture — SELinux mode/policy, AppArmor profiles, seccomp filters, capabilities, audit rules, ASLR/NX/SMEP status",
    args: "[--verbose]",
  },
  interesting_files: {
    description: "Hunt for sensitive files — config files with credentials, backup files, database files, private keys, writable scripts, SUID/SGID binaries, world-writable directories",
    args: "[--deep] [--path PATH]",
  },
  mount_enum: {
    description: "Filesystem enumeration — mounted filesystems, fstab entries, NFS/CIFS mounts, noexec/nosuid flags, tmpfs with exec, writable mount points",
    args: "",
  },
  kernel_module_enum: {
    description: "Loaded kernel modules and available modules — detect security modules, network modules, filesystem modules, suspicious/unsigned modules",
    args: "[--unsigned-only]",
  },
  local_recon_linux: {
    description: "All-in-one local recon — combines system_info, user_enum, network_enum, process_enum, and security_framework into a single comprehensive scan. Run this first on a new target",
    args: "[--quick]",
  },
  shadow_dump: {
    description: "Read /etc/shadow for password hashes — extracts hash types (MD5/$1$, SHA-256/$5$, SHA-512/$6$, yescrypt/$y$), identifies accounts with no password or locked status",
    args: "[--crack-ready]",
  },
  ssh_key_harvest: {
    description: "Harvest SSH private keys from all user home directories, /etc/ssh/, and common backup locations — identifies key types (RSA, ECDSA, Ed25519) and passphrase protection",
    args: "[--all-users]",
  },
  bash_history_secrets: {
    description: "Extract secrets from shell history files — passwords in commands, API keys, database connection strings, SSH/SCP commands with credentials, curl/wget with auth tokens",
    args: "[--all-users]",
  },
  gnome_keyring_dump: {
    description: "Dump GNOME Keyring secrets — WiFi passwords, stored website credentials, application passwords, SSH agent keys. Requires user session or master password",
    args: "",
  },
  kwallet_dump: {
    description: "Extract KDE Wallet (KWallet) stored credentials — network passwords, form data, application secrets. Requires active KDE session",
    args: "",
  },
  browser_creds_linux: {
    description: "Extract browser credentials on Linux — Chrome/Chromium Login Data (SQLite), Firefox logins.json + key4.db (NSS decryption), saved passwords, cookies, history",
    args: "[--browser chrome|firefox|all]",
  },
  env_secrets: {
    description: "Extract secrets from environment variables — API keys, tokens, database URLs, AWS credentials, cloud provider secrets from /proc/*/environ and current env",
    args: "[--all-procs]",
  },
  proc_memory_harvest: {
    description: "Harvest credentials from process memory via /proc/PID/maps + /proc/PID/mem — scan for password patterns, tokens, connection strings in running processes",
    args: "[--pid PID] [--pattern REGEX]",
  },
  gpg_key_extract: {
    description: "Enumerate and extract GPG/PGP keys — public and private keyrings, trust database, agent socket, cached passphrases from gpg-agent",
    args: "[--all-users]",
  },
  cloud_cred_harvest: {
    description: "Harvest cloud provider credentials — AWS (~/.aws/), GCP (~/.config/gcloud/), Azure (~/.azure/), DigitalOcean, Heroku, Terraform state files with embedded secrets",
    args: "[--all-users]",
  },
  docker_config_creds: {
    description: "Extract Docker registry credentials from ~/.docker/config.json — base64 encoded auth tokens, credential helpers, registry endpoints",
    args: "[--all-users]",
  },
  git_cred_harvest: {
    description: "Harvest Git credentials — .git-credentials, .gitconfig with credential helpers, GitHub/GitLab tokens, stored HTTPS passwords",
    args: "[--all-users]",
  },
  wifi_creds_nm: {
    description: "Extract WiFi passwords from NetworkManager — /etc/NetworkManager/system-connections/ stored PSK keys, WPA-Enterprise credentials, 802.1X certificates",
    args: "",
  },
  kerberos_keytab: {
    description: "Enumerate and extract Kerberos keytab files — /etc/krb5.keytab, user keytabs, service principal keys, krb5.conf realm configuration",
    args: "",
  },
  db_cred_harvest: {
    description: "Extract database credentials — MySQL/MariaDB .my.cnf, PostgreSQL .pgpass, Redis requirepass, MongoDB mongod.conf, SQLite databases with credential tables",
    args: "",
  },
  vnc_password: {
    description: "Extract VNC passwords from ~/.vnc/passwd and config files — VNC uses weak DES encryption, passwords can be trivially decrypted",
    args: "[--decrypt]",
  },
  mail_spool_harvest: {
    description: "Scan mail spools and maildir for credentials — /var/mail/*, /var/spool/mail/*, password reset emails, API key notifications, credential sharing",
    args: "[--user USER]",
  },
  netrc_harvest: {
    description: "Extract credentials from ~/.netrc and ~/.netrc.gpg — FTP/HTTP stored login credentials with machine, login, password fields",
    args: "[--all-users]",
  },
  ldap_cred_harvest: {
    description: "Extract LDAP credentials — ldap.conf bind credentials, .ldaprc, sssd.conf, ldap_default_authtok, PAM LDAP module configs",
    args: "",
  },
  credential_files_scan: {
    description: "Broad credential file discovery — scan common locations for files containing passwords, API keys, tokens, certificates with private keys across the filesystem",
    args: "[--path PATH] [--depth DEPTH]",
  },
  sudo_misconfig: {
    description: "Analyze sudoers for privilege escalation — NOPASSWD entries, wildcard commands, env_keep abuse (LD_PRELOAD, LD_LIBRARY_PATH), sudo version CVE checks (Baron Samedit CVE-2021-3156, CVE-2023-22809)",
    args: "[--verbose]",
  },
  suid_sgid_scan: {
    description: "Find SUID/SGID binaries for privilege escalation — compare against GTFOBins database, detect custom SUID binaries, writable SUID paths, recently modified SUID files",
    args: "[--gtfobins-only]",
  },
  capabilities_abuse: {
    description: "Enumerate Linux capabilities for privilege escalation — find binaries with dangerous caps (cap_setuid, cap_net_raw, cap_dac_override, cap_sys_admin, cap_sys_ptrace), suggest exploitation paths",
    args: "[--exploitable-only]",
  },
  cron_privesc: {
    description: "Cron job privilege escalation — writable cron scripts, wildcard injection in cron commands, PATH manipulation, writable cron directories, anacron jobs",
    args: "[--verbose]",
  },
  nfs_no_root_squash: {
    description: "Find NFS shares with no_root_squash — allows creating SUID binaries on NFS mount as root for local privilege escalation on the NFS server",
    args: "",
  },
  path_hijack: {
    description: "PATH hijacking opportunities — writable directories in PATH before system dirs, scripts using relative paths, SUID/sudo programs with injectable PATH",
    args: "[--check-suid]",
  },
  ld_preload_abuse: {
    description: "LD_PRELOAD/LD_LIBRARY_PATH privilege escalation — check if sudo preserves LD_PRELOAD (env_keep), test SUID programs with preload, create malicious shared libraries",
    args: "[--payload PATH]",
  },
  kernel_exploit_check: {
    description: "Check kernel version against known exploits — DirtyPipe (CVE-2022-0847), DirtyCow (CVE-2016-5195), GameOver(lay) (CVE-2023-2640), OverlayFS (CVE-2023-0386), Netfilter (CVE-2023-32233), nftables (CVE-2024-1086)",
    args: "[--verbose]",
  },
  writable_passwd: {
    description: "Check if /etc/passwd or /etc/shadow is writable — direct root account creation by adding user with UID 0 or replacing root password hash",
    args: "[--exploit]",
  },
  pkexec_cve: {
    description: "Check for PwnKit (CVE-2021-4034) pkexec vulnerability — memory corruption in polkit's pkexec allows local privilege escalation to root on nearly all Linux distributions",
    args: "[--check-only]",
  },
  systemd_unit_abuse: {
    description: "Writable systemd unit files and drop-in directories — modify service ExecStart for code execution as root, writable timer units, socket-activated services",
    args: "[--verbose]",
  },
  dbus_exploit: {
    description: "D-Bus privilege escalation — enumerate accessible D-Bus services, check for PolicyKit bypass, find services with overly permissive D-Bus policies",
    args: "",
  },
  pip_setup_abuse: {
    description: "Python pip/setup.py privilege escalation — writable Python packages, egg-info directories, pip.conf manipulation, setup.py code execution during install",
    args: "",
  },
  shared_lib_hijack: {
    description: "Shared library hijacking — writable library directories in /etc/ld.so.conf.d/, missing libraries referenced by SUID binaries (RPATH/RUNPATH abuse), writable ld.so.cache",
    args: "",
  },
  logrotate_race: {
    description: "Logrotate race condition (CVE-2016-1247) — exploit logrotate's file creation behavior for privilege escalation when log directory is writable",
    args: "[--check-only]",
  },
  writable_service_bin: {
    description: "Find writable service binaries — services running as root with modifiable executable paths, replace binary for code execution on service restart",
    args: "",
  },
  polkit_bypass: {
    description: "Polkit/PolicyKit bypass checks — CVE-2021-3560 (race condition), CVE-2021-4034 (pkexec), check polkit rules for overly permissive actions",
    args: "",
  },
  snap_privesc: {
    description: "Snap package privilege escalation — dirty_sock exploit (CVE-2019-7304), writable snap directories, snap confinement bypass, outdated snapd versions",
    args: "",
  },
  docker_group_escape: {
    description: "Docker group privilege escalation — mount host root filesystem in container, run privileged container, docker.sock access for container escape to host root",
    args: "[--exploit]",
  },
  lxd_group_escape: {
    description: "LXD/LXC group privilege escalation — create privileged container mounting host filesystem, escape to host as root via container access",
    args: "[--exploit]",
  },
  python_lib_hijack: {
    description: "Python library hijacking — writable directories in sys.path, PYTHONPATH manipulation, writable site-packages, hijackable imports in SUID/sudo Python scripts",
    args: "",
  },
  motd_abuse: {
    description: "MOTD (Message of the Day) script abuse — writable scripts in /etc/update-motd.d/ execute as root on user login, inject commands for persistence or privilege escalation",
    args: "[--payload CMD]",
  },
  wildcard_injection: {
    description: "Wildcard injection in cron/scripts — tar, rsync, chown with wildcards allow filename-based argument injection (e.g., --checkpoint-action for tar code execution)",
    args: "[--scan-cron]",
  },
  mysql_udf: {
    description: "MySQL UDF (User Defined Function) privilege escalation — load malicious shared library via CREATE FUNCTION for OS command execution as the MySQL service user (often root)",
    args: "[--check-only]",
  },
  ptrace_scope_check: {
    description: "Check ptrace scope and process tracing restrictions — /proc/sys/kernel/yama/ptrace_scope, determines if process memory reading and debugging is allowed",
    args: "",
  },
  cron_persist: {
    description: "Cron-based persistence — add crontab entries, /etc/cron.d/ files, or anacron jobs for periodic payload execution as root or current user",
    args: "--payload CMD [--interval SPEC] [--user USER]",
  },
  systemd_persist: {
    description: "Systemd service persistence — create service/timer units for automatic payload execution on boot, on schedule, or triggered by events",
    args: "--name NAME --payload CMD [--timer SPEC] [--user]",
  },
  bashrc_persist: {
    description: "Shell RC file persistence — inject payload into .bashrc, .bash_profile, .profile, .zshrc, /etc/profile, /etc/bash.bashrc for execution on every shell session",
    args: "--payload CMD [--target user|system] [--shell bash|zsh|all]",
  },
  ssh_authorized_keys: {
    description: "SSH authorized_keys persistence — add attacker's public key to target user's authorized_keys for passwordless SSH access",
    args: "--key 'ssh-rsa AAAA...' [--user USER]",
  },
  ld_so_preload: {
    description: "/etc/ld.so.preload persistence — register a shared library that loads into every dynamically linked process on the system. Most powerful preload persistence, requires root",
    args: "--lib-path PATH",
  },
  sysvinit_persist: {
    description: "SysVinit /etc/init.d/ service persistence — create init script for boot-time execution on systems using traditional SysVinit (non-systemd)",
    args: "--name NAME --payload CMD",
  },
  at_job_persist: {
    description: "at(1) job persistence — schedule one-time or recurring command execution via atd. Less monitored than cron, useful for delayed execution",
    args: "--payload CMD [--time TIMESPEC]",
  },
  udev_rules_persist: {
    description: "Udev rules persistence — create rules in /etc/udev/rules.d/ that trigger payload on device events (USB insert, network interface up, etc.)",
    args: "--payload CMD [--trigger SUBSYSTEM]",
  },
  pam_backdoor: {
    description: "PAM backdoor — modify or add PAM module configuration for authentication bypass. Allows login with a master password or skip authentication entirely",
    args: "[--payload CMD] [--master-password PASS]",
  },
  motd_persist: {
    description: "MOTD script persistence — add executable script to /etc/update-motd.d/ that runs as root on every user login (SSH or local)",
    args: "--payload CMD [--name NAME]",
  },
  xdg_autostart: {
    description: "XDG autostart persistence — create .desktop entry in ~/.config/autostart/ or /etc/xdg/autostart/ for GUI session startup execution",
    args: "--payload CMD [--name NAME] [--system]",
  },
  git_hook_persist: {
    description: "Git hook persistence — install hooks (pre-commit, post-checkout, post-merge) in repositories that execute payload on git operations",
    args: "--payload CMD --repo PATH [--hook pre-commit|post-checkout|post-merge]",
  },
  kernel_module_persist: {
    description: "Kernel module persistence — install and configure kernel module to load on boot via /etc/modules or modprobe.d/ configuration",
    args: "--module PATH [--name NAME]",
  },
  apt_hook_persist: {
    description: "APT hook persistence — create hook in /etc/apt/apt.conf.d/ that executes payload on package install/update/remove operations (Debian/Ubuntu)",
    args: "--payload CMD [--trigger pre-install|post-install|pre-update]",
  },
  dpkg_trigger_persist: {
    description: "dpkg trigger persistence — create dpkg trigger that executes payload when specific packages are configured or updated (Debian/Ubuntu)",
    args: "--payload CMD [--package PACKAGE]",
  },
  socket_activation: {
    description: "Systemd socket-activated persistence — create socket unit that spawns service on incoming connection. Dormant until triggered, very stealthy",
    args: "--port PORT --payload CMD [--name NAME]",
  },
  user_service_persist: {
    description: "User-level systemd service persistence — create user service unit that persists without root. Runs in user context via systemctl --user",
    args: "--name NAME --payload CMD",
  },
  xinetd_persist: {
    description: "xinetd service persistence — create xinetd service entry that spawns payload on inbound TCP connection to configured port",
    args: "--payload CMD [--port PORT]",
  },
  rc_local_persist: {
    description: "/etc/rc.local boot-time persistence — add payload to rc.local for execution as root on system boot (pre-systemd or rc-local.service enabled)",
    args: "--payload CMD",
  },
  logrotate_persist: {
    description: "Logrotate postrotate script persistence — create logrotate config with postrotate script that executes during daily log rotation cycle as root",
    args: "--payload CMD",
  },
  ssh_rc_persist: {
    description: "SSH RC file persistence — create /etc/ssh/sshrc or ~/.ssh/rc that executes on every SSH login before the user shell starts",
    args: "--payload CMD",
  },
  ld_config_persist: {
    description: "/etc/ld.so.conf.d/ library path persistence — add custom library path so malicious .so files are loaded by dynamically linked processes",
    args: "--lib-path DIR",
  },
  ssh_pivot: {
    description: "SSH lateral movement — authenticate to remote hosts using harvested keys or credentials, establish reverse tunnels, forward ports for internal access",
    args: "--target HOST [--user USER] [--key PATH] [--password PASS] [--tunnel LOCAL:REMOTE]",
  },
  ansible_abuse: {
    description: "Ansible infrastructure exploitation — discover inventory, extract vault passwords, abuse ad-hoc commands and playbook execution for lateral movement to managed hosts",
    args: "[--action enum|exec] [--target HOST] [--command CMD]",
  },
  puppet_abuse: {
    description: "Puppet infrastructure exploitation — extract certificates, abuse puppet agent for code execution on managed nodes, modify manifests for persistent control",
    args: "[--action enum|exploit]",
  },
  salt_abuse: {
    description: "SaltStack exploitation — enumerate masters/minions, abuse salt-call/salt-api for remote command execution on managed infrastructure",
    args: "[--action enum|exec] [--target MINION] [--command CMD]",
  },
  nfs_mount_attack: {
    description: "NFS mount exploitation — mount accessible NFS shares, exploit no_root_squash for SUID binary creation, access sensitive files on remote shares",
    args: "--target HOST [--share PATH] [--exploit]",
  },
  rsync_exploit: {
    description: "Rsync exploitation — discover rsync services, enumerate modules, exploit anonymous/weak auth access to read/write remote files",
    args: "--target HOST [--module MODULE] [--action enum|read|write]",
  },
  ssh_tunnel: {
    description: "SSH tunneling — create local/remote/dynamic port forwards and SOCKS proxies through SSH for pivoting into internal network segments",
    args: "--target HOST --type local|remote|dynamic [--local-port PORT] [--remote-port PORT] [--user USER]",
  },
  socat_tunnel: {
    description: "Socat relay/tunnel creation — TCP/UDP relays, encrypted tunnels, port forwarding, reverse shells, file transfer via socat one-liners",
    args: "--action relay|reverse|bind [--listen PORT] [--target HOST:PORT]",
  },
  internal_scan: {
    description: "Internal network scanning — ping sweep, port scan, service detection using native tools (bash /dev/tcp, nc, nmap if available). No external tools required",
    args: "--target CIDR|HOST [--ports PORTS] [--sweep]",
  },
  proxychains_setup: {
    description: "Proxychains configuration — set up proxychains.conf for routing traffic through SOCKS/HTTP proxies, chain multiple pivots for deep internal access",
    args: "--proxy SOCKS5://HOST:PORT [--chain PROXY1,PROXY2]",
  },
  log_tamper: {
    description: "Log file tampering — selectively edit/remove entries from auth.log, syslog, wtmp, btmp, lastlog, audit.log. Surgical removal vs full clear",
    args: "--action selective|clear [--log auth|syslog|wtmp|btmp|lastlog|audit] [--pattern REGEX]",
  },
  history_clear: {
    description: "Shell history clearing — clear bash/zsh/fish history, in-memory history buffer, HISTFILE unset, .bash_history shredding, history timestamp removal",
    args: "[--all-users] [--shred]",
  },
  timestomp: {
    description: "File timestamp manipulation — modify atime/mtime/ctime to match legitimate files, clone timestamps from reference file, mass timestamp normalization",
    args: "--target PATH [--reference PATH] [--time 'YYYY-MM-DD HH:mm:ss']",
  },
  auditd_evade: {
    description: "Auditd evasion — disable auditd, modify audit rules, clear audit logs, kill auditd process, manipulate audit.log entries. Blind the Linux audit subsystem",
    args: "--action disable|clear|rules [--rule-file PATH]",
  },
  selinux_bypass: {
    description: "SELinux bypass/evasion — check mode (enforcing/permissive/disabled), set permissive temporarily, relabel files, exploit permissive domains, context transitions",
    args: "--action check|permissive|relabel [--domain DOMAIN]",
  },
  apparmor_bypass: {
    description: "AppArmor bypass — enumerate profiles and modes, set profile to complain mode, unload profiles, exploit unconfined processes, find bypass vectors",
    args: "--action check|complain|unload [--profile PROFILE]",
  },
  rootkit_detect: {
    description: "Rootkit detection scan — check for hidden processes (proc vs ps), hidden files, kernel module anomalies, syscall table hooks, /dev anomalies, chkrootkit/rkhunter style checks",
    args: "[--verbose]",
  },
  process_hide: {
    description: "Process hiding techniques — mount --bind over /proc/PID, LD_PRELOAD readdir hook, process name spoofing via prctl PR_SET_NAME, argv[0] modification",
    args: "--pid PID [--method bind|preload|rename] [--name FAKE_NAME]",
  },
  file_hide: {
    description: "File hiding — extended attributes, chattr +i (immutable), bind mount masking, .hidden file creation, inode manipulation for stealth file storage",
    args: "--target PATH [--method xattr|immutable|bind|hidden]",
  },
  network_hide: {
    description: "Network connection hiding — iptables REDIRECT/DROP rules to hide connections from netstat/ss, LD_PRELOAD hooks for getifaddrs/connect, raw socket traffic",
    args: "--port PORT [--method iptables|preload]",
  },
  syslog_manipulate: {
    description: "Syslog manipulation — inject fake log entries, redirect syslog to /dev/null, modify rsyslog/syslog-ng config, suppress specific log patterns",
    args: "--action inject|suppress|redirect [--message MSG] [--pattern REGEX]",
  },
  stealth_check_linux: {
    description: "Verify stealth modes are working — test base64/memfd/shm encoding execution, confirm commands execute without detection artifacts. Run before real operations",
    args: "[--mode base64|memfd|shm|all]",
  },
  data_stage: {
    description: "Stage data for exfiltration — compress, encrypt, split into chunks, create archives of target directories for efficient extraction",
    args: "--target PATH [--output PATH] [--encrypt PASSWORD] [--split SIZE]",
  },
  dns_tunnel_exfil: {
    description: "DNS-based data exfiltration — encode data in DNS queries as subdomain labels to attacker-controlled DNS server. Bypasses most firewalls and DLP",
    args: "--file PATH --domain DOMAIN [--chunk-size SIZE]",
  },
  icmp_exfil: {
    description: "ICMP-based data exfiltration — hide data in ICMP echo request payloads for covert extraction. Bypasses most egress filtering",
    args: "--file PATH --target HOST [--chunk-size SIZE]",
  },
  covert_channel: {
    description: "Covert channel setup — establish hidden communication channels via unused protocol fields, steganography, or timing-based encoding",
    args: "--type dns|icmp|http-header|timing --target HOST [--data PATH]",
  },
  https_exfil: {
    description: "HTTPS-based data exfiltration — POST/PUT data to attacker-controlled endpoint over encrypted channel. Blends with normal web traffic",
    args: "--file PATH --url URL [--method POST|PUT] [--chunk-size SIZE]",
  },
  cleanup_linux: {
    description: "Remove CyberStrike artifacts — clear shell history, clean log entries, remove temp files, restore modified configs, shred artifacts. ALWAYS run before leaving a target",
    args: "[--thorough]",
  },
  artifact_enum: {
    description: "Enumerate forensic artifacts — list files modified during engagement, track planted persistence mechanisms, identify cleanup targets",
    args: "[--since TIMESTAMP]",
  },
  steganography_exfil: {
    description: "Steganography-based exfiltration — hide data within image files (PNG/JPEG LSB encoding) for covert extraction that bypasses content inspection",
    args: "--data PATH --carrier IMAGE [--output PATH]",
  },
  arp_spoof: {
    description: "ARP spoofing/poisoning — impersonate gateway or target via ARP replies for man-in-the-middle positioning on local network segment",
    args: "--target IP --gateway IP [--interface IFACE] [--duration SECONDS]",
  },
  dns_spoof: {
    description: "DNS spoofing — respond to DNS queries with attacker-controlled IP addresses for MITM and phishing. Local network DNS poisoning",
    args: "--domain DOMAIN --ip IP [--interface IFACE]",
  },
  packet_capture: {
    description: "Network packet capture — sniff traffic with tcpdump/tshark, filter for credentials in cleartext protocols (FTP, HTTP Basic, Telnet, SMTP, POP3, IMAP)",
    args: "[--interface IFACE] [--filter EXPRESSION] [--duration SECONDS] [--output PCAP]",
  },
  port_scan_native: {
    description: "Native port scanning — TCP connect/SYN scan using bash /dev/tcp, nc, or nmap. No external tools required. Service banner grabbing",
    args: "--target HOST [--ports RANGE] [--method tcp|syn|banner]",
  },
  mitm_proxy: {
    description: "MITM proxy setup — transparent HTTP/HTTPS proxy with SSL interception for credential capture and traffic modification. Uses mitmproxy/bettercap",
    args: "--action setup|start|stop [--port PORT] [--ssl]",
  },
  responder_linux: {
    description: "LLMNR/NBT-NS/mDNS poisoning on Linux — capture NTLMv2 hashes from Windows clients on the same network segment via broadcast name resolution poisoning",
    args: "[--interface IFACE] [--duration SECONDS] [--protocols llmnr|nbtns|mdns|all]",
  },
  firewall_enum: {
    description: "Firewall rule enumeration — iptables/nftables/ufw/firewalld rules, zones, chains, NAT rules, port forwards, identify gaps and allowed egress",
    args: "[--verbose]",
  },
  traffic_redirect: {
    description: "Traffic redirection — iptables REDIRECT/DNAT for port forwarding, transparent proxy setup, traffic interception rules",
    args: "--from PORT --to HOST:PORT [--protocol tcp|udp]",
  },
  wifi_attack: {
    description: "WiFi attacks — deauth clients, capture WPA handshakes, evil twin AP setup, probe request monitoring, WiFi credential harvesting",
    args: "--action scan|deauth|capture|evil-twin [--interface IFACE] [--bssid BSSID] [--channel CH]",
  },
  detect_env: {
    description: "Detect Linux execution environment — shell type, bash/python3/perl/busybox availability, root status, kernel version, SELinux/AppArmor, container detection, init system, package manager. ALWAYS run before using --exec auto",
    args: "",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS

const dispatch: Record<Program, (args: string[], timeout: number) => Promise<HookResult>> = {
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
  data_stage: dataStage,
  dns_tunnel_exfil: dnsTunnelExfil,
  icmp_exfil: icmpExfil,
  covert_channel: covertChannel,
  https_exfil: httpsExfil,
  cleanup_linux: cleanupLinux,
  artifact_enum: artifactEnum,
  steganography_exfil: steganographyExfil,
  arp_spoof: arpSpoof,
  dns_spoof: dnsSpoof,
  packet_capture: packetCapture,
  port_scan_native: portScanNative,
  mitm_proxy: mitmProxy,
  responder_linux: responderLinux,
  firewall_enum: firewallEnum,
  traffic_redirect: trafficRedirect,
  wifi_attack: wifiAttack,
  detect_env: async (_args: string[], timeout: number): Promise<HookResult> => {
    const env = await detectEnv(timeout)
    const lines = [
      "=== LINUX EXECUTION ENVIRONMENT ===",
      "",
      `Shell: ${env.shell}`,
      `Bash: ${env.bashAvailable ? "YES" : "NO"}`,
      `Python3: ${env.python3Available ? "YES" : "NO"}`,
      `Perl: ${env.perlAvailable ? "YES" : "NO"}`,
      `Busybox: ${env.busyboxAvailable ? "YES" : "NO"}`,
      `Root: ${env.isRoot ? "YES (uid=0)" : `NO (uid=${env.uid})`}`,
      `Sudo: ${env.sudoAvailable ? "YES" : "NO"}${env.sudoNopasswd ? " (NOPASSWD)" : ""}`,
      `Kernel: ${env.kernelVersion}`,
      `Distro: ${env.distro}`,
      `SELinux: ${env.selinuxStatus}`,
      `AppArmor: ${env.apparmorStatus}`,
      `Container: ${env.inContainer ? `YES (${env.containerType})` : "NO"}`,
      `Init System: ${env.initSystem}`,
      `Package Manager: ${env.packageManager}`,
      "",
      `Recommended --exec method: ${resolveExec("auto", env)}`,
      "",
      "=== FALLBACK CHAIN ===",
      env.bashAvailable ? "1. bash [AVAILABLE]" : "1. bash [NOT FOUND]",
      env.python3Available ? "2. python3 [AVAILABLE]" : "2. python3 [NOT FOUND]",
      env.perlAvailable ? "3. perl [AVAILABLE]" : "3. perl [NOT FOUND]",
      env.busyboxAvailable ? "4. busybox [AVAILABLE]" : "4. busybox [NOT FOUND]",
      "5. sh (POSIX shell) [AVAILABLE]",
      "",
      "Use: linuxhook <program> --exec auto   (auto-select best method)",
      "Use: linuxhook <program> --exec bash   (force bash)",
      "Use: linuxhook <program> --exec sh     (force POSIX sh)",
    ]
    const findings: Finding[] = []
    if (!env.bashAvailable)
      findings.push({
        checkId: "LNX-ENV-001",
        provider: "linuxhook",
        severity: "MEDIUM",
        status: "WARN",
        resource: "bash",
        title: "Bash not available",
        details: "bash not found — many handlers require bash. Use --exec sh or --exec python3 for fallback.",
        remediation: "Use --exec auto for automatic fallback selection",
      })
    if (env.selinuxStatus === "enforcing")
      findings.push({
        checkId: "LNX-ENV-002",
        provider: "linuxhook",
        severity: "HIGH",
        status: "WARN",
        resource: "SELinux",
        title: "SELinux enforcing mode active",
        details: "SELinux is enforcing — many exploitation techniques will be blocked. Run selinux_bypass first.",
        remediation: "Use linuxhook selinux_bypass --action permissive",
      })
    if (env.apparmorStatus === "enabled")
      findings.push({
        checkId: "LNX-ENV-003",
        provider: "linuxhook",
        severity: "MEDIUM",
        status: "WARN",
        resource: "AppArmor",
        title: "AppArmor enabled",
        details: "AppArmor profiles may restrict operations. Check confined processes with apparmor_bypass.",
        remediation: "Use linuxhook apparmor_bypass --action check",
      })
    return { output: lines.join("\n"), findings }
  },
}

const CWE_MAP: Record<string, string> = {
  "LNX-SHADOW": "CWE-522",
  "LNX-SSH": "CWE-522",
  "LNX-SSHKEY": "CWE-522",
  "LNX-SSHRC": "CWE-269",
  "LNX-HIST": "CWE-312",
  "LNX-KEYRING": "CWE-522",
  "LNX-KWALLET": "CWE-522",
  "LNX-BROWSER": "CWE-312",
  "LNX-ENV": "CWE-312",
  "LNX-PROCMEM": "CWE-316",
  "LNX-GPG": "CWE-522",
  "LNX-CLOUD": "CWE-312",
  "LNX-DOCKER": "CWE-312",
  "LNX-GIT": "CWE-522",
  "LNX-WIFI": "CWE-312",
  "LNX-KRB": "CWE-522",
  "LNX-DB": "CWE-522",
  "LNX-VNC": "CWE-522",
  "LNX-MAIL": "CWE-312",
  "LNX-NETRC": "CWE-522",
  "LNX-LDAP": "CWE-522",
  "LNX-CRED": "CWE-522",
  "LNX-SUDO": "CWE-269",
  "LNX-SUID": "CWE-269",
  "LNX-CAP": "CWE-269",
  "LNX-CRON": "CWE-269",
  "LNX-NFS": "CWE-269",
  "LNX-PATH": "CWE-426",
  "LNX-PRELOAD": "CWE-426",
  "LNX-KERNEL": "CWE-269",
  "LNX-PASSWD": "CWE-732",
  "LNX-PKEXEC": "CWE-787",
  "LNX-SYSTEMD": "CWE-269",
  "LNX-DBUS": "CWE-269",
  "LNX-PIP": "CWE-426",
  "LNX-SHLIB": "CWE-426",
  "LNX-LOGROT": "CWE-362",
  "LNX-SVCBIN": "CWE-732",
  "LNX-POLKIT": "CWE-269",
  "LNX-SNAP": "CWE-269",
  "LNX-DKRGRP": "CWE-269",
  "LNX-LXDGRP": "CWE-269",
  "LNX-PYLIB": "CWE-426",
  "LNX-MOTD": "CWE-269",
  "LNX-WILDCARD": "CWE-78",
  "LNX-MYSQL": "CWE-78",
  "LNX-PTRACE": "CWE-693",
  "LNX-PERSIST": "CWE-269",
  "LNX-BASHRC": "CWE-269",
  "LNX-AUTHKEY": "CWE-269",
  "LNX-LDSOPRELOAD": "CWE-426",
  "LNX-SYSVINIT": "CWE-269",
  "LNX-ATJOB": "CWE-269",
  "LNX-UDEV": "CWE-269",
  "LNX-PAM": "CWE-287",
  "LNX-XDG": "CWE-269",
  "LNX-GITHOOK": "CWE-269",
  "LNX-KMOD": "CWE-269",
  "LNX-APT": "CWE-269",
  "LNX-DPKG": "CWE-269",
  "LNX-SOCKET": "CWE-269",
  "LNX-USERSVC": "CWE-269",
  "LNX-XINETD": "CWE-269",
  "LNX-RCLOCAL": "CWE-269",
  "LNX-LDCONF": "CWE-426",
  "LNX-PIVOT": "CWE-918",
  "LNX-ANSIBLE": "CWE-78",
  "LNX-PUPPET": "CWE-78",
  "LNX-SALT": "CWE-78",
  "LNX-NFSMOUNT": "CWE-269",
  "LNX-RSYNC": "CWE-284",
  "LNX-TUNNEL": "CWE-918",
  "LNX-SOCAT": "CWE-918",
  "LNX-SCAN": "CWE-200",
  "LNX-PROXY": "CWE-918",
  "LNX-LOGTAMP": "CWE-1254",
  "LNX-HISTCLEAR": "CWE-1254",
  "LNX-TIMESTOMP": "CWE-1254",
  "LNX-AUDITD": "CWE-693",
  "LNX-SELINUX": "CWE-693",
  "LNX-APPARMOR": "CWE-693",
  "LNX-ROOTKIT": "CWE-506",
  "LNX-PROCHIDE": "CWE-693",
  "LNX-FILEHIDE": "CWE-693",
  "LNX-NETHIDE": "CWE-693",
  "LNX-SYSLOG": "CWE-1254",
  "LNX-STEALTH": "CWE-693",
  "LNX-STAGE": "CWE-200",
  "LNX-DNSTUN": "CWE-200",
  "LNX-ICMP": "CWE-200",
  "LNX-COVERT": "CWE-200",
  "LNX-HTTPS": "CWE-200",
  "LNX-CLEANUP": "CWE-1254",
  "LNX-ARTIFACT": "CWE-200",
  "LNX-STEGO": "CWE-200",
  "LNX-ARP": "CWE-350",
  "LNX-DNS": "CWE-350",
  "LNX-PCAP": "CWE-319",
  "LNX-PORTSCAN": "CWE-200",
  "LNX-MITM": "CWE-300",
  "LNX-RESPONDER": "CWE-350",
  "LNX-FW": "CWE-200",
  "LNX-REDIR": "CWE-918",
  "LNX-WIFIATK": "CWE-300",
  "LNX-RECON": "CWE-200",
  "LNX-PROC": "CWE-200",
  "LNX-NET": "CWE-200",
  "LNX-USER": "CWE-200",
  "LNX-SVC": "CWE-200",
  "LNX-PKG": "CWE-200",
  "LNX-CONTAINER": "CWE-200",
  "LNX-SECFW": "CWE-200",
  "LNX-FILES": "CWE-200",
  "LNX-MOUNT": "CWE-200",
  "LNX-KMODINFO": "CWE-200",
  "LNX-EXFIL": "CWE-200",
}

function resolveCwe(checkId: string): string | undefined {
  for (const prefix of Object.keys(CWE_MAP).sort((a, b) => b.length - a.length)) {
    if (checkId.startsWith(prefix)) return CWE_MAP[prefix]
  }
  return undefined
}

const BASH_FAILURE_PATTERNS = [
  "command not found",
  "No such file or directory",
  "Permission denied",
  "not found",
  "syntax error",
  "bash: ",
  "sh: ",
]

function isBashFailure(output: string): boolean {
  if (output.length === 0) return true
  const lower = output.toLowerCase()
  return BASH_FAILURE_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}

export const LinuxhookTool = Tool.define("linuxhook", {
  description: `Execute a Linux post-exploitation program. Covers recon (system/process/network/user/service/package enumeration), credential harvesting (shadow, SSH keys, history secrets, keyrings, browser creds, cloud creds, GPG, database), privilege escalation (sudo, SUID/SGID, capabilities, kernel exploits, Docker/LXD group escape, writable services, polkit), persistence (cron, systemd, bashrc, SSH keys, ld.so.preload, PAM, udev, xinetd, rc.local), lateral movement (SSH pivot, Ansible/Puppet/Salt abuse, NFS, rsync, tunneling), evasion (log tamper, history clear, timestomp, auditd/SELinux/AppArmor bypass, rootkit detection), network attacks (ARP/DNS spoof, packet capture, port scan, MITM, responder), and exfiltration (DNS tunnel, ICMP, HTTPS, steganography). ALWAYS run detect_env first. ALWAYS run cleanup_linux before leaving. Available programs: ${Object.keys(PROGRAMS).join(", ")}`,
  parameters: z.object({
    program: z
      .enum(Object.keys(PROGRAMS) as [string, ...string[]])
      .describe("Program name. Run with no args to see usage. Full list in tool description."),
    args: z
      .array(z.string())
      .describe(
        "Arguments to pass to the program. Use --stealth <mode> for evasion: base64 (base64 encoded command), memfd (memory-only execution via memfd_create), shm (/dev/shm execution). Use --exec <method> for execution engine: bash (default), sh (POSIX), python3, perl, busybox, auto (detect best available)",
      ),
    timeout_seconds: z.number().optional().default(120).describe("Maximum execution time in seconds (default: 120)"),
  }),
  async execute(params) {
    if (process.platform !== "linux") {
      return {
        title: `linuxhook: ${params.program}`,
        output: `linuxhook requires Linux. Current platform: ${process.platform}\n\nUse 'winhook' for Windows post-exploitation or 'machook' for macOS.`,
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

    const envChangingPrograms = new Set(["selinux_bypass", "apparmor_bypass", "auditd_evade"])
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
