# Build RL environments with REA

REA turns a recorded web app session into a runnable environment for training
and testing AI agents. An agent can practice tasks such as finding an issue,
creating a folder, or editing a record without running the original app.

REA builds the tools the agent calls, the local data those tools use, and a
test that checks the environment starts and responds. It supports changes
when the recording confirms their effects. You can then use the environment
with your RL framework to set task goals, check rewards, and run training.

## Before you start

Install [REA and its agent integration](installation.md). To record an app,
you also need a running test instance and a Chrome-family browser. Choose an
instance where the agent is allowed to create, edit, and delete data. REA
records the app you provide; you start it and prepare its test data.

To run the exported environment, install the
[AgentEnv framework](https://github.com/scaleapi/agentenv-framework#install)
and start Docker. REA's [compatibility check](testing.md#exported-environment-bundles)
uses AgentEnv version `0.9.1334` with Python 3.12.

There are two ways to build an environment: ask your agent to record the app,
or start from a recording you already have.

## 1. Record and build with your agent

Give your agent the app URL, the operations you need, your browser's executable
path, and an output directory. For an app with folders, adapt this prompt:

```text
Use REA to build an AgentEnv environment from my test web app at
http://127.0.0.1:3000. Cover listing, creating, renaming, and deleting folders.
You may create and remove test folders. Leave the existing data unchanged.

Sign in as admin using the password in APP_PASSWORD. Use the browser at
/absolute/path/to/chromium. Save the environment to
/absolute/path/to/my-env, which does not exist yet.

Record the session, check which operations the environment supports, and
export it. Report any unsupported operations and what is missing.
```

Replace the URL, account, paths, and folder operations with your own. Set
`APP_PASSWORD` in the environment that starts REA's MCP server so REA can use
it without putting the password in the prompt.

Your agent inspects the app, records a session, checks the result, and exports
a folder containing the runnable environment. It reports which operations
work and which need more evidence. The app is used during recording; the
exported environment runs from the saved data.

After your agent exports the folder, skip to
[run the environment](#3-run-the-environment). The next section is an
alternative for an existing recording.

## 2. Or build from a saved recording

A HAR file records a browser's network requests and responses. Export one
with API response bodies from your browser's network panel, or use a
recording you already have. To include create, edit, and delete operations,
record those actions and the reads that show their results.

Build the environment into a new or empty directory:

```sh
rea environment-build ./session.har ./my-env --name my-env --json
```

You can also pass capture Evidence JSON saved by REA's
`capture-browser-scenario` or `inspect-web-network-capture` commands. Here,
Evidence means REA's saved recording with its source information. The build
accepts HAR files and those JSON recordings. It reads local data and writes
the environment folder without contacting the app.

Add `--dry-run` to review the build report without writing the folder. For an
unreleased REA checkout, use `--package-tarball` with its packed package so
the exported environment runs the same implementation.

The build report tells you what the environment supports:

| Report field      | What to check                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `state`           | Whether the environment can answer from local state or uses recorded-response replay.                                    |
| `coverage.reads`  | Which read operations use state and which replay recorded answers.                                                       |
| `coverage.writes` | Which create, edit, and delete operations are supported. Each withheld operation includes a reason and a recording hint. |
| `warnings`        | Recorded content or local paths to review before sharing the folder.                                                     |

A successful build means the folder was created. Check the report to confirm
it supports the operations your tasks need. `coverage: null` means the build
could not prepare state for this environment and it will use replay.

## 3. Run the environment

Whether your agent exported the folder or you built it from a HAR, run it
with AgentEnv:

```sh
agent-env run ./my-env
```

Use the folder path your agent reported if it differs. The first run builds
the container image, so it needs access to the image and package sources.

REA includes a basic test, called the smoke task. It checks the expected tool
count and, when a suitable read tool exists, calls it and checks its response
status. Passing this test shows the environment starts and responds in the
tested setup. It does not yet score an agent on an application task.

The folder contains the recording, a tool manifest describing the available
operations, a Dockerfile, environment configuration, and the test. The
[export reference](agent-environments.md#export-a-bundle) describes each file.

## 4. Add tasks and reward checks

Start with one task the exported tools support. Give it a clear goal and a
checkable result. For example, if folder creation is supported, ask your
agent:

```text
Use this exported environment to add an AgentEnv task that asks an agent
to create a folder named Practice. Check the saved environment state to
confirm the folder exists with that name, and use that check to score the
result. Reset the environment before each run so attempts start with the
same data. Use the AgentEnv task and verifier formats.
```

This asks your agent to help build the task and its grading check around the
environment REA generated. A retrieval task might check an answer against a
recorded value. A task that changes data should check the resulting state.
When state is available, the environment supports reset, load, and read-back
operations for repeatable runs.

Use the [AgentEnv documentation](https://www.agentenvframework.com/docs) for
task configuration, agent connections, scoring, and execution. Connect the
resulting tasks to your chosen RL training workflow.

## Improve an operation that is missing

For REA to support a change, the recording needs to show what happened before
and after it. When recording against your test app:

1. Read the list and an existing item before making changes. Repeat the
   initial reads to show which values change independently.
2. Create a test item, read it back, and read the list before the next change.
   Repeat with a second item and different text.
3. Edit each test item, then read the item and list again. Leave more than a
   second between creation and the first edit to show time-dependent changes.
4. Delete the test items, then read them back and read the list to confirm
   their removal.

Also record filters, searches, sorting, and paging if your tasks need them.
The agent should check that every recording step completed before using it.
The [recording workflow](https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/references/environments.md)
has the detailed browser instructions, including timeouts and handling IDs
assigned by the app.

Use the report's hints to decide what to record next:

| Reason                          | Next step                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `unconfirmed`                   | Read the item and its list after the change.                                                                                |
| `no-state-target`               | Check the path template and recorded views; record missing reads. The route form may not be supported as a mutation target. |
| `no-observation`                | Read back a created item. For an edit or delete, also read it before changing it.                                           |
| `contradicted` or `side-effect` | Inspect the reported disagreement. The operation may need behavior REA cannot model yet.                                    |

See the [full reason table](agent-environments.md#build-a-bundle-in-one-step)
for the other cases. Rebuild from the new recording and check the report
again. A new recording replaces the build input; combining separate recording
sessions is not supported.

## Compare with the original app

For a stronger check, record a separate sequence of calls against the real
app, starting from the same test data as the original recording. This is a
probe. Restore that starting data before each probe sequence, then compare
the saved probe recordings with the environment:

```sh
rea environment-compare ./my-env/envs/my-env/manifest.json \
  --evidence ./my-env/envs/my-env/evidence.json \
  --probe ./probe-create-edit-delete.json --probe ./probe-reads.json --json
```

Each probe file must be capture Evidence JSON from REA. The comparison runs
offline and reports differences in responses, unsupported calls, and missing
observations. It accounts for supported differences in IDs, times, and
modeled generated values. Agreement applies to the calls those probes check.
See the [comparison reference](agent-environments.md#measure-fidelity-against-the-application)
for the exact rules.

## Before sharing the environment

The exported folder includes retained response bodies and local source paths.
Standard authentication headers are excluded, but custom headers, query
values, and body tokens can remain. Review the content you plan to share.
Credential-name warnings point to values worth reviewing; they do not remove
those values or establish that the recording contains no credentials.

For direct MCP serving, replay behavior, state controls, and resource limits,
see the [environment reference](agent-environments.md). The
[implementation index](specs/agent-environments/README.md) links the contributing
PRs and their verification records.
