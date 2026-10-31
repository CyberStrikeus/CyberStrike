import { describe, expect, it } from "vitest";

import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
  timedCaptureEvidence,
} from "../../../tests/fixtures/analysisView.js";
import {
  scenarioHeaderOnlyCaptureEvidence,
  scenarioServeFixture,
} from "../../../tests/fixtures/browserScenarioCapture.js";
import {
  environmentServeFixture,
  environmentServeSource,
  environmentStateServeFixture,
  environmentStateServeInputs,
} from "../../../tests/fixtures/environmentServe.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import {
  inspectAnalysisView,
  inspectAnalysisViewValidated,
} from "../analysisView/AnalysisViewService.js";
import { loadEnvironmentSource } from "./environmentSource.js";
import {
  admitServedState,
  deriveEnvironmentState,
  loadEnvironmentState,
  prepareServedState,
} from "./environmentState.js";
import {
  STATE_INTAKE_LIMIT_BYTES,
  parseStateDocument,
} from "./environmentStateDocument.js";
import {
  EnvironmentStateStore,
  ENVIRONMENT_COLLECTION_HISTORY_LIMIT_BYTES,
} from "./environmentStateStore.js";

const fixture = environmentStateServeFixture();
const { source, state } = environmentStateServeInputs(fixture);

const refusal = (value: unknown, from = source) => {
  const loaded = loadEnvironmentState(value, from);
  if (loaded.ok) throw new Error("Expected the state to be refused");
  return projectAnalysisError(loaded.error);
};

interface Editable {
  rea_state: Record<string, unknown> & {
    entities: Record<string, unknown>[];
    documents: unknown[];
  };
}

/** The served state as a rea-state/v1 document, changed by `edit`. */
const documentWith = (edit: (document: Editable) => void): Editable => {
  const document = structuredClone(
    new EnvironmentStateStore(state).snapshot(),
  ) as unknown as Editable;
  edit(document);
  return document;
};

/** The pointer and message of the first problem the store reports. */
const firstProblem = (document: unknown) => {
  const store = new EnvironmentStateStore(state);
  const replaced = store.replace(document);
  if (replaced.ok) throw new Error("Expected the document to be refused");
  const [issue] = replaced.error.issues;
  return { path: issue?.path.join("/"), message: issue?.message };
};

describe("loadEnvironmentState", () => {
  it("loads the state extracted from the served capture with the manifest's rules", () => {
    expect(state.evidenceId).toBe(fixture.state.evidence_id);
    expect(state.views.get("get_users_by_id")).toMatchObject({
      shape: "item",
      envelope_ordinal: 5,
    });
    expect(state.types.map((type) => type.collection_template)).toContain(
      "/api/folders",
    );
    expect(state.entities.length).toBeGreaterThan(0);
  });

  it("refuses non-Evidence JSON, another view kind, another capture's state and other template rules", async () => {
    const notEvidence = loadEnvironmentState({}, source);
    if (notEvidence.ok || !(notEvidence.error instanceof AnalysisInputError))
      throw new Error("Expected an input refusal");
    expect(notEvidence.error.issues.length).toBeGreaterThan(0);
    expect(
      notEvidence.error.issues.every((issue) => issue.path[0] === "state"),
    ).toBe(true);
    expect(refusal(fixture.manifest)).toMatchObject({
      details: {
        issues: [
          {
            path: ["state", "normalized_result", "kind"],
            expected: "environment-state",
          },
        ],
      },
    });
    const otherCapture = analysisViewCaptureEvidence(
      environmentManifestCaptureFixture(),
    );
    const other = environmentStateServeFixture(otherCapture);
    expect(refusal(other.state)).toMatchObject({
      details: {
        issues: [
          {
            path: ["state", "normalized_result", "parent_evidence_id"],
            expected: source.evidenceId,
          },
        ],
      },
    });
    const ruleless = await inspectAnalysisView({
      source: { kind: "inline", evidence: fixture.capture },
      view: { kind: "environment-state", template_rules: [] },
    });
    if (!ruleless.ok) throw ruleless.error;
    const refused = refusal(ruleless.value);
    expect(refused).toMatchObject({
      details: {
        issues: [
          { path: ["state", "normalized_result", "view", "template_rules"] },
        ],
      },
    });
    expect(refused.message).toContain("different template rules");
  });

  it("refuses a state whose views name a tool the manifest lacks", () => {
    const narrowed = {
      ...source,
      manifest: {
        ...source.manifest,
        tools: source.manifest.tools.filter(
          (tool) => tool.name !== "get_users_by_id",
        ),
      },
    };
    const index = [...state.views.keys()].indexOf("get_users_by_id");
    expect(refusal(fixture.state, narrowed)).toMatchObject({
      details: {
        issues: [
          { path: ["state", "normalized_result", "views", index, "tool"] },
        ],
      },
    });
    // A manifest of another capture is refused by the parent check before any tool is compared.
    expect(
      loadEnvironmentState(fixture.state, environmentServeSource()).ok,
    ).toBe(false);
  });
});

