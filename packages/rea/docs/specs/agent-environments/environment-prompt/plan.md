# Plan

1. Add the `request` action to the scenario schema: methods, path, query,
   headers with page value sources, JSON body and expected statuses; validate
   the origin and the body against the start URL; include query and header
   secrets in the declared-secret check.
2. Add `PlaywrightScenarioRequest.ts`: check the page's origin, build the URL,
   resolve header values (admitting values read from the page to the scenario's
   redaction), fetch in the page with a timeout and read the whole response,
   then check the status. Dispatch it from the action runner with the start
   origin, and add the limitation when a scenario has a request step.
3. Add a real-browser lane, `verify:browser:request`: a fixture item API that
   requires a CSRF cookie header and a stored bearer token for writes, a write
   session recorded through the CLI, the build's served writes, and a failing
   expected status.
4. Add the `export_environment_bundle` contract, effects, CLI alias, catalog
   family and handler: check the destination as other MCP output tools do,
   resolve the capture bytes, and call the build with an exclusive destination.
5. Write the skill reference, route it from SKILL.md and install it with setup.
6. Document the request step, the MCP tool and recording writes.
7. Tests: request step unit tests, the MCP tool boundary, setup's skill files.
