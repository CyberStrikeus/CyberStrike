import { AgentV2 } from "@cyberstrike-io/core/agent"
import { AISDK } from "@cyberstrike-io/core/aisdk"
import { Catalog } from "@cyberstrike-io/core/catalog"
import { CommandV2 } from "@cyberstrike-io/core/command"
import { Credential } from "@cyberstrike-io/core/credential"
import { AppNodeBuilder } from "@cyberstrike-io/core/effect/app-node-builder"
import { LayerNodePlatform } from "@cyberstrike-io/core/effect/app-node-platform"
import { LayerNode } from "@cyberstrike-io/core/effect/layer-node"
import { EventV2 } from "@cyberstrike-io/core/event"
import { FileSystem } from "@cyberstrike-io/core/filesystem"
import { FSUtil } from "@cyberstrike-io/core/fs-util"
import { Integration } from "@cyberstrike-io/core/integration"
import { Location } from "@cyberstrike-io/core/location"
import { Npm } from "@cyberstrike-io/core/npm"
import { PluginV2 } from "@cyberstrike-io/core/plugin"
import { Reference } from "@cyberstrike-io/core/reference"
import { SkillV2 } from "@cyberstrike-io/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
