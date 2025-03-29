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
- Linked images and audios (only `.mp3` and `.wav` for now) are collected.
- Deleted local notes and media will be deleted on the remote repository too.
- Copy the final published URL (quartz-style).

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