describe("served collection history", () => {
  it("bounds distinct paths added after reset while retaining baseline paths", () => {
    const original = state.entities[0];
    if (original === undefined) throw new Error("Expected a seeded entity");
    const run = () => {
      const store = new EnvironmentStateStore(state);
      for (let index = 0; index < 2000; index += 1) {
        const collection = `/api/history/${String(index)}-${"x".repeat(900)}`;
        const id = `history-${String(index)}`;
        const before = JSON.stringify(store.snapshot());
        const result = store.insert({ ...original, collection, id }, 0);
        if (!result.ok) {
          expect(JSON.stringify(store.snapshot())).toBe(before);
          expect(result.error).toMatchObject({
            resource: "capacity",
            retryable: false,
            remediationAction: expect.stringContaining("fewer distinct"),
          });
          expect(result.error.reason).toContain("accounting budget");
          return result.error.reportedLimits;
        }
        const inserted = store.entity(original.type, collection, id);
        if (inserted === undefined) throw new Error("Expected inserted entity");
        store.remove(inserted);
      }
      throw new Error("Expected a history budget refusal");
    };
    const refused = run();
    if (refused === null)
      throw new Error("Expected reported history budget details");
    expect(refused).toEqual(run());
    expect(refused).toMatchObject({
      max_collection_history_bytes: ENVIRONMENT_COLLECTION_HISTORY_LIMIT_BYTES,
    });
    expect(refused.collection_history_bytes).toBeGreaterThan(
      ENVIRONMENT_COLLECTION_HISTORY_LIMIT_BYTES,
    );
  });

  it("does not charge a deleted loaded collection again at the history limit", () => {
    const original = state.entities[0];
    if (original === undefined) throw new Error("Expected a seeded entity");
    const loadedState = {
      ...state,
      entities: Array.from({ length: 1200 }, (_, index) => ({
        ...original,
        collection: `/api/loaded/${String(index)}-${"y".repeat(80)}`,
        id: `loaded-${String(index)}`,
      })),
    };
    const store = new EnvironmentStateStore(loadedState);
    for (const entity of store.ofType(original.type)) store.remove(entity);
    expect(store.knownCollectionsOf(original.type)).toHaveLength(1200);

    const baseline = loadedState.entities[0];
    if (baseline === undefined) throw new Error("Expected a loaded entity");
    let refused = false;
    for (let index = 0; index < 2000; index += 1) {
      const collection = `/api/generated/${String(index)}-${"z".repeat(900)}`;
      const entity = {
        ...original,
        collection,
        id: `generated-${String(index)}`,
      };
      const inserted = store.insert(entity, 0);
      if (!inserted.ok) {
        refused = true;
        break;
      }
      const held = store.entity(entity.type, collection, entity.id);
      if (held === undefined) throw new Error("Expected generated entity");
      store.remove(held);
    }
    expect(refused).toBe(true);

    const restored = store.insert(baseline, 0);
    expect(restored.ok).toBe(true);
    expect(
      store.entity(baseline.type, baseline.collection, baseline.id),
    ).toEqual(baseline);
  });
});

