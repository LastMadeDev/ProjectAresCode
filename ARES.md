# Project Ares

Project Ares is a rebranded fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT). It keeps
everything upstream ships and changes how it looks and where it updates from. The fork is built so
upstream updates merge in with one command, usually with no hands at all.

## How the fork is built

Every Ares change to an upstream file comes from one script, never from a hand edit:

- `ares/rebrand.mjs` holds the brand as data: product name, app id, links, the ARES theme,
  sidebar art colors, and the files Ares owns outright (`ares/overrides/`, the icons in
  `ares/assets/icons/`). It is idempotent: running it twice changes nothing the second time.
- `ares/sync.mjs` merges upstream. For each conflicted file it checks whether our side equals
  `rebrand(merge base)`. If it does, our only change there was the brand, so the file becomes
  `rebrand(upstream)` and nothing is lost. Anything else is a real conflict and stops the sync.
- `ares/tools/make-icons.py` renders the app icons from the helm mark. Run it only when the art
  changes (`python -P ares/tools/make-icons.py`), then `node ares/rebrand.mjs`.

What stays upstream's on purpose: the `t3` CLI and its npm package, `@t3tools/*` package names,
`T3CODE_*` environment variables, the `~/.t3` data directory, `t3code://` links, agent-facing
text (MCP tool descriptions, evals), the mobile app, and the server CLI's help text. Renaming
those would break compatibility with upstream servers and turn every merge into a conflict.

## Updating from upstream

Automatic: `.github/workflows/ares-sync.yml` runs daily. A clean merge is pushed to `main` and
starts `ares-release.yml`. A sync that needs a hand opens an issue titled "Upstream sync needs a
hand" with the log. Set the repository variable `ARES_AUTO_RELEASE` to `false` to merge without
releasing.

By hand:

```sh
node ares/sync.mjs          # merge upstream/main (add --push to push when clean)
```

| Exit | Meaning                                                         | What to do                                                                                    |
| ---- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 0    | Merged, or already current                                      | Nothing.                                                                                      |
| 2    | Real conflict: an Ares feature edit overlaps an upstream change | Resolve the listed files, then `node ares/rebrand.mjs && git add -A && git commit --no-edit`. |
| 3    | A brand rule went stale: upstream moved the code a rule targets | Update that rule in `ares/rebrand.mjs`, then the same three commands.                         |

`git merge --abort` backs out of either case.

## Making changes in the fork

- Brand change (name, color, link, icon): edit `ares/rebrand.mjs` or `ares/assets/`, then run
  `node ares/rebrand.mjs`. Never edit the branded upstream file directly; the next sync would
  treat that as a real conflict.
- Feature change: prefer new files, and keep edits to upstream files small. Every line changed
  in an upstream file is a line that can conflict later.
- `node ares/rebrand.mjs --check` must pass before a release (the release workflow runs it).

## Releases and installing

`ares-release.yml` builds the Windows x64 installer on GitHub's Windows runner and publishes it
as release `v1.<date>.<run>` here. Installed apps update from these releases.

- Builds are unsigned, so Windows SmartScreen warns on first install ("More info", then "Run
  anyway"). Adding the Azure Trusted Signing secrets upstream documents in
  `docs/operations/release.md` and passing `--signed` turns signing on.
- Ares installs beside T3 Code (its own app id `com.lastmade.projectares` and Electron profile),
  and uses the same `~/.t3` data, so threads, settings, providers and secrets carry over.
- Only one app can run a server on `~/.t3` at a time. Quit T3 Code before opening Ares.
- No WSL backend, macOS or Linux builds yet; upstream's workflows for those need their own
  runners and secrets.

Upstream's own workflows (`ci.yml`, `release.yml` and the rest) are disabled in this repository
by the sync workflow, since they target upstream's runners and secrets.
