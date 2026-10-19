# GCC Ventures India

Global Capability · Transformation · Value Creation
Bengaluru, India

We help global enterprises design, launch and scale high-performance Global
Capability Centres in India and help venture founders reach the value they
have built.

🌐 [gccventuresindia.com](https://www.gccventuresindia.com)

---

## Publishing a new blog post

This is a plain static site — GitHub Pages serves the files as they are, with no
build step. `publish-blog.mjs` does the wiring so a post never gets orphaned.

Open the repo in **GitHub Codespaces** and run from the repo root:

```bash
node publish-blog.mjs \
  --file drafts/my-post.html \
  --title "My Post Title" \
  --category gcc \
  --date 2026-10-19 \
  --author Sanjeev \
  --read 8
```

Categories: `gcc` · `transformation` · `ventures` · `cybersecurity` · `ai-technology`

The script writes `blog/<slug>.html`, injects the canonical and the
`article:published_time`, rebuilds `insights.html` (article grid, latest-publish
ticker and the published counter) and regenerates `sitemap.xml`. Then commit
and push.

### Why the tool exists

Posts used to be wired in by hand into three places — the file, `insights.html`
and `sitemap.xml`. Missing one meant the post silently vanished from the site.
In September 2026 nine of eighteen posts were invisible for exactly that reason.

### Filenames

Filenames must be lowercase `a-z`, `0-9` and single dashes: `blog/my-post.html`.
Colons and spaces break Windows and Codespaces clones outright. The script
slugifies the title for you, and rejects an unsafe `--slug` override.

### Audit before pushing

```bash
node publish-blog.mjs --check
```

Checks that every post is linked from `insights.html`, has a correct canonical
and a publish date, is in `sitemap.xml`, and that the sitemap XML is well formed.
Exit code 0 means the site is consistent.
