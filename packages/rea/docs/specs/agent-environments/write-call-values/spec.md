# Serve the calls agents make and the values applications count

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

Eval agents' trajectories on rebuilt environments, and the write plans of the recordings they ran on, showed three
gaps REA could close:

- **Query values.** Served tools typed each query parameter as a string or an array of strings, while agents send page
  sizes and flags as JSON numbers and booleans (`maxSize: 50`, `withItems: true`). The MCP server refused those calls
  before REA saw them: 63 of 418 stored eval runs hit it, in EspoCRM, Homebox and PhotoPrism, and 18 never got the tool
  to answer.
- **Counted and made values.** Vikunja numbers a project's tasks past those deleted earlier, so a created task's
  `index` is not one past what the state holds; its `identifier` spells that index; and each created task gets a
  `subscription` object the application makes with it. A second create disagreed with the first on all three, so
  task creates were withheld.
- **Bulk creates.** Vikunja's UI creates a task through `POST /projects/{id}/tasks/bulk`, sending and answering the
  task wrapped in `tasks: [ … ]`. The answer's id sat inside the array, so REA linked the call to no type.

The diagnosis also found that a recorded update stores only what it sent (EspoCRM's updates never changed an email
address), and that an object known only from a list that leaves out fields its own read shows can be neither read by
id nor updated. Both are recording gaps the skill now addresses.

## Behaviour

- **Query values.** A query parameter accepts a number or boolean besides a string or an array of strings, and serving
  sends it as its JSON text.
- **Sequences from a start.** A field the first create showed above every value its type held, which a later create
  shows one past the first's, is a `sequence` with that `start`: serving never goes below it.
- **Rules that spell the first create.** A field the plan kept as shown takes a later create's rule when that rule also
  spells the first create's value: a `composed` or `template` string, or the `sequence` above.
- **Made objects.** A created object no other entity of the type holds otherwise, with a member the request stamped, is
  a `made-object`: stamped members take the write's clock, members holding the entity's identity take its id, counts
  go one past the largest value held objects show from a `start`, and other members stay as recorded.
- **Linked bulk creates.** A create's answer names the id of the one object a one-element array member holds. A linked
  create accepts any path values when it creates into its type's own collection, whose path has no parameters, and
  stores each path value in a field, as a Vikunja task stores its project: no path value changes where it creates.
- **Skill.** Recordings read each listed object by id, up to ten per collection, before writing.

Plans and views that need none of this are unchanged.

## Acceptance

- No write tool of the 130 recorded captures goes from served to withheld.
- Rebuilt from the same recordings, the branch passes at least the write tasks #7274 passes.