describe("deriveEnvironmentState", () => {
  it("derives the state inspect-analysis-view projects from the capture with the manifest's rules, under the same Evidence id", () => {
    const derived = deriveEnvironmentState(source, fixture.capture);
    if (!derived.ok) throw derived.error;
    expect(derived.value.evidenceId).toBe(fixture.state.evidence_id);
    expect(derived.value).toEqual(state);
  });

  it("checks the derived state as a supplied one, refusing a capture the manifest was not projected from", () => {
    const other = environmentServeFixture();
    const derived = deriveEnvironmentState(source, other.capture);
    if (derived.ok)
      throw new Error("Expected the other capture's state to be refused");
    expect(projectAnalysisError(derived.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["state", "normalized_result", "parent_evidence_id"],
            expected: source.evidenceId,
          },
        ],
      },
    });
  });

  it("projects the authenticated capture as retained Evidence, so a capture inline admission refuses still yields its state", async () => {
    const capture = timedCaptureEvidence(
      Array.from({ length: 20 }, (_, index) => [
        "GET",
        `/api/items/${String(index)}`,
        { id: index, text: "x".repeat(200_000) },
      ]),
    );
    const inline = await inspectAnalysisView({
      source: { kind: "inline", evidence: capture },
      view: { kind: "environment-state", template_rules: [] },
    });
    if (inline.ok) throw new Error("Expected inline admission to refuse");
    expect(projectAnalysisError(inline.error).code).toBe("resource_constraint");
    const retained = (kind: "environment-manifest" | "environment-state") =>
      inspectAnalysisViewValidated(
        {
          source: {
            kind: "retained-evidence",
            evidence_id: capture.evidence_id,
          },
          view:
            kind === "environment-state"
              ? { kind, template_rules: [] }
              : {
                  kind,
                  template_rules: [],
                  include_query_parameter_names: true,
                },
        },
        (id) => (id === capture.evidence_id ? capture : undefined),
      );
    const manifest = retained("environment-manifest");
    if (!manifest.ok) throw manifest.error;
    const large = loadEnvironmentSource(manifest.value, capture);
    if (!large.ok) throw large.error;
    const derived = deriveEnvironmentState(large.value, capture);
    if (!derived.ok) throw derived.error;
    const byHand = retained("environment-state");
    if (!byHand.ok) throw byHand.error;
    expect(derived.value.evidenceId).toBe(byHand.value.evidence_id);
  });
});

describe("prepareServedState", () => {
  it("reports the served state Evidence", () => {
    expect(prepareServedState(source, fixture.capture)).toEqual({
      state,
      report: { served: true, evidence_id: fixture.state.evidence_id },
    });
  });

  it("derives a state when a body leaves no room for the state's own nesting", () => {
    let deep: JsonValue = { theme: "dark" };
    for (let level = 0; level < 995; level += 1) deep = { nested: deep };
    const deepFixture = environmentStateServeFixture(
      timedCaptureEvidence([
        ["GET", "/api/settings", deep],
        ["PUT", "/api/settings", { theme: "light" }],
      ]),
    );
    const deepSource = loadEnvironmentSource(
      deepFixture.manifest,
      deepFixture.capture,
    );
    if (!deepSource.ok) throw deepSource.error;
    expect(
      prepareServedState(deepSource.value, deepFixture.capture).report,
    ).toEqual({
      served: true,
      evidence_id: deepFixture.state.evidence_id,
    });
  });

  it("serves replay and reports the code and message when the capture yields a manifest but no state", () => {
    const headerOnly = scenarioServeFixture(
      scenarioHeaderOnlyCaptureEvidence(),
    );
    const scenario = loadEnvironmentSource(
      headerOnly.manifest,
      headerOnly.capture,
    );
    if (!scenario.ok) throw scenario.error;
    const served = prepareServedState(scenario.value, headerOnly.capture);
    expect(served.state).toBeUndefined();
    expect(served.report).toEqual({
      served: false,
      reason: "unavailable",
      code: "unsupported_target",
      message: expect.stringContaining(
        "environment-state needs a capture_browser_scenario capture with capture.network.response_body selected",
      ),
    });
  });
});

