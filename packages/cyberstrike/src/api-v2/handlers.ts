import { Layer } from "effect"
import { AgentHandler } from "./handlers/agent"
import { CommandHandler } from "./handlers/command"
import { ConfigHandler } from "./handlers/config"
import { CredentialHandler } from "./handlers/credential"
import { DebugHandler } from "./handlers/debug"
import { EventHandler } from "./handlers/event"
import { ExperimentalHandler } from "./handlers/experimental"
import { FormHandler } from "./handlers/form"
import { FsHandler } from "./handlers/fs"
import { GenerateHandler } from "./handlers/generate"
import { IntegrationHandler } from "./handlers/integration"
import { LocationHandler } from "./handlers/location"
import { McpHandler } from "./handlers/mcp"
import { MessageHandler } from "./handlers/message"
import { MigrationHandler } from "./handlers/migration"
import { ModelHandler } from "./handlers/model"
import { PermissionHandler } from "./handlers/permission"
import { PluginHandler } from "./handlers/plugin"
import { ProjectHandler } from "./handlers/project"
import { ProviderHandler } from "./handlers/provider"
import { PtyHandler } from "./handlers/pty"
import { ReferenceHandler } from "./handlers/reference"
import { RpcHandler } from "./handlers/rpc"
import { ServerHandler } from "./handlers/server"
import { SessionHandler } from "./handlers/session"
import { ShellHandler } from "./handlers/shell"
import { SkillHandler } from "./handlers/skill"
import { VcsHandler } from "./handlers/vcs"
import { VoiceHandler } from "./handlers/voice"
import { WebsearchHandler } from "./handlers/websearch"
import { WorktreeHandler } from "./handlers/worktree"

// Every upstream group has exactly one handler layer; the group id in each file must match its _tag.
export const handlers = Layer.mergeAll(
  AgentHandler,
  CommandHandler,
  ConfigHandler,
  CredentialHandler,
  DebugHandler,
  EventHandler,
  ExperimentalHandler,
  FormHandler,
  FsHandler,
  GenerateHandler,
  IntegrationHandler,
  LocationHandler,
  McpHandler,
  MessageHandler,
  MigrationHandler,
  ModelHandler,
  PermissionHandler,
  PluginHandler,
  ProjectHandler,
  ProviderHandler,
  PtyHandler,
  ReferenceHandler,
  RpcHandler,
  ServerHandler,
  SessionHandler,
  ShellHandler,
  SkillHandler,
  VcsHandler,
  VoiceHandler,
  WebsearchHandler,
  WorktreeHandler,
)
