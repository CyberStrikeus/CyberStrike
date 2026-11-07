# Serve writes whose calls send different members

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

A fresh recording round of seven applications, main against #7332, showed the recording skill now varies what the two
creates and two updates of a type send, as it asks. Where the second call left out a member the first sent, REA
withheld the write:

- **Updates.** An update plan required every member its first call sent and never narrowed that, so EspoCRM's second
  contact update, which changed only an email address, was refused in both recordings of the branch.
- **Members numbered when left out.** Linkding stores a bundle's `order` as sent, or one past the others when a call
  leaves it out. One create showed the first and another the second, which the create merge took as a disagreement.

The same recordings and the 130 earlier captures showed two more update gaps:

- **Whole-object PUTs.** Paperless clears a tag's, correspondent's or document type's `owner` when a `PUT` leaves it
  out, and Homebox an item's `assetId`, so those updates were `unexplained-change`.
- **Update clocks read at another precision.** Vikunja answers a task update with `done_at` to the nanosecond while its
  reads spell it to the second, so the read after the update contradicted it.

The round also found two creates of EspoCRM contacts in one second, which a list sorted newest first shows in an order
the application breaks ties in. The skill now spaces creates.

## Behaviour

- **Update members.** A later update narrows the plan's required members to those every call sent.
- **Numbered unless sent.** A member one create sent and stored as sent, and another left out and the application
  numbered one past the others, is a `sequence` with `sent`, in either order: serving stores the value a call sends,
  else the next number, and a later call that sends it must have stored what it sent. The next number follows the
  largest value any call took, a deleted entity's included, in replay as in serving.
- **Cleared by a PUT.** A field a `PUT` left out that the application cleared to an empty value (`""`, `null`, `false`,
  `[]` or `{}`) is that member's default (`body.defaults`) when every call that left it out stored that value, as its
  answer shows it or, where the answer leaves the member out, the read after it: serving stores it for an update that
  leaves the member out. Calls that left it out and stored it otherwise withhold the plan.
- **Update clocks.** The state holds an update's clock as the first read of the entity after it spells the same instant
  at a coarser precision in the same zone and separator, as it already does for nested clocks: replay and serving store
  every update's clocks in the spelling of the read the plan keeps as `observation.read`, so a later update whose read
  spells them otherwise contradicts the plan, while answers keep the update's own. A create's clocks stay as answered,
  as serving makes them.
- **Skill.** Recordings leave more than a second between two creates, as between a create and its first edit.

Plans and views that need none of this are unchanged.

## Not covered

- Vikunja numbers tasks per project. Creates into projects the recording did not list cannot be numbered, so its task
  creates stay withheld.
- Linkding renumbers bundles' `order` after a delete, which no rule models.
- Homebox item creates expand sent tag ids into tag objects and pin `parentId`; they stay withheld.

## Acceptance

- No write tool of the recorded captures goes from served to withheld.
- The writes the diagnosis named are served where their recordings show nothing else against them.
