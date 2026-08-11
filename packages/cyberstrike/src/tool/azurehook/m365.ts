import { az, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function exchangeAbuse(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Exchange Online configuration...\n"]

  const mailboxes = await az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/users${target ? `/${target}` : ""}?$select=displayName,userPrincipalName,mail&$top=100`], undefined, timeout)
  if (mailboxes.exitCode === 0) {
    const data = tryJson(mailboxes.stdout)
    const users = data?.value || (data?.userPrincipalName ? [data] : [])
    output.push(`[*] Users with mailboxes: ${users.length}`)

    for (const user of users.slice(0, 20)) {
      const rules = await az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/users/${user.userPrincipalName}/mailFolders/inbox/messageRules`], undefined, timeout)
      if (rules.exitCode === 0) {
        const ruleList = tryJson(rules.stdout)?.value || []
        const forwarding = ruleList.filter((r: Record<string, unknown>) => {
          const actions = r.actions as Record<string, unknown[]> | undefined
          return actions?.forwardTo?.length || actions?.redirectTo?.length
        })
        if (forwarding.length > 0) {
          findings.push({
            checkId: "AZ-M365-001",
            provider: "azure-m365",
            severity: "critical",
            status: "FAIL",
            resource: `exchange://${user.userPrincipalName}`,
            title: `Mail forwarding rules: ${user.userPrincipalName}`,
            details: `${forwarding.length} forwarding/redirect rules found — potential exfiltration`,
            remediation: "Review and remove unauthorized mail forwarding rules",
          })
          output.push(`  [!] ${user.userPrincipalName}: ${forwarding.length} forwarding rules`)
        }

        const suspicious = ruleList.filter((r: Record<string, unknown>) => {
          const actions = r.actions as Record<string, unknown> | undefined
          return actions?.moveToFolder || actions?.delete
        })
        if (suspicious.length > 0) {
          findings.push({
            checkId: "AZ-M365-002",
            provider: "azure-m365",
            severity: "high",
            status: "FAIL",
            resource: `exchange://${user.userPrincipalName}/rules`,
            title: `Suspicious mail rules (hide/delete): ${user.userPrincipalName}`,
            details: `${suspicious.length} rules that move or delete emails — used to hide attacker activity`,
            remediation: "Review rules that automatically delete or move emails",
          })
        }
      }

      const delegates = await az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/users/${user.userPrincipalName}/mailboxSettings`], undefined, timeout)
      if (delegates.exitCode === 0) {
        const settings = tryJson(delegates.stdout)
        const autoForward = settings?.automaticRepliesSetting?.externalReplyMessage
        if (settings?.delegateMeetingMessageDeliveryOptions === "sendToDelegateAndInformationToPrincipal") {
          output.push(`  [!] ${user.userPrincipalName}: delegation enabled`)
        }
      }
    }
  } else {
    output.push("[-] Could not access Exchange Online (Graph API permissions required)")
    output.push("    Required: Mail.Read, MailboxSettings.Read")
  }

  const transport = await az(["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/organization?$select=verifiedDomains"], undefined, timeout)
  if (transport.exitCode === 0) {
    const org = tryJson(transport.stdout)
    const domains = org?.value?.[0]?.verifiedDomains || []
    output.push(`\n[*] Verified domains: ${domains.map((d: Record<string, string>) => d.name).join(", ")}`)
  }

  return { output: output.join("\n"), findings }
}

export async function sharepointEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating SharePoint Online sites...\n"]

  const sites = await az(["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/sites?search=*&$top=100&$select=displayName,webUrl,isPersonalSite"], undefined, timeout)
  if (sites.exitCode !== 0) {
    return { output: "[-] Could not access SharePoint (Graph API permissions: Sites.Read.All)", findings }
  }

  const siteList = tryJson(sites.stdout)?.value || []
  output.push(`[*] SharePoint sites: ${siteList.length}\n`)

  for (const site of siteList.slice(0, 20)) {
    output.push(`[*] ${site.displayName} — ${site.webUrl}`)

    const perms = await az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/sites/${site.id}/permissions`], undefined, timeout)
    if (perms.exitCode === 0) {
      const permList = tryJson(perms.stdout)?.value || []
      const guestPerms = permList.filter((p: Record<string, unknown>) => {
        const granted = p.grantedToV2 as Record<string, Record<string, string>> | undefined
        const inv = p.invitation as Record<string, string> | undefined
        return granted?.user?.email?.includes("#ext#") || inv?.email
      })
      if (guestPerms.length > 0) {
        findings.push({
          checkId: "AZ-SP-001",
          provider: "azure-m365",
          severity: "medium",
          status: "FAIL",
          resource: `sharepoint://${site.displayName}`,
          title: `External sharing: ${site.displayName}`,
          details: `${guestPerms.length} external/guest permissions on site`,
          remediation: "Review external sharing permissions and remove unnecessary access",
        })
        output.push(`  [!] ${guestPerms.length} external permissions`)
      }
    }

    const drives = await az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/sites/${site.id}/drives`], undefined, timeout)
    if (drives.exitCode === 0) {
      const driveList = tryJson(drives.stdout)?.value || []
      for (const drive of driveList) {
        output.push(`  [*] Drive: ${drive.name} (${drive.driveType}) — ${Math.round((drive.quota?.used || 0) / 1024 / 1024)}MB used`)
      }
    }
  }

  const sharing = await az(["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/admin/sharepoint/settings"], undefined, timeout)
  if (sharing.exitCode === 0) {
    const settings = tryJson(sharing.stdout)
    if (settings) {
      const sharingLevel = settings.sharingCapability || "unknown"
      output.push(`\n[*] Tenant sharing level: ${sharingLevel}`)
      if (sharingLevel === "ExternalUserAndGuestSharing" || sharingLevel === "ExternalUserSharingOnly") {
        findings.push({
          checkId: "AZ-SP-002",
          provider: "azure-m365",
          severity: "high",
          status: "FAIL",
          resource: "sharepoint://tenant-settings",
          title: `External sharing enabled: ${sharingLevel}`,
          details: "SharePoint allows external sharing — data exfiltration risk via shared links",
          remediation: "Restrict sharing to authenticated guests or internal only",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function teamsEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Microsoft Teams...\n"]

  const teams = await az(["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/groups?$filter=resourceProvisioningOptions/any(x:x eq 'Team')&$select=displayName,id,visibility,mailNickname&$top=100"], undefined, timeout)
  if (teams.exitCode !== 0) {
    return { output: "[-] Could not access Teams (Graph API permissions: Group.Read.All, Team.ReadBasic.All)", findings }
  }

  const teamList = tryJson(teams.stdout)?.value || []
  output.push(`[*] Teams: ${teamList.length}\n`)

  let publicCount = 0
  for (const team of teamList) {
    const visibility = team.visibility || "Unknown"
    if (visibility === "Public") publicCount++
    output.push(`[*] ${team.displayName} (${visibility})`)

    const channels = await az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/teams/${team.id}/channels?$select=displayName,membershipType`], undefined, timeout)
    if (channels.exitCode === 0) {
      const channelList = tryJson(channels.stdout)?.value || []
      const sharedChannels = channelList.filter((c: Record<string, string>) => c.membershipType === "shared")
      if (sharedChannels.length > 0) {
        output.push(`  [!] ${sharedChannels.length} shared channels (cross-tenant)`)
      }
      output.push(`  [*] Channels: ${channelList.length}`)
    }

    const members = await az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/groups/${team.id}/members?$select=displayName,userType&$top=999`], undefined, timeout)
    if (members.exitCode === 0) {
      const memberList = tryJson(members.stdout)?.value || []
      const guests = memberList.filter((m: Record<string, string>) => m.userType === "Guest")
      if (guests.length > 0) {
        findings.push({
          checkId: "AZ-TEAMS-001",
          provider: "azure-m365",
          severity: "medium",
          status: "FAIL",
          resource: `teams://${team.displayName}`,
          title: `Guest members in team: ${team.displayName}`,
          details: `${guests.length} guest users have access to team content`,
          remediation: "Review guest access and remove unnecessary external members",
        })
        output.push(`  [!] ${guests.length} guest members`)
      }
    }

    const apps = await az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/teams/${team.id}/installedApps?$expand=teamsAppDefinition`], undefined, timeout)
    if (apps.exitCode === 0) {
      const appList = tryJson(apps.stdout)?.value || []
      const thirdParty = appList.filter((a: Record<string, Record<string, string>>) => a.teamsAppDefinition?.publishingState === "published" && a.teamsAppDefinition?.teamsAppId)
      if (thirdParty.length > 0) {
        output.push(`  [*] Installed apps: ${thirdParty.length}`)
      }
    }
  }

  if (publicCount > 0) {
    findings.push({
      checkId: "AZ-TEAMS-002",
      provider: "azure-m365",
      severity: "medium",
      status: "FAIL",
      resource: "teams://public",
      title: `${publicCount} public teams — anyone in org can join`,
      details: "Public teams allow any org member to access content without invitation",
      remediation: "Review public teams and change to Private where appropriate",
    })
  }

  output.push(`\n[*] Summary: ${teamList.length} teams, ${publicCount} public`)
  return { output: output.join("\n"), findings }
}

export async function onedriveAccess(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating OneDrive access...\n"]

  const users = target
    ? [{ userPrincipalName: target }]
    : await az(["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/users?$select=userPrincipalName,displayName&$top=20"], undefined, timeout).then(r => r.exitCode === 0 ? (tryJson(r.stdout)?.value || []) : [])

  output.push(`[*] Checking OneDrive for ${users.length} users\n`)

  for (const user of users) {
    const upn = user.userPrincipalName
    const drive = await az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/users/${upn}/drive`], undefined, timeout)
    if (drive.exitCode !== 0) {
      output.push(`[-] ${upn}: no access / no OneDrive`)
      continue
    }

    const driveData = tryJson(drive.stdout)
    const used = Math.round((driveData?.quota?.used || 0) / 1024 / 1024)
    const total = Math.round((driveData?.quota?.total || 0) / 1024 / 1024 / 1024)
    output.push(`[*] ${upn}: ${used}MB / ${total}GB`)

    const root = await az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/users/${upn}/drive/root/children?$select=name,size,file,folder,shared,lastModifiedDateTime&$top=50`], undefined, timeout)
    if (root.exitCode === 0) {
      const items = tryJson(root.stdout)?.value || []
      for (const item of items) {
        const size = item.size ? `(${Math.round(item.size / 1024)}KB)` : ""
        const shared = item.shared ? " [SHARED]" : ""
        output.push(`    ${item.folder ? "📁" : "📄"} ${item.name} ${size}${shared}`)
      }

      const sharedItems = items.filter((i: Record<string, unknown>) => i.shared)
      if (sharedItems.length > 0) {
        findings.push({
          checkId: "AZ-OD-001",
          provider: "azure-m365",
          severity: "medium",
          status: "INFO",
          resource: `onedrive://${upn}`,
          title: `${sharedItems.length} shared items in OneDrive: ${upn}`,
          details: `OneDrive contains ${sharedItems.length} shared files/folders — review sharing permissions`,
          remediation: "Review shared items and remove unnecessary sharing links",
        })
      }
    }

    const sharedWithMe = await az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/users/${upn}/drive/sharedWithMe?$top=20`], undefined, timeout)
    if (sharedWithMe.exitCode === 0) {
      const shared = tryJson(sharedWithMe.stdout)?.value || []
      if (shared.length > 0) {
        output.push(`  [*] Shared with this user: ${shared.length} items`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}