describe("admitServedState", () => {
  it("refuses a derived state data/get would write past what data/add loads back", () => {
    expect(admitServedState(state, "environment_serve").ok).toBe(true);
    // A euro sign is one UTF-16 unit but three bytes as data/get writes it.
    const notes = "\u20ac".repeat(12_000_000);
    const [first] = state.entities;
    const large = {
      ...state,
      entities: [
        ...state.entities,
        { ...first!, id: "large", fields: { ...first!.fields, notes } },
      ],
    };
    const admitted = admitServedState(large, "environment_serve");
    if (admitted.ok) throw new Error("Expected the state to be refused");
    expect(projectAnalysisError(admitted.error)).toMatchObject({
      code: "resource_constraint",
      message: expect.stringContaining("larger than data/add loads"),
    });
  });
});

describe("EnvironmentStateStore", () => {
  it("reports its state as rea-state/v1, accepts that report back and resets to the initial state", () => {
    const store = new EnvironmentStateStore(state);
    const initial = store.snapshot();
    expect(initial.rea_state).toMatchObject({
      version: 1,
      state_evidence_id: state.evidenceId,
      types: state.types,
      entities: state.entities,
      documents: state.documents,
    });
    expect(store.replace(structuredClone(initial)).ok).toBe(true);
    const emptied = store.replace({
      rea_state: { version: 1, entities: [], documents: [] },
    });
    expect(emptied.ok).toBe(true);
    expect(store.entity("/api/users", "/api/users", "2")).toBeUndefined();
    expect(store.snapshot().rea_state.entities).toEqual([]);
    store.reset();
    expect(store.snapshot()).toEqual(initial);
    expect(store.entity("/api/users", "/api/users", "2")).toMatchObject({
      fields: { login: "probe" },
    });
  });

  it("keeps collection order as the entities array orders it", () => {
    const store = new EnvironmentStateStore(state);
    const folders = state.entities.filter(
      (entity) => entity.type === "/api/folders",
    );
    expect(
      store.replace({
        rea_state: {
          version: 1,
          entities: [...folders].reverse(),
          documents: [],
        },
      }).ok,
    ).toBe(true);
    expect(
      store.inCollection("/api/folders", "/api/folders").map(({ id }) => id),
    ).toEqual(folders.map(({ id }) => id).reverse());
  });

  it("cites the Evidence's records only for entities whose values are the Evidence's", () => {
    const store = new EnvironmentStateStore(state);
    const user = <Entity extends { type: string; id: string }>(
      entities: readonly Entity[],
    ) =>
      entities.find(
        (entity) => entity.type === "/api/users" && entity.id === "2",
      );
    const recorded = user(state.entities)!;
    expect(recorded.record_ordinals.length).toBeGreaterThan(0);
    expect(
      store.replace(
        documentWith((document) => {
          for (const entity of document.rea_state.entities) {
            if (entity.type !== "/api/users") delete entity.record_ordinals;
            else if (entity.id === "2")
              entity.fields = { ...(entity.fields as object), login: "edited" };
          }
        }),
      ).ok,
    ).toBe(true);
    const { entities } = store.snapshot().rea_state;
    expect(user(entities)).toMatchObject({
      fields: { login: "edited" },
      record_ordinals: [],
    });
    const folder = entities.find((entity) => entity.type === "/api/folders")!;
    expect(folder.record_ordinals).toEqual(
      state.entities.find(
        (entity) => entity.type === "/api/folders" && entity.id === folder.id,
      )?.record_ordinals,
    );
    const index = state.entities.indexOf(recorded);
    expect(
      firstProblem(
        documentWith((document) => {
          document.rea_state.entities[index]!.record_ordinals = [424242];
        }),
      ),
    ).toEqual({
      path: `rea_state/entities/${String(index)}/record_ordinals`,
      message:
        "cites records the served Evidence does not cite for this entity",
    });
  });

  it("leaves the state unchanged when a document is refused", () => {
    const store = new EnvironmentStateStore(state);
    const before = store.snapshot();
    const refused = store.replace(
      documentWith((document) => {
        document.rea_state.entities = [];
        document.rea_state.documents.push({ tool: "get_users_by_id" });
      }),
    );
    expect(refused.ok).toBe(false);
    expect(store.snapshot()).toEqual(before);
  });

  it("refuses a document that data/get would write back past what data/add loads", () => {
    const store = new EnvironmentStateStore(state);
    const { rea_state: held } = store.snapshot();
    // Without the members data/get adds back, the document fits only until they return.
    const document = {
      rea_state: {
        version: held.version,
        entities: held.entities.map(({ type, collection, id, fields }) => ({
          type,
          collection,
          id,
          fields: { ...fields },
        })),
        documents: held.documents,
      },
    };
    const entity = document.rea_state.entities[0]!;
    const { fields } = entity;
    const idField = state.types.find(
      (type) => type.collection_template === entity.type,
    )?.id_field;
    const text = Object.keys(fields).find(
      (field) => field !== idField && typeof fields[field] === "string",
    )!;
    fields[text] = `${String(fields[text])}${"a".repeat(
      STATE_INTAKE_LIMIT_BYTES -
        Buffer.byteLength(JSON.stringify(document), "utf8"),
    )}`;
    expect(Buffer.byteLength(JSON.stringify(document), "utf8")).toBe(
      STATE_INTAKE_LIMIT_BYTES,
    );
    const before = store.snapshot();
    const replaced = store.replace(document);
    expect(!replaced.ok && replaced.error.issues).toEqual([
      expect.objectContaining({
        reason: "out_of_range",
        maximum: STATE_INTAKE_LIMIT_BYTES,
      }),
    ]);
    expect(store.snapshot()).toEqual(before);
  });
});

