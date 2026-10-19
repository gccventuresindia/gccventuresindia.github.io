#!/usr/bin/env node
/**
 * GCC Ventures India - blog publishing tool
 * ------------------------------------------
 * The site is a plain static GitHub Pages repo with no build step. Previously
 * every post had to be wired into three places by hand: the file, insights.html
 * and sitemap.xml. Miss one and the post silently disappears from the site.
 * This script does all three, plus the audit.
 *
 * USAGE (run in GitHub Codespaces from the repo root):
 *
 *   node publish-blog.mjs --file drafts/my-post.html \
 *     --title "My Post Title" \
 *     --category gcc \
 *     --date 2026-10-19 \
 *     --author Sanjeev \
 *     --read 8
 *
 *   node publish-blog.mjs --check      # audit only, changes nothing
 *
 * CATEGORIES: gcc | transformation | ventures | cybersecurity | ai-technology
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(ROOT, 'blog');
const INSIGHTS = join(ROOT, 'insights.html');
const SITEMAP = join(ROOT, 'sitemap.xml');
const SITE = 'https://www.gccventuresindia.com';

const VALID_CATEGORIES = ['gcc', 'transformation', 'ventures', 'cybersecurity', 'ai-technology'];

const QUOTE = String.fromCharCode(34);
const GRID_OPEN = '<div class=' + QUOTE + 'articles-grid' + QUOTE + '>';
const TICKER_OPEN = '<ul class=' + QUOTE + 'ticker-list' + QUOTE + '>';

/* ── argument parsing ─────────────────────────────────────────────── */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(argv[i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

/* ── slugify: the whole reason colons broke the repo ──────────────── */
function slugify(title) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

function assertSafeSlug(slug) {
  if (!slug) throw new Error('Could not derive a slug from that title.');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(
      'Unsafe slug "' + slug + '".\n' +
      '  Filenames must be lowercase a-z, 0-9 and single dashes only.\n' +
      '  Colons, spaces and other punctuation break Windows and Codespaces clones.\n' +
      '  Write the title as: --title "How to Set Up a GCC in India"'
    );
  }
}

/* ── HTML helpers ─────────────────────────────────────────────────── */
function read(p) { return readFileSync(p, 'utf8'); }

function stripTags(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&middot;/g, '.').replace(/&mdash;/g, '-')
    .replace(/&ndash;/g, '-').replace(/&rarr;/g, '').replace(/&#x27;/g, "'")
    .replace(/&rsquo;/g, "'").replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaOf(html, name) {
  let m = html.match(new RegExp('<meta[^>]+(?:name|property)=' + QUOTE + name + QUOTE + '[^>]*content=' + QUOTE + '([^' + QUOTE + ']*)' + QUOTE, 'i'));
  if (m) return m[1];
  m = html.match(new RegExp('<meta[^>]+content=' + QUOTE + '([^' + QUOTE + ']*)' + QUOTE + '[^>]*(?:name|property)=' + QUOTE + name + QUOTE, 'i'));
  return m ? m[1] : '';
}

/**
 * Find the index just past the closing tag that matches the opening tag at `start`.
 * Counts nested <div> / </div> pairs, so it does not depend on indentation or
 * line endings.
 */
function endOfElement(html, start, openTag, closeTag) {
  let depth = 0;
  let i = start;
  while (i < html.length) {
    const nextOpen = html.indexOf(openTag, i);
    const nextClose = html.indexOf(closeTag, i);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + openTag.length;
    } else {
      depth--;
      i = nextClose + closeTag.length;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* ── canonical / date injection ───────────────────────────────────── */
function setTag(html, pattern, tag) {
  if (pattern.test(html)) return html.replace(pattern, tag);
  return null;
}

function injectCanonical(html, canonical) {
  const tag = '<link rel=' + QUOTE + 'canonical' + QUOTE + ' href=' + QUOTE + canonical + QUOTE + '/>';
  const re = /<link\s+rel="canonical"[^>]*\/?>/i;
  if (re.test(html)) return html.replace(re, tag);
  const anchor = html.match(/<meta\s+name="viewport"[^>]*\/?>/i);
  if (anchor) {
    const at = anchor.index + anchor[0].length;
    return html.slice(0, at) + '\n' + tag + html.slice(at);
  }
  throw new Error('Could not find a <head> anchor to insert the canonical tag.');
}

function injectPublishedTime(html, date) {
  const tag = '<meta property=' + QUOTE + 'article:published_time' + QUOTE + ' content=' + QUOTE + date + QUOTE + '/>';
  const re = /<meta[^>]+article:published_time[^>]*\/?>/i;
  if (re.test(html)) return html.replace(re, tag);
  const anchor = html.match(/<link\s+rel="canonical"[^>]*\/?>/i);
  if (anchor) {
    const at = anchor.index + anchor[0].length;
    return html.slice(0, at) + '\n' + tag + html.slice(at);
  }
  return html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parts = String(iso).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return iso;
  return String(parts[2]).padStart(2, '0') + ' ' + MONTHS[parts[1] - 1] + ' ' + parts[0];
}

/* ── read every post off disk ─────────────────────────────────────── */
function readPosts() {
  const files = readdirSync(BLOG_DIR).filter(f => f.endsWith('.html'));

  const bad = files.filter(f => !/^[a-z0-9]+(-[a-z0-9]+)*\.html$/.test(f));
  if (bad.length) {
    throw new Error(
      'Unsafe filename(s) in blog/:\n' +
      bad.map(f => '  - ' + f).join('\n') +
      '\nRename these to lowercase slugs and re-run this script.\n'
    );
  }

  return files.map(file => {
    const html = read(join(BLOG_DIR, file));
    const slug = file.replace(/\.html$/, '');
    const url = '/blog/' + file;

    const canonicalM = html.match(/<link\s+rel="canonical"[^>]*href=["']([^"']*)["']/i);
    const publishedM = html.match(/<meta[^>]+article:published_time[^>]*content=["']([^"']*)["']/i);
    const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

    return {
      file,
      slug,
      url,
      canonical: canonicalM ? canonicalM[1] : null,
      date: publishedM ? publishedM[1] : null,
      title: h1M ? stripTags(h1M[1]) : slug,
      description: metaOf(html, 'description'),
    };
  });
}

/* ── sitemap ──────────────────────────────────────────────────────── */
const CORE_PAGES = [
  ['/', '1.0', 'weekly'], ['/index.html', '0.9', 'monthly'],
  ['/offerings.html', '0.9', 'monthly'], ['/services.html', '0.9', 'monthly'],
  ['/contact.html', '0.9', 'monthly'], ['/start-venture.html', '0.8', 'monthly'],
  ['/exit-readiness.html', '0.8', 'monthly'], ['/about.html', '0.8', 'monthly'],
  ['/faq.html', '0.8', 'monthly'], ['/insights.html', '0.8', 'weekly'],
  ['/team.html', '0.7', 'monthly'], ['/cybersecurity.html', '0.7', 'monthly'],
  ['/thank-you.html', '0.3', 'yearly'],
];

function buildSitemap(posts) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  for (const [url, priority, freq] of CORE_PAGES) {
    out.push('  <url>');
    out.push('    <loc>' + SITE + url + '</loc>');
    out.push('    <changefreq>' + freq + '</changefreq>');
    out.push('    <priority>' + priority + '</priority>');
    out.push('  </url>');
  }
  const sorted = [...posts].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  for (const p of sorted) {
    out.push('  <url>');
    out.push('    <loc>' + SITE + p.url + '</loc>');
    if (p.date) out.push('    <lastmod>' + p.date + '</lastmod>');
    out.push('    <changefreq>monthly</changefreq>');
    out.push('    <priority>0.7</priority>');
    out.push('  </url>');
  }
  out.push('</urlset>');
  return out.join('\n') + '\n';
}

/* ── insights.html grid ───────────────────────────────────────────── */
const CARD_OPEN_RE = /<div class="article-card reveal" data-category="([^"]+)">/g;

function extractGridCards(html) {
  const gridStart = html.indexOf(GRID_OPEN);
  if (gridStart === -1) throw new Error('insights.html: could not find the articles-grid container.');
  const gridEnd = endOfElement(html, gridStart, '<div', '</div>');
  if (gridEnd === -1) throw new Error('insights.html: articles-grid container is not closed.');
  const inner = html.slice(gridStart + GRID_OPEN.length, gridEnd);

  const out = [];
  CARD_OPEN_RE.lastIndex = 0;
  let m;
  while ((m = CARD_OPEN_RE.exec(inner)) !== null) {
    const cardEnd = endOfElement(inner, m.index, '<div', '</div>');
    const raw = inner.slice(m.index, cardEnd === -1 ? inner.length : cardEnd);
    const href = raw.match(/href="(\/blog\/[^"]+)"/);
    const titleM = raw.match(/class="article-title">([\s\S]*?)<\/h3>/);
    const excerptM = raw.match(/class="article-excerpt">([\s\S]*?)<\/p>/);
    const metaM = raw.match(/class="article-meta">([\s\S]*?)<\/p>/);
    out.push({
      category: m[1],
      url: href ? href[1] : null,
      title: titleM ? stripTags(titleM[1]) : '',
      excerpt: excerptM ? stripTags(excerptM[1]) : '',
      meta: metaM ? stripTags(metaM[1]) : '',
    });
  }
  return out;
}

