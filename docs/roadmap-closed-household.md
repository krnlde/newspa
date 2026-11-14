# Closed work packages - the household

The record of W4 (the D-034 amendment, 2026-11-14): what the surface file tells
about the panel, told for the second scope. The panel's own record - WP14, the
refusals it measured - stays in `roadmap-closed-surface.md`, because that is where
the desk's editor grew; this file is the household room built beside it.

## W4 — closed: the household moves a source's switches (2026-11-14)

**Was.** The panel above is a machine-local tool: `/api/sources` was loopback-only for
**every verb**, so a phone in the next room opened the modal and read the server's
refusal sentence. The reading list stayed the desk's, and the household could do nothing
at all — not turn a source off, not add one.

**Is.** The route answers **two scopes** (`sourcesAllowed` in `net.ts`):

|                | the machine that runs the server (`full`)                                            | a device on the bound network (`household`)                                                                                  |
| -------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| the list       | each file's **verbatim text**, the loader's issues, the row's health, the desk `dir` | the **switches**: `enabled`, `section`, `weight`, `cadenceMinutes`, label, url, kind, issues, health — **no text, no `dir`** |
| the write      | `{text}` — the whole file, `parseSourceJson` as validator                            | `{id, patch}` of knobs, merged by `applyHouseholdPatch`; `{create}` of an `rss`/`html` source by URL                         |
| deletion, pick | yes                                                                                  | refused, and the reason names the switch that does the job                                                                   |

The field set lives in **one** schema (`apiSources.ts` in core; `packages/config`
re-exports it and owns the merge), so the ranges that build the form and the ranges that
validate the write are the same numbers. `DELETE` and `/api/pick` keep D-034's original
wall: a deletion removes the private words with the file, and a pick opens a browser on
the desk. Rule 20 is untouched — no credential appears anywhere in the diff; the wall is
the bind, read with one narrower room.

**Measured, and it changed the code.**

- `zod`'s `.partial()` **keeps `.default()`s**. A patch schema built from the file shape
  parsed a body naming only the desk's fields into `{weight: 1, enabled: true,
  cadenceMinutes: 20}` — a body that asked for nothing, writing three knobs. Every field
  in the patch shape is `.unwrap()`ed, and the "name at least one field" test is the
  guard. Measured on zod 4.6.7.
- Three states per key, because the body has three: a value sets, `null` **unsets** (a
  removed `section` sends the source back to the keyword ladder), and an absent key says
  nothing. Collapsing the last two turns "the ladder decides again" into "keep what you
  had".
- `api.ts` grew past rule 1's 300-line cap **twice over** on this one feature: a module
  cycle (`api.ts` ↔ `apiSources.ts`, both holding `const` zod schemas) is a TDZ at import
  time, and it showed up as three suites that could not load. Fixed by a third module,
  `apiParts.ts`, holding the primitives both contracts use — not by one file that knows
  about the other.

**The form.** `apps/web/src/HouseholdSources.tsx`: native controls (the schema owns the
ranges, the server re-checks them), one rule per row, **Apply sends only what moved**, a
label typed into the add form becomes the filename-shaped id (D-011), and a file that
does not parse shows its issues with no controls. No editor box exists on that wire,
because no file text was ever sent: the privacy rule is a property of the wire, not of
hiding a button.

**Accept.** core 269, config 130, server 375, web 226. The privacy claims are the ones
the tests are about: a key sweep proves no `text`, `watchwords`, `notes` or `headers`
reach a household answer; a patch preserves them byte-for-byte; `{text}` from a household
peer is refused; an add over an existing file leaves it byte-identical; `json` is refused
as authoring. The desk's tests are unchanged, which is the point: the LAN room did not
move the desk's ground.
