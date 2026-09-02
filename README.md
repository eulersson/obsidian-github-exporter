<div align="center">
  <picture>
    <img style="height: 256px" alt="obsidian-github-exporter Logo" src="./logo.png" />
  </picture>
  <h1>Obsidian GitHub Exporter</h1>
</div>

This Obsidian plugin is intended to publish selected pages and their linked
media to a folder within a GitHub repository. You most likely want that
repository to be a Quartz repository if you want to publish it as live notes,
and therefore [Quartz' Guide on
Hosting](https://quartz.jzhao.xyz/hosting#cloudflare-pages) will be relevant for
you.

This project takes as reference the already existing [obsidian-digital-garden](https://github.com/oleeskild/obsidian-digital-garden).

# Features

- Pages marked with the `publish: true` property will be processed.
- Standalone `.html` files are published too, gated on an HTML comment marker
  `<!-- publish: true -->` (since HTML has no parsed frontmatter). Quartz copies
  them verbatim and serves them at their slugified path, e.g. `My Demo.html` ->
  `/My-Demo.html`.
- Embedded media is collected and uploaded alongside the note: `png`, `jpg`,
  `jpeg`, `gif`, `mp4`, `mp3`, `wav`, `ogg`, `m4a`, `pdf`.
- Scratch projects (`sb3`) are uploaded as attachments too. Obsidian cannot
  render them, so they are picked up from ordinary links (`[[game.sb3]]` or
  `[starter](game.sb3)`) as well as embeds.
- Deleted local notes and media will be deleted on the remote repository too.
- Copy the final published URL (quartz-style).
- Mask sensitive passages so they never leave the vault — see
  [Masking](#masking).
- Preview the exact bytes a note would publish, and dry-run a whole publish
  before committing anything.

# Commands

| Command | What it does |
| --- | --- |
| **Publish sync to GitHub** | Publishes every note marked `publish: true` and every marked `.html`, uploads their media, and removes anything on the remote no longer claimed — all in one commit. Also on the ribbon. |
| **Publish current file to GitHub** | Publishes just the active file and its media, in one commit. Skips the deletion sweep. |
| **Dry run: show what publishing would change** | Lists every add, update and delete without touching the remote. |
| **Preview publish output for current file** | Shows the exact bytes that would be committed, plus every masked region removed. |
| **Toggle publish property** | Adds or removes `publish: true` in the active note's frontmatter. |
| **Copy published URL** | Copies the note's Quartz URL to the clipboard. Needs **Hosted URL**. |

> [!NOTE]
> **Publish current file** ignores `publish: true`, so you can push a note
> before marking it — but the next full sync will delete it again unless the
> property is set, since the sweep only keeps what the sync itself publishes.

Progress is written to the developer console rather than a notice per file. The
summary at the end reports what changed.

# Masking

The target repository is public, so anything this plugin uploads is readable
even when Quartz does not render it. Wrapping a passage in `%%` is **not**
enough: Quartz strips Obsidian comments when it builds the HTML, but the
comment is still sitting there in the Markdown source on GitHub.

Masking removes the passage before the bytes are ever created. It is always on
— there is no switch to forget.

## Marking content

```markdown
%%mask-start%%
Everything here is removed at publish time, and still fully visible in
Obsidian — only the two markers are hidden in reading view.
%%mask-end%%

> [!private]
> A whole callout. Renders locally as a labelled block, gone on the site.

## Finances %%mask-section%%
A tagged heading takes its whole section with it, down to the next heading of
the same or a higher level.

Markers work inline too: salary is %%mask-start%%42k%%mask-end%%.

%% A plain Obsidian comment is stripped as well. %%
```

`<!--mask-start-->`, `<!--mask-end-->` and `<!--mask-section-->` are accepted as
aliases, which is what you want inside a standalone `.html` file.

`private` is the default callout type. Add more under **Private callout types**
in the settings — `secret`, `personal`, whatever you use. The plugin styles
`private` and `secret` red with an eye-off icon so masked blocks are obvious
while editing.

Masked content is removed outright — no placeholder is left behind. Media
embedded inside a masked region is neither uploaded nor kept on the remote.

Markers inside fenced code blocks are ignored, so a note can document this
syntax without masking itself.

> [!CAUTION]
> That protection depends on the fence. If a fence around a marker is ever
> removed, the marker becomes live: `%%mask-section%%` on a line starting with
> `#` turns into a tagged heading and masks everything down to the next heading
> of the same level. An *unterminated* fence is caught and blocks the publish,
> but a deleted one is not. Preview the note if you have edited around a fence.

## Rules and deny patterns

**Settings → GitHub Exporter → Masking** adds two rule tables:

- **Mask rules** remove every match from the published copy — a literal string
  or a regular expression. Code blocks are skipped unless the rule opts in.
- **Deny patterns** are checked against the finished bytes. A single match
  aborts the whole publish. This is the safety net for the passage you forgot
  to mark.

## What stops a publish

Masking fails closed. Any of these refuses to publish rather than guessing:

- an unclosed `%%mask-start%%`, a stray `%%mask-end%%`, or nested regions
- `%%mask-section%%` anywhere but on a heading
- a mask marker trapped inside an unterminated code fence, where it would be
  silently ignored
- an invalid rule, or a rule whose own output it keeps matching
- any deny pattern hit

## Verifying before you publish

- **Preview publish output for current file** shows the exact text that would
  be committed, plus where each masked region was removed.
- **Dry run: show what publishing would change** lists every add, update and
  delete without touching the remote.

## Change detection

Change detection compares the **masked** bytes against the blob already in the
repository, so it keeps working unchanged: a note is pushed only when the text
that would land on GitHub actually differs.

Two consequences worth knowing:

- Editing text *inside* a masked region produces no commit at all, so Quartz's
  git-derived date does not move for that edit.
- Changing a mask rule changes the output of every note it touches, and those
  notes are rewritten on the next publish. Notes it does not touch stay put.

> [!WARNING]
> Masking a passage that was **already published** removes it from the branch
> tip, not from the repository's history — the old blob is still reachable on a
> public repo. The plugin detects this case and says so after the commit;
> clearing it for good needs a history rewrite (`git filter-repo`, BFG) or a
> fresh branch.

# Configuration

- GitHub repository name, username, token, since it uses GitHub API (using
`Octokit`).
- Base URL where your HTML is being generated (optional, only for clipboard
copying the preview URL)

> [!NOTE]
> Your GitHub personal access token ideally should allow reading and writing to
> the quartz repository. Read [GitHub's
> guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)
> on the topic. A fine-grained token with **Content** access to your quartz repo
> is sufficient.

Example defaults (those are actually the ones I use):

- GitHub Token `github_pat_[...]`
- GitHub Username `eulersson`
- GitHub Repository `notes`
- Target Branch `main`
- Target Directory `content`
- Hosted URL `https://notes.ramn.dev`

# Reason

Sometimes projects like [Quartz](https://quartz.jzhao.xyz/) offer a very good solution
to generate static sites but it wants the notes to live within your repository, so at
every push Quartz filters the notes and generates the HTML static website under `publish/`
for GitHub Pages to serve. This also allows showing  the note's date based on the GitHub
object.

However for those who don't want to have their entire vault within the
`content/` (symlinked or not) within the `quartz` repo folder, this plugin was
developed, which basically by running an Obsidian action it publishes the pages
to the repository that generates the static website.

The [obsidian-digital-garden](https://github.com/oleeskild/obsidian-digital-garden) does
this for [Obsidian Digital Gardens](https://dg-docs.ole.dev/), but before pushing to
your GitHub repository it does many transformations we don't need if you simply
want to copy the file.

# Automatic Quartz Deployment

This serves only to publish the files to another repository, which in my case
it's a [Quartz](https://quartz.jzhao.xyz/) repository.

For deploying and hosting the quartz live application you should follow Quartz's
[Hosting Guide](https://quartz.jzhao.xyz/hosting), in my case I followed the
**Cloudflare Pages** workflow and it works very well.

## Required Cloudflare Pages build command

Cloudflare Pages clones the repository **shallow** (`--depth=1`), so the only
commit it sees is the tip of the branch. Quartz dates each note from "the last
commit that touched this file" (the `CreatedModifiedDate` transformer with
`git` in its `priority` list), and in a one-commit clone that is the same
commit for every file — so **every published note ends up dated at deploy
time**.

This is fixed in the Pages project settings (**Settings → Build → Build
command**), not in this repository — see `DEPLOYMENT.md` in the Quartz repo for
the full write-up:

```sh
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then git fetch --unshallow; fi && npx quartz build
```

The guard keeps the build working if the clone ever arrives complete — a bare
`git fetch --unshallow && npx quartz build` fails on a non-shallow repository.
Deepening the history is cheap: the shallow clone already carries all of
`content/Attachments`, so unshallowing only pulls the older blobs (measured at
+62 MB / +43 s on the `notes` repo).

> [!NOTE]
> The dates you get this way are the times *this plugin committed* each note,
> not the times you edited it in Obsidian. If you want the real edit times,
> put `created` / `updated` in the note's frontmatter — `frontmatter` outranks
> `git` in Quartz's `CreatedModifiedDate` priority list.

# Personal Workflow

If you want to use [Quartz](https://quartz.jzhao.xyz/) this is how I set it up:

- I forked the repository.
- I cloned the repository.
- Now the `v4` default branch will always sync the forked repository's one.
- I created my branch `custom` branching off `v4` to add my own customizations on top of them.
- I branched off `custom` with a `main` branch where this plugin will put all the markdown and file changes (within the
`content/` folder).

Then any push to main trigger the automatic deployment as you set up [Hosting
Guide](https://quartz.jzhao.xyz/hosting).

# Development

Follow [Obsidian's Development Guide](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin).

Source lives in `src/`; `npm run build` bundles it to `main.js`.

The masking engine under `src/mask/` is pure and has no Obsidian dependency, so
it is covered by tests:

```sh
npm test
```

Determinism is the property those tests exist to protect. Masking has to
produce the same bytes for the same input every time, or change detection sees
a difference on every publish and commits forever.
