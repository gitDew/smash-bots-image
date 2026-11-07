# Local libmelee documentation

This directory contains an offline snapshot of the libmelee documentation used
by the bots in this repository. It was fetched from the official sources on
2026-09-01.

## Where to start

- [`index.md`](index.md) — generated documentation overview, quick example, and
  setup notes.
- [`overview.md`](overview.md) — the libmelee project overview and API notes
  from the upstream repository.
- [`controller.md`](controller.md) — controller input methods and controller
  state.
- [`gamestate.md`](gamestate.md) — `GameState`, `PlayerState`, positions,
  projectiles, and related state values.
- [`enums.md`](enums.md) — buttons, characters, actions, stages, menus, and
  projectile enums.
- [`console.md`](console.md), [`menuhelper.md`](menuhelper.md),
  [`stages.md`](stages.md), [`framedata.md`](framedata.md), and
  [`logger.md`](logger.md) — the remaining API modules.

This image includes only the agent-friendly Markdown snapshots copied from the
arena repository's offline documentation on 2026-11-07. Use `read_docs` with a
topic name, and `search_docs` for a literal phrase; no browser or internet is
needed. Links in generated API pages retain their original `.html` targets:
read the corresponding Markdown topic instead. The original arena snapshot also
contains HTML/RST/static assets, but they are not needed in the team image.

The arena and validator use `melee==0.47.3`. API references can include generic
upstream examples; the bot contract always takes precedence. The supplied
LGPL-3 license is retained in `LICENSE.LGPL-3.txt`.

## Important project-specific constraint

The upstream overview includes information about online play. This project is
an offline event: bots must run through the shared local runner and must not add
or use online play. The repository's `AGENTS.md` and runner instructions take
precedence over generic upstream examples.

## Sources

- Rendered API documentation: <https://libmelee.readthedocs.io/en/latest/>
- Project overview: <https://github.com/vladfi1/libmelee/blob/master/README.md>
- Installed package name: `melee` (the libmelee Python API)

The HTML and Markdown copies are vendored for offline use and should be
refreshed from those sources when the libmelee version changes.