describe("caller-owned state replacement", () => {
  it("does not retain mutable data from a caller-owned replacement", () => {
    const store = new EnvironmentStateStore(state);
    const document = documentWith((value) => {
      const entity = value.rea_state.entities.find((item) => item.id === "2");
      if (!entity) throw new Error("Expected the user entity");
      entity.fields = { ...(entity.fields as object), login: "renamed" };
    });
    expect(store.replace(document).ok).toBe(true);
    const callerEntity = document.rea_state.entities.find(
      (entity) => entity.id === "2",
    );
    if (!callerEntity) throw new Error("Expected the caller's user entity");
    (callerEntity.fields as Record<string, unknown>).login = "later edit";

    expect(store.snapshot().rea_state.entities).toContainEqual(
      expect.objectContaining({
        id: "2",
        fields: expect.objectContaining({ login: "renamed" }),
      }),
    );
  });
});

describe("rea-state/v1 validation", () => {
  it.each([
    [
      "an unknown type",
      (document: Editable) => {
        document.rea_state.entities[0]!.type = "/api/unknown";
      },
      "rea_state/entities/0/type",
    ],
    [
      "a collection outside its template",
      (document: Editable) => {
        document.rea_state.entities[3]!.collection = "/api/folders/extra";
      },
      "rea_state/entities/3/collection",
    ],
    [
      "an id its identity field does not carry",
      (document: Editable) => {
        document.rea_state.entities[2]!.id = "other";
      },
      "rea_state/entities/2/id",
    ],
    [
      "a repeated key",
      (document: Editable) => {
        document.rea_state.entities.push(document.rea_state.entities[0]!);
      },
      `rea_state/entities/${String(state.entities.length)}/id`,
    ],
    [
      "view values for a view of another type",
      (document: Editable) => {
        document.rea_state.entities[2]!.view_fields = [
          { tool: "get_users_by_id", fields: {} },
        ];
      },
      "rea_state/entities/2/view_fields/0/tool",
    ],
    [
      "a document for a tool that is not a document view",
      (document: Editable) => {
        document.rea_state.documents.push({
          tool: "get_folders",
          path: "/api/folders",
          value: {},
        });
      },
      `rea_state/documents/${String(state.documents.length)}/tool`,
    ],
    [
      "a member the format does not define",
      (document: Editable) => {
        document.rea_state.entities[1]!.secret = "never echoed";
      },
      "rea_state/entities/1",
    ],
    [
      "another state's Evidence id",
      (document: Editable) => {
        document.rea_state.state_evidence_id = "ev_other";
      },
      "rea_state/state_evidence_id",
    ],
  ])("names the first problem of %s by its path", (_, edit, path) => {
    const problem = firstProblem(documentWith(edit));
    expect(problem.path).toBe(path);
    expect(problem.message).not.toContain("never echoed");
  });

  it("refuses view values that give an entity another identity, and accepts its own id spelled as either scalar", () => {
    const index = state.entities.findIndex(
      (entity) => entity.type === "/api/users" && entity.id === "2",
    );
    const withView = (fields: Record<string, unknown>) =>
      documentWith((document) => {
        document.rea_state.entities[index]!.view_fields = [
          { tool: "get_users_by_id", fields },
        ];
      });
    for (const id of [3, "3", null])
      expect(firstProblem(withView({ id, login: "other" }))).toEqual({
        path: `rea_state/entities/${String(index)}/view_fields/0/fields`,
        message:
          "sets the type's id field to a value other than the entity's id",
      });
    const store = new EnvironmentStateStore(state);
    expect(store.replace(withView({ id: "2", login: "other" })).ok).toBe(true);
    expect(store.entity("/api/users", "/api/users", "2")?.view_fields).toEqual([
      { tool: "get_users_by_id", fields: { id: "2", login: "other" } },
    ]);
  });

  it("refuses values parsing would change at the member holding them, without naming caller data", () => {
    const marker = Symbol("not exact JSON");
    const problem = firstProblem(
      documentWith((document) => {
        document.rea_state.entities[0]!.fields = {
          ...(document.rea_state.entities[0]!.fields as object),
          "caller-named": marker,
        };
      }),
    );
    expect(problem).toEqual({
      path: "rea_state/entities/0/fields",
      message: "holds a value that is not exactly representable JSON",
    });
    for (const types of [[marker], [{ "caller-secret-key": marker }]])
      expect(
        firstProblem(
          documentWith((document) => {
            document.rea_state.types = types;
          }),
        ),
      ).toEqual({
        path: "rea_state/types",
        message: "holds a value that is not exactly representable JSON",
      });
    expect(
      firstProblem(
        documentWith((document) => {
          document.rea_state.types = [];
        }),
      ),
    ).toEqual({
      path: "rea_state/types",
      message: "differs from the served types",
    });
    const prototypeMember = () =>
      firstProblem(
        JSON.parse(
          JSON.stringify(documentWith(() => undefined)).replace(
            '"type":',
            '"__proto__":{"x":1},"type":',
          ),
        ),
      );
    expect(prototypeMember()).toEqual({
      path: "rea_state/entities/0",
      message: "has a member rea-state/v1 does not define",
    });

    expect(firstProblem([])).toMatchObject({ path: "" });
    expect(
      firstProblem({ rea_state: { version: 2, entities: [], documents: [] } }),
    ).toMatchObject({ path: "rea_state/version" });
  });
});

