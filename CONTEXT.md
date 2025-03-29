# obsidian-github-exporter

This Obsidian plugin is intended to publish selected pages and their linked media to GitHub. 

It takes as reference the already existing [obsidian-digital-garden](https://github.com/oleeskild/obsidian-digital-garden) which has been cloned here as reference into `./reference` in this
repository for you to investigate if need be, specially the part on the GitHub settings.

All the files in here are the template for a obsidian plugin, so most of the bootstrapping is done :D

# Features

- Pages marked with the `publish: true` property will be processed.
- Linked images and audios (only `.mp3` and `.wav` for now) are collected.
- Deleted local notes and media will be deleted on the remote repository too.
- Copy the final published URL (quartz-style). For that see the [Implementation](#implementation)

# Configuration

- GitHub repository name, username, token, since it uses GitHub API (using Octokit).
- Base URL where your HTML is being generated.

# Reason

Sometimes projects like [quartz](https://quartz.jzhao.xyz/) offer a very good solution
to generate static sites but it wants the notes to live within your repository, so at
every push Quartz filters the notes and generates the HTML static website under `publish/`
for GitHub Pages to serve. This also allows showing  the note's date based on the GitHub
object.

However for those who don't want to have their entire vault within the `content/` folder
of Quartz, this plugin was developed, which basically by running an Obsidian action it
publishes the pages to the repository that generates the static website.

The [obsidian-digital-garden](https://github.com/oleeskild/obsidian-digital-garden) does
this for [Obsidian Digital Gardens](https://dg-docs.ole.dev/), but before pushing to
your GitHub repository it does many tarnsformations we don't need if you simply want to
copy the file.

# Implementation

## Generating Publish URL links

For that we need to do the same quartz does: https://quartz.jzhao.xyz/advanced/paths

```
function sluggify(s: string): string {
  return s
    .split("/")
    .map((segment) =>
      segment
        .replace(/\s/g, "-")
        .replace(/&/g, "-and-")
        .replace(/%/g, "-percent")
        .replace(/\?/g, "")
        .replace(/#/g, ""),
    )
    .join("/") // always use / as sep
    .replace(/\/$/, "")
}
```