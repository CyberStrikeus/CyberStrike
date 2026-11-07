import {
  ownMember,
  at,
  isObject,
  listItems,
  projectsFields,
  scalarText,
  type JsonObject,
  type StateItemView,
  type StateListView,
  type StateRecordFacts,
  type StateView,
} from "./environmentStateRules.js";
import {
  succeeded,
  type CheckOutcome,
  type ReadBodies,
  type SimulatedState,
} from "./environmentStateWriteChecks.js";

/**
 * Fields a type's recordings always carried that a later successful whole read shows the
 * application leaves out of an entity the state holds, as APIs that omit empty or false members
 * do: no entity of the type must carry them, in any of its views.
 */
export class OmittedFields {
  readonly #omitted = new Map<string, Set<string>>();

  constructor(private readonly retain: (bytes: number) => void) {}

  /** Check an item or list read with the fields reads showed omitted, this one's included, no longer required, naming this one's in the outcome. */
  check<View extends StateItemView | StateListView>(
    state: SimulatedState,
    view: View,
    record: StateRecordFacts,
    read: ReadBodies & {
      readonly idField: string;
      readonly collection: string;
      readonly itemId?: string;
    },
    compare: (view: View) => CheckOutcome | undefined,
  ): CheckOutcome | undefined {
    const omitted = lackedFields(state, view, record, read);
    const noted = this.#omitted.get(view.type);
    const loosened = relaxed(
      view,
      omitted.length === 0 ? noted : new Set([...(noted ?? []), ...omitted]),
    );
    const outcome = compare(loosened);
    return outcome === undefined ? undefined : { ...outcome, omitted };
  }

  /** Note the fields a read the gate counts shows left out, so no view of its type requires them. */
  keep(view: StateView, outcome: CheckOutcome): void {
    if (view.shape !== "item" && view.shape !== "list") return;
    for (const field of outcome.omitted ?? []) this.#note(view.type, field);
  }

  /** The current required-field facts, shared by observations, checks and final output. */
  view(view: StateView): StateView {
    return view.shape === "item" || view.shape === "list"
      ? relaxed(view, this.#omitted.get(view.type))
      : view;
  }

  /** The views with the fields reads showed omitted no longer required. */
  views(views: readonly StateView[]): StateView[] {
    return views.map((view) => this.view(view));
  }

  #note(type: string, field: string): void {
    let fields = this.#omitted.get(type);
    if (fields === undefined) {
      fields = new Set();
      this.#omitted.set(type, fields);
    }
    if (!fields.has(field)) {
      this.retain(64 + field.length * 2);
      fields.add(field);
    }
  }
}

/** The required fields a successful whole read's held entities lack. */
const lackedFields = (
  state: SimulatedState,
  view: StateItemView | StateListView,
  record: StateRecordFacts,
  read: Pick<ReadBodies, "body"> & {
    readonly idField: string;
    readonly collection: string;
    readonly itemId?: string;
  },
): string[] => {
  if (
    !succeeded(record) ||
    read.body === undefined ||
    projectsFields(record.query)
  )
    return [];
  const lacked = new Set<string>();
  for (const entity of heldEntities(state, view, read))
    for (const field of view.required_fields)
      if (!Object.hasOwn(entity, field)) lacked.add(field);
  return [...lacked];
};

/** The entities a read shows that the state holds: an item read's object naming the path's id, a list read's items. */
const heldEntities = (
  state: SimulatedState,
  view: StateItemView | StateListView,
  read: Pick<ReadBodies, "body"> & {
    readonly idField: string;
    readonly collection: string;
    readonly itemId?: string;
  },
): JsonObject[] => {
  const object = view.shape === "item" ? at(read.body!, view.pointer) : null;
  const shown =
    view.shape === "list"
      ? (listItems(read.body!, view.pointer) ?? [])
      : isObject(object) &&
          read.itemId !== undefined &&
          scalarText(ownMember(object, read.idField)) === read.itemId
        ? [object]
        : [];
  return shown.filter((entity) => {
    const id = scalarText(ownMember(entity, read.idField));
    return (
      id !== undefined &&
      state.entity(view.type, read.collection, id) !== undefined
    );
  });
};

const relaxed = <View extends StateItemView | StateListView>(
  view: View,
  omitted: ReadonlySet<string> | undefined,
): View =>
  omitted === undefined
    ? view
    : {
        ...view,
        required_fields: view.required_fields.filter(
          (field) => !omitted.has(field),
        ),
      };