function cardTag(category) {
  if (category === 'ai-technology') return 'AI &amp; Technology';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function buildCard({ category, url, title, excerpt, date, readMins, author }) {
  const bits = [];
  if (date) bits.push(formatDate(date));
  if (readMins) bits.push(readMins + ' min read');
  if (author) bits.push('By ' + author);
  const meta = bits.length ? '\n        <p class="article-meta">' + escapeHtml(bits.join(' \u00b7 ')) + '</p>' : '';

  return [
    '      <div class="article-card reveal" data-category="' + escapeHtml(category) + '">',
    '        <span class="article-tag">' + cardTag(category) + '</span>',
    '        <h3 class="article-title">' + escapeHtml(title) + '</h3>',
    '        <p class="article-excerpt">' + escapeHtml(excerpt) + '</p>' + meta,
    '        <a href="' + escapeHtml(url) + '" class="article-cta">Read &rarr;</a>',
    '      </div>'
  ].join('\n');
}

/* ── audit ────────────────────────────────────────────────────────── */
function audit(posts) {
  const problems = [];
  const insights = read(INSIGHTS);
  const cards = extractGridCards(insights);
  const linked = new Set(cards.map(c => c.url).filter(Boolean));

  const featuredM = insights.match(/<div class="featured-card[\s\S]*?href="(\/blog\/[^"]+)"/);
  const featuredUrl = featuredM ? featuredM[1] : null;
  if (featuredUrl) linked.add(featuredUrl);

  for (const p of posts) {
    if (!linked.has(p.url)) problems.push('NOT LINKED: ' + p.url + ' is on disk but not on insights.html');
    const expected = SITE + p.url;
    if (!p.canonical) problems.push('NO CANONICAL: ' + p.url);
    else if (p.canonical !== expected) problems.push('WRONG CANONICAL: ' + p.url + ' points at ' + p.canonical);
    if (!p.date) problems.push('NO DATE: ' + p.url + ' - add <meta property="article:published_time"> to the post');
    if (!p.description) problems.push('NO META DESCRIPTION: ' + p.url);
  }
  for (const url of linked) {
    if (!posts.some(p => p.url === url)) problems.push('BROKEN LINK: insights.html points at ' + url + ' which does not exist');
  }

  const seen = new Set();
  for (const c of cards) {
    if (!c.url) continue;
    if (seen.has(c.url)) problems.push('DUPLICATE CARD: ' + c.url + ' appears more than once on insights.html');
    seen.add(c.url);
  }

  try {
    const sitemap = read(SITEMAP);
    const openTags = (sitemap.match(/<url>/g) || []).length;
    const closeTags = (sitemap.match(/<\/url>/g) || []).length;
    if (openTags !== closeTags) {
      problems.push('INVALID SITEMAP: ' + openTags + ' <url> open tags but ' + closeTags + ' close tags');
    }
    for (const p of posts) {
      if (!sitemap.includes(p.url)) problems.push('NOT IN SITEMAP: ' + p.url);
    }
  } catch (e) {
    problems.push('sitemap.xml could not be read: ' + (e && e.message ? e.message : e));
  }

  return { problems, cards, featuredUrl };
}

/* ── rebuild insights.html grid + ticker from posts on disk ───────── */
/* newest first; ties keep the order they already appeared in */
function byNewest(a, b) {
  const d = String(b.date || '').localeCompare(String(a.date || ''));
  if (d !== 0) return d;
  return (a._i || 0) - (b._i || 0);
}

function rebuildInsights(posts, cards, overrides) {
  const ov = overrides || {};
  const byUrl = {};
  cards.forEach((c, i) => { if (c.url) byUrl[c.url] = Object.assign({}, c, { _i: i }); });

  let html = read(INSIGHTS);

  const featuredM = html.match(/<div class="featured-card[\s\S]*?href="(\/blog\/[^"]+)"/);
  const featuredUrl = featuredM ? featuredM[1] : null;

  const ordered = posts
    .map((p, i) => Object.assign({}, p, { _i: i }))
    .sort(byNewest);

  const rebuilt = ordered
    .filter(p => p.url !== featuredUrl)
    .map(p => {
      const prior = byUrl[p.url];
      const o = ov[p.url] || {};
      const mins = (o.readMins !== undefined && o.readMins !== null)
        ? o.readMins
        : (prior && prior.meta.match(/(\d+)\s*min/i) ? prior.meta.match(/(\d+)\s*min/i)[1] : null);
      const by = (o.author !== undefined && o.author !== null)
        ? o.author
        : (prior && prior.meta.match(/By\s+([A-Za-z]+)/) ? prior.meta.match(/By\s+([A-Za-z]+)/)[1] : null);
      return buildCard({
        category: o.category || (prior ? prior.category : 'gcc'),
        url: p.url,
        title: prior && prior.title ? prior.title : p.title,
        excerpt: prior && prior.excerpt ? prior.excerpt : p.description,
        date: p.date,
        readMins: mins,
        author: by,
      });
    })
    .join('\n\n');

  // Replace everything between the grid's <div> and its matching </div>,
  // then re-emit that closing </div> (endOfElement returns just past it).
  const gridStart = html.indexOf(GRID_OPEN);
  if (gridStart === -1) throw new Error('insights.html: could not find the articles-grid container.');
  const gridEnd = endOfElement(html, gridStart, '<div', '</div>');
  if (gridEnd === -1) throw new Error('insights.html: articles-grid container is not closed.');
  html = html.slice(0, gridStart + GRID_OPEN.length) + '\n' + rebuilt + '\n    </div>' + html.slice(gridEnd);

  // Ticker: latest 11, duplicated once for a seamless marquee loop
  const latest = ordered.slice(0, 11);

  const items = latest.map((p, i) => {
    const label = i < 2 ? '<span class="ticker-new">New</span> ' : '';
    const date = p.date ? ' <span class="ticker-date">&middot; ' + escapeHtml(formatDate(p.date)) + '</span>' : '';
    return '        <li><a class="ticker-item" href="' + escapeHtml(p.url) + '">' + label + escapeHtml(p.title) + date + '</a></li>';
  });

  const tickerStart = html.indexOf(TICKER_OPEN);
  if (tickerStart === -1) throw new Error('insights.html: could not find the ticker-list.');
  const tickerEnd = html.indexOf('</ul>', tickerStart);
  if (tickerEnd === -1) throw new Error('insights.html: ticker-list is not closed.');

  const tickerBlock =
    '\n' + items.join('\n') +
    '\n        <!-- duplicate of the list above, for a seamless marquee loop -->' +
    '\n' + items.join('\n') +
    '\n      ';
  html = html.slice(0, tickerStart + TICKER_OPEN.length) + tickerBlock + html.slice(tickerEnd);

  writeFileSync(INSIGHTS, html, 'utf8');

  const cats = new Set(
    ordered
      .filter(p => p.url !== featuredUrl)
      .map(p => (ov[p.url] && ov[p.url].category) || (byUrl[p.url] ? byUrl[p.url].category : 'gcc'))
      .filter(Boolean)
  );
  return { total: posts.length, categories: cats.size };
}

/* ── main ─────────────────────────────────────────────────────────── */
function runCheck() {
  const posts = readPosts();
  const { problems, cards } = audit(posts);
  console.log('');
  console.log('  GCC Ventures India - site audit');
  console.log('  ' + '-'.repeat(52));
  console.log('  posts on disk : ' + posts.length);
  console.log('  cards on page : ' + cards.length);
  if (!problems.length) {
    console.log('');
    console.log('  ALL CLEAR. Every post is linked, canonical, dated and in the sitemap.');
    console.log('');
    return;
  }
  console.log('');
  console.log('  ' + problems.length + ' problem(s):');
  console.log('');
  problems.forEach(p => console.log('   ! ' + p));
  console.log('');
}

function runPublish() {
  const src = join(ROOT, String(args.file));
  if (!existsSync(src)) throw new Error('Source file not found: ' + args.file);

  let html = read(src);

  let title = (typeof args.title === 'string') ? args.title : null;
  if (!title) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) title = stripTags(h1[1]);
  }
  if (!title) throw new Error('Could not read a title. Pass --title "Your Title".');

  // An explicit --slug is honoured as typed and validated, so a typo produces a
  // clear error rather than a silently different URL. Without --slug the title
  // is slugified, which is what keeps colons out of filenames.
  let slug;
  if (typeof args.slug === 'string' && args.slug) {
    slug = args.slug;
    assertSafeSlug(slug);
  } else {
    slug = slugify(title);
    assertSafeSlug(slug);
  }

  const category = (typeof args.category === 'string') ? args.category : 'gcc';
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error('Unknown category "' + category + '". Use one of: ' + VALID_CATEGORIES.join(', '));
  }

  const date = (typeof args.date === 'string') ? args.date : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Bad date "' + date + '". Use YYYY-MM-DD.');

  html = injectCanonical(html, SITE + '/blog/' + slug + '.html');
  html = injectPublishedTime(html, date);

  writeFileSync(join(BLOG_DIR, slug + '.html'), html, 'utf8');
  console.log('  wrote  blog/' + slug + '.html');

  let posts = readPosts();
  writeFileSync(SITEMAP, buildSitemap(posts), 'utf8');
  console.log('  wrote  sitemap.xml (' + posts.length + ' posts)');

  const { cards } = audit(posts);
  const overrides = {};
  overrides['/blog/' + slug + '.html'] = {
    category,
    readMins: (typeof args.read === 'string' && args.read) ? args.read : null,
    author: (typeof args.author === 'string' && args.author) ? args.author : null,
  };
  const stats = rebuildInsights(posts, cards, overrides);
  console.log('  wrote  insights.html');

  console.log('');
  console.log('  Published : "' + title + '"');
  console.log('  URL       : ' + SITE + '/blog/' + slug + '.html');
  console.log('  Category  : ' + category);
  console.log('  Date      : ' + formatDate(date));
  console.log('  Counter   : ' + stats.total + ' articles published, ' + stats.categories + ' topics covered');
  console.log('');

  const after = audit(readPosts());
  if (after.problems.length) {
    console.log('  ' + after.problems.length + ' outstanding issue(s):');
    after.problems.forEach(p => console.log('   ! ' + p));
    console.log('');
  }
}

try {
  if (args['check']) runCheck();
  else if (args.file) runPublish();
  else {
    console.error('Nothing to do. Use --file <path> to publish, or --check to audit.');
    process.exit(1);
  }
} catch (err) {
  console.error('');
  console.error('  ERROR: ' + (err && err.message ? err.message : err));
  console.error('');
  process.exit(1);
}