import * as t from "@babel/types";

import { semanticComputedMethodKey } from "./javascriptSemanticEvaluationOrder.js";
import { semanticCallableIdForNode } from "./javascriptSemanticProjection.js";

/**
 * Innermost-last stack of admitted callables during one enter/exit traversal.
 *
 * Single owner for semantic callable ownership. A computed object/class method
 * key is evaluated before the method's parameter and body environments, so the
 * method is set aside while its key is traversed and the enclosing callable
 * owns every fact recovered from the key. Collectors share this tracker so
 * calls, captures, effects, promises, and object operations agree.
 */
export interface SemanticCallableStack<Callable> {
  /** Admitted callables, outermost first; the innermost owner is last. */
  readonly callables: readonly Callable[];
  readonly enter: (node: t.Node, parent: t.Node | null) => void;
  readonly exit: (node: t.Node) => void;
}

interface CallableFrame<Callable> {
  readonly callableId: string;
  readonly callable: Callable;
}

/**
 * Track callables admitted by `admit`, which maps a callable ID to the value
 * kept on the stack or `undefined` to ignore it. A caller-owned `callables`
 * array is updated in place, so shared contexts can keep reading it.
 */
export const createSemanticCallableStack = <Callable>(
  admit: (callableId: string) => Callable | undefined,
  callables: Callable[] = [],
): SemanticCallableStack<Callable> => {
  const frames: CallableFrame<Callable>[] = [];
  const suspendedMethods = new Map<t.Node, CallableFrame<Callable>>();
  callables.length = 0;
  const push = (frame: CallableFrame<Callable>): void => {
    frames.push(frame);
    callables.push(frame.callable);
  };
  const pop = (): CallableFrame<Callable> | undefined => {
    callables.pop();
    return frames.pop();
  };
  return {
    callables,
    enter: (node, parent) => {
      if (
        parent !== null &&
        semanticComputedMethodKey(parent, node) &&
        frames.at(-1)?.callableId === semanticCallableIdForNode(parent)
      ) {
        const method = pop();
        if (method !== undefined) suspendedMethods.set(node, method);
      }
      const callableId = semanticCallableIdForNode(node);
      if (callableId === null) return;
      const callable = admit(callableId);
      if (callable !== undefined) push({ callableId, callable });
    },
    exit: (node) => {
      const callableId = semanticCallableIdForNode(node);
      if (callableId !== null && frames.at(-1)?.callableId === callableId)
        pop();
      const method = suspendedMethods.get(node);
      if (method !== undefined) {
        suspendedMethods.delete(node);
        push(method);
      }
    },
  };
};

/** Track admitted callable IDs, keeping each ID as its stack value. */
export const createSemanticCallableIdStack = (
  admitted: ReadonlySet<string>,
  callables: string[] = [],
): SemanticCallableStack<string> =>
  createSemanticCallableStack(
    (callableId) => (admitted.has(callableId) ? callableId : undefined),
    callables,
  );
