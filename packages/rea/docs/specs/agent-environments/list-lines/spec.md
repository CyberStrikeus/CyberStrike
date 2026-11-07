# Decide a list's whole-collection membership per line

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

A list view reproduces its lines from the state with one of two memberships: `all`, every entity of the collection in
state order, or `recorded`, the entities each recording listed. The view was `all` only when every checked line listed
its whole collection. A list tool often also has a filtered line (`?library_id=…`, `?name=…`), and that one line kept
every line of the tool to its recorded members. An entity the environment created then never appeared in a list,
though the unfiltered line of the same tool had shown the application listing every entity.

Each checked line is now judged on its own. A recorded-membership view names, in `all_record_ordinals`, the checked
lines that each meet the conditions `all` asks of every line: the line has no query or only paging parameters starting
at zero, lists
exactly the entities of its collection in state order, and shows no total that differs from the number listed and no
next page. A call answered on such a line lists every entity of the collection, the write gate checks a read on it
against the whole collection, and a create's insert rule may be retried on it, as for an `all` view. Other lines keep
their recorded members. Without such a line, or when every line is one, the view is unchanged and the member is absent,
so existing states keep their values.

Positive or malformed `offset`, `start`, `_start`, and `page` positions do not establish whole membership, even for an
empty collection. Positive page numbers are ambiguous without a recorded zero-/one-based convention. These lines keep
recorded membership rather than inventing earlier items after a write or `data/add`; all paging values must be safe
nonnegative integers. Repeated positions must all be zero.

A whole line's read checks the collection, so it exercises every write that changed the collection since it was last
read. A write whose entity a read has since shown absent, for example a create an unmodelled delete removed and a 404
then showed gone, no longer counts there, as when a modelled delete replaces it. The same holds when a failed item check
takes the read's answer and that answer holds no entity. Otherwise a whole list taken after the entity was gone would
confirm a create it cannot show.

`numberOfElements` and similar number-of-items members (`number` with `elements`, `entries`, `items` or `results`)
count the listed entities, so a whole line's counter follows the state as `totalElements` does. A view with whole lines
takes the counters that equal the number listed on each of them, since a partial page's total counts more than the page;
a view without one keeps those that do on every line. A line is answered with each counter set to the number listed
only when its own recording showed that counter equal to the number it listed, so a partial page keeps its recorded
total.

## Acceptance

- Domain: a tool with a whole line and a filtered line names the whole one; a create the whole line later lists is
  confirmed; a tool whose lines are all whole, or none, names none; a whole list taken after a read showed the created
  entity gone confirms no create.
- Serving: after a served create, the whole line lists the created entity with its counters, and the filtered line
  keeps its recorded members; beside a partial page whose total counts the collection, the whole line's total follows
  the state and the page keeps its recorded total.
- Measured: the six published environments compared with the application before and after, on the probes of the
  fidelity comparison and the held-out sessions recorded since.