describe("wide state value validation", () => {
  it("preserves a wide caller value through the state replacement boundary", () => {
    const wide = Array.from({ length: 200_000 }, (_, index) => index % 10);
    const wideObject = Object.fromEntries(
      Array.from({ length: 20_000 }, (_, index) => [
        `field_${String(index)}`,
        index,
      ]),
    );
    const document = documentWith((value) => {
      const fields = value.rea_state.entities[0]!.fields as Record<
        string,
        unknown
      >;
      value.rea_state.entities[0]!.fields = {
        ...fields,
        caller_wide: wide,
        caller_wide_object: wideObject,
      };
    });
    const store = new EnvironmentStateStore(state);

    expect(store.replace(document).ok).toBe(true);
    const retained = store.snapshot().rea_state.entities[0]?.fields.caller_wide;
    if (!Array.isArray(retained)) throw new Error("Expected the wide value");
    expect(retained).toHaveLength(wide.length);
    expect(retained.at(-1)).toBe(wide.at(-1));
    const retainedObject =
      store.snapshot().rea_state.entities[0]?.fields.caller_wide_object;
    expect(retainedObject).toEqual(wideObject);
  });
});

it("retains arbitrary dictionary keys and owned JSON references at state intake", () => {
  const dictionary = JSON.parse(
    '{"__proto__":{"constructor":{"prototype":"kept"}},"constructor":7,"prototype":8}',
  );
  const document = documentWith((value) => {
    const entity = value.rea_state.entities[0]!;
    entity.fields = { ...(entity.fields as object), ...dictionary };
  });
  const entity = document.rea_state.entities[0]!;
  const fields = entity.fields;
  const owned = parseStateDocument(state, document, true);
  expect(owned.ok).toBe(true);
  if (!owned.ok) throw owned.error;
  expect(owned.value.entities[0]?.fields).toBe(fields);
  const copied = parseStateDocument(state, document);
  expect(copied.ok).toBe(true);
  if (!copied.ok) throw copied.error;
  expect(copied.value.entities[0]?.fields).not.toBe(fields);
  expect(copied.value.entities[0]?.fields).toEqual(fields);
  expect(Object.hasOwn(copied.value.entities[0]!.fields, "__proto__")).toBe(
    true,
  );
  const store = new EnvironmentStateStore(state);
  expect(store.replace(document).ok).toBe(true);
  const snapshot = JSON.stringify(store.snapshot());
  expect(store.replace(JSON.parse(snapshot)).ok).toBe(true);
  expect(JSON.stringify(store.snapshot())).toBe(snapshot);
});

it.each(["__proto__", "constructor", "prototype"])(
  "refuses unknown structural member %s before projection",
  (key) => {
    const document = documentWith(() => undefined);
    const structures = [
      document,
      document.rea_state,
      document.rea_state.entities[0]!,
    ];
    const view = { tool: "fixture", fields: {} };
    document.rea_state.entities[0]!.view_fields = [view];
    const held = { tool: "fixture", path: "/fixture", value: {} };
    document.rea_state.documents = [held];
    structures.push(view, held);
    for (const structure of structures) {
      Object.defineProperty(structure, key, {
        value: 1,
        configurable: true,
        enumerable: true,
      });
      expect(firstProblem(document).message).toBe(
        "has a member rea-state/v1 does not define",
      );
      Reflect.deleteProperty(structure, key);
    }
  },
);

it("keeps missing fields distinct from invalid JSON field contents", () => {
  const document = documentWith((value) => {
    Reflect.deleteProperty(value.rea_state.entities[0]!, "fields");
  });
  expect(firstProblem(document)).toEqual({
    path: "rea_state/entities/0/fields",
    message: "is required",
  });
});
