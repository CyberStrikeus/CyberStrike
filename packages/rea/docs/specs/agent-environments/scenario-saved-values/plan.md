# Plan

1. Schema: `save` on request steps, `save_response` on click and press, the
   `saved` value source in headers and credential parts, `basic_credentials`
   with two parts, and the `{saved:name}` placeholder.
2. Validation: every saved value a step sends was saved by an earlier step.
3. Runtime: read the response body when a step saves, start waiting for a UI
   step's response before it acts, keep saved values with their JSON type,
   fill placeholders, build Basic credentials, and redact secret saves.
4. Evidence: leave an empty `save` out of the recorded step.
5. Environment build: warn about credential-named saved values not marked
   secret.
6. Skill and docs: write through the UI first and save ids instead of guessing
   them; bump the skill version.
7. Tests: schema, runtime with a fake page, Evidence parameters, the build
   warning, the catalog budget, and a real-Chrome recording.
8. Write model: compose strings from generated ids and other fields, learn the
   `&` spelling of slugs, tell apart addresses whose parts are the same text,
   and check templates on later creates; census every recorded capture.
9. End to end: agents build environments from prompts with main and with this
   branch on the same applications, and the branch's recordings are rebuilt
   before and after the write-model changes.
