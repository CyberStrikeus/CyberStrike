import assert from "node:assert/strict";

const ownershipPsArguments =
  '["ps", "-axo", "pid=,ppid=,pgid=,uid=,stat=,command="]';

/** Parse execution/thread facts once; only an observed Node ps caller owns inventory reads. */
export const collectOwnershipTraceFacts = ({
  traces,
  nodeExecutable,
  psExecutables,
}) => {
  const processGroups = new Map();
  const findGroup = (pid) => {
    const parent = processGroups.get(pid);
    if (parent === undefined) {
      processGroups.set(pid, pid);
      return pid;
    }
    if (parent === pid) return pid;
    const root = findGroup(parent);
    processGroups.set(pid, root);
    return root;
  };
  const joinThreadGroup = (left, right) => {
    const leftRoot = findGroup(left);
    const rightRoot = findGroup(right);
    if (leftRoot !== rightRoot) processGroups.set(rightRoot, leftRoot);
  };

  const cloneEvents = [];
  for (const trace of traces) {
    let unfinished;
    for (const rawLine of trace.text.split("\n")) {
      const line = rawLine.trimStart();
      const start = /^(clone3?|fork|vfork)\((.*)<unfinished \.\.\.>$/u.exec(
        line,
      );
      if (start !== null) {
        unfinished = { name: start[1], text: start[2] };
        continue;
      }
      const resumed = /^<\.\.\. (clone3?|fork|vfork) resumed>(.*)$/u.exec(line);
      if (resumed !== null && resumed[1] === unfinished?.name) {
        cloneEvents.push({
          parentPid: trace.pid,
          text: `${unfinished.text}${resumed[2]}`,
        });
        unfinished = undefined;
        continue;
      }
      const complete =
        /^(clone3?|fork|vfork)\((.*\)) = (\d+)(?:<[^>]*>)?$/u.exec(line);
      if (complete !== null)
        cloneEvents.push({
          parentPid: trace.pid,
          childPid: Number(complete[3]),
          text: complete[2],
        });
    }
  }

  for (const event of cloneEvents) {
    const childPid =
      event.childPid ?? /\) = (\d+)(?:<[^>]*>)?$/u.exec(event.text)?.[1];
    if (childPid === undefined) continue;
    const observedChild = Number(childPid);
    // A child-side clone return of zero is not a parent-to-child edge.
    if (!Number.isSafeInteger(observedChild) || observedChild <= 0) continue;
    event.childPid = observedChild;
    if (/\bCLONE_THREAD\b/u.test(event.text))
      joinThreadGroup(event.parentPid, event.childPid);
  }

  const executions = [];
  for (const trace of traces) {
    for (const line of trace.text.split("\n")) {
      if (!/execve(?:at)?\(/u.test(line)) continue;
      const match = /^execve\("([^"]+)"/u.exec(line);
      assert.notEqual(match, null, `Unresolved executable identity: ${line}`);
      assert.ok(
        / = (?:0|-1 [A-Z]+)/u.test(line),
        `Incomplete execution observation: ${line}`,
      );
      executions.push({
        pid: trace.pid,
        path: match[1],
        line,
        succeeded: line.endsWith(" = 0"),
        ownershipInventory:
          psExecutables.has(match[1]) && line.includes(ownershipPsArguments),
      });
    }
  }
  const psProcesses = new Set(
    executions
      .filter(
        ({ succeeded, ownershipInventory }) => succeeded && ownershipInventory,
      )
      .map(({ pid }) => pid),
  );
  const psParentGroups = new Set(
    cloneEvents
      .filter(({ childPid }) => psProcesses.has(childPid))
      .map(({ parentPid }) => findGroup(parentPid)),
  );
  const nodeGroups = new Set(
    executions
      .filter(({ path, succeeded }) => succeeded && path === nodeExecutable)
      .map(({ pid }) => findGroup(pid)),
  );
  const replaced = new Set(
    executions
      .filter(({ path, succeeded }) => succeeded && path !== nodeExecutable)
      .map(({ pid }) => pid),
  );
  const ownershipThreads = new Set(
    traces
      .filter(
        ({ pid }) =>
          nodeGroups.has(findGroup(pid)) &&
          psParentGroups.has(findGroup(pid)) &&
          !replaced.has(pid),
      )
      .map(({ pid }) => pid),
  );
  return { ownershipThreads, psProcesses, executions };
};
