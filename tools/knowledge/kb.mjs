#!/usr/bin/env node
// Unified Knowledge Base: CLI, MCP server (stdio) and Claude Code hooks in one file.
// No dependencies, Node 18+. Concept and usage: tools/knowledge/README.md
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import os from 'node:os';

export const VERSION = '0.3.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const AUDIENCES = { business: 'Wirtschaft', domain: 'Fachlichkeit', tech: 'Technik' };
const AUDIENCE_ALIASES = {
  business: 'business', wirtschaft: 'business', management: 'business', vertrieb: 'business',
  domain: 'domain', fachlichkeit: 'domain', fachlich: 'domain', fach: 'domain',
  tech: 'tech', technik: 'tech', technologie: 'tech', technical: 'tech', dev: 'tech',
};
export const INTERN_NOTICE =
  'INTERN (private Wissensquelle): nur zum Verstehen verwenden. Nicht wörtlich oder sinngemäß in Code, Kommentare, ' +
  'Commits, Issues, PRs oder öffentliche Doku übernehmen; Projektwissen auch nicht in HBT-weites Wissen.';
/** Who may read a source: public < company (all employees) < project (project members only). */
export const LEVELS = { public: 0, company: 1, project: 2 };

// ---------------------------------------------------------------- config

const DEFAULT_PUBLIC = {
  name: null,
  sources: [{ glob: '*.md' }, { glob: 'docs/**/*.md' }, { glob: '*/README.md' }],
  glossaries: ['**/*glossar*.md', '**/*glossary*.md'],
  exclude: ['**/node_modules/**', '**/target/**', '**/build/**', '**/dist/**', '**/.git/**', '.knowledge-intern/**'],
};
const DEFAULT_PRIVATE = {
  sources: [{ glob: '**/*.md' }],
  glossaries: ['**/*glossar*.md', '**/*glossary*.md'],
  exclude: ['**/node_modules/**', '**/.git/**'],
  sensitiveTerms: [],
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

export function findRoot(start = process.cwd()) {
  if (process.env.KB_ROOT) return path.resolve(process.env.KB_ROOT);
  if (process.env.CLAUDE_PROJECT_DIR) return path.resolve(process.env.CLAUDE_PROJECT_DIR);
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'knowledge.json')) || fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

export function resolvePrivateDir(root, config) {
  const candidates = [];
  if (process.env.KB_PRIVATE_DIR) candidates.push([path.resolve(root, process.env.KB_PRIVATE_DIR), 'KB_PRIVATE_DIR']);
  const local = readJson(path.join(root, '.knowledge.local.json'));
  if (local?.privateDir) candidates.push([path.resolve(root, local.privateDir), '.knowledge.local.json']);
  const parent = path.dirname(root);
  candidates.push([path.join(parent, `${path.basename(root)}-knowledge`), 'Nachbarordner']);
  if (config.name) candidates.push([path.join(parent, `${config.name}-knowledge`), 'Nachbarordner']);
  candidates.push([path.join(root, '.knowledge-intern'), '.knowledge-intern (gitignored)']);
  // an empty folder (e.g. left behind after moving the repo into a vault) is not a sidecar
  const usable = (dir) => {
    try { return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).some((n) => n === 'knowledge.json' || /\.md$/i.test(n) || (n !== '.git' && !n.startsWith('.'))); } catch { return false; }
  };
  for (const [dir, via] of candidates) {
    if (usable(dir)) return { dir, via };
  }
  return { dir: null, via: null, tried: candidates.map(([d]) => d) };
}

const posix = (p) => p.split(path.sep).join('/');
const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
const expandHome = (d) => String(d).replace(/^~(?=$|[\\/])/, os.homedir());

export function userConfigFile() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'knowledge', 'sources.json');
}

/** `KB_SOURCES="hbt=../<firmenwissen>;x=/abs/dir"` */
function parseSourcesEnv(s) {
  return String(s || '').split(/[;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf('=');
    return i > 0 ? { id: x.slice(0, i).trim(), dir: x.slice(i + 1).trim() } : { dir: x };
  });
}

/**
 * Private knowledge sources besides the public repository. Exactly one project sidecar (level `project`,
 * id `intern`) plus any number of company-wide sources (level `company`, e.g. id `hbt`). Their names and
 * paths live only in local configuration, never in the public repository.
 */
export function resolveSources(root, pub, priv) {
  const sources = [];
  const seen = new Set();
  // the project this repository is: a project source from a shared configuration only loads for its own project
  const projectNames = [pub.name, path.basename(root)].filter(Boolean).map((x) => String(x).toLowerCase());
  const forThisProject = (cfg) => asList(cfg.project).some((p) => projectNames.includes(p.toLowerCase()));
  const add = (dir, via, wanted = {}) => {
    const abs = path.resolve(root, expandHome(dir));
    if (seen.has(abs) || !isDir(abs) || abs === path.resolve(root)) return;
    const cfg = { ...DEFAULT_PRIVATE, ...(readJson(path.join(abs, 'knowledge.json')) || {}) };
    const level = cfg.level === 'company' || cfg.level === 'project' ? cfg.level : wanted.level || 'company';
    if (level === 'project' && wanted.matchProject && !forThisProject(cfg)) return;
    // a sidecar named directly (KB_PRIVATE_DIR, privateDir, neighbour folder) may lack `project`, but must not name another one
    if (level === 'project' && cfg.project && !forThisProject(cfg)) return;
    seen.add(abs);
    let id = level === 'project' && !sources.some((s) => s.level === 'project')
      ? 'intern'
      : String(wanted.id || cfg.id || path.basename(abs).replace(/-knowledge$/, '')).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (id === 'public' || sources.some((s) => s.id === id)) id = `${id}-${sources.length + 1}`;
    const label = level === 'project' ? 'INTERN' : `INTERN:${String(cfg.label || id).toUpperCase()}`;
    sources.push({
      id, dir: abs, via, level, config: cfg, label, tag: `[${label}] `,
      module: String(cfg.module || (level === 'company' ? cfg.id || id : cfg.project || path.basename(abs).replace(/-knowledge$/, ''))),
      adrPrefix: String(cfg.adrPrefix || (level === 'project' ? 'I' : id)).toUpperCase().replace(/[^A-Z]/g, '') || 'X',
    });
  };
  if (priv.dir) add(priv.dir, priv.via, { level: 'project' });
  for (const s of parseSourcesEnv(process.env.KB_SOURCES)) add(s.dir, 'KB_SOURCES', { ...s, matchProject: true });
  const local = readJson(path.join(root, '.knowledge.local.json'));
  for (const s of local?.sources || []) add(s.dir, '.knowledge.local.json', { ...s, matchProject: true });
  for (const s of readJson(userConfigFile())?.sources || []) add(s.dir, userConfigFile(), { ...s, matchProject: true });
  // modular vaults: a folder whose subfolders are knowledge modules (only those the reader may see are cloned there)
  const vaults = [
    ...String(process.env.KB_VAULTS || '').split(/[;\n]/).map((x) => x.trim()).filter(Boolean),
    ...(local?.vaults || []), ...(readJson(userConfigFile())?.vaults || []),
  ];
  for (const v of vaults) {
    const vdir = path.resolve(root, expandHome(v));
    let entries = [];
    try { entries = fs.readdirSync(vdir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const cfg = readJson(path.join(vdir, e.name, 'knowledge.json'));
      if (cfg?.level === 'company') add(path.join(vdir, e.name), `Vault ${v}`);
      else if ((cfg?.level === 'project' || (cfg && !cfg.level && cfg.project)) && forThisProject(cfg)) {
        add(path.join(vdir, e.name), `Vault ${v}`, { level: 'project' });
      }
    }
  }
  if (process.env.KB_DISCOVER !== '0' && pub.discoverCompanySources !== false) {
    // company-wide knowledge checked out next to the project declares itself with "level": "company"
    const parent = path.dirname(root);
    let entries = [];
    try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { /* ignore */ }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const cfg = readJson(path.join(parent, e.name, 'knowledge.json'));
      if (cfg?.level === 'company') add(path.join(parent, e.name), 'Nachbarordner');
    }
  }
  return sources;
}

export function loadConfig(root) {
  const pub = { ...DEFAULT_PUBLIC, ...(readJson(path.join(root, 'knowledge.json')) || {}) };
  const found = resolvePrivateDir(root, pub);
  const sources = resolveSources(root, pub, found);
  const project = sources.find((s) => s.level === 'project');
  const priv = project ? { dir: project.dir, via: project.via } : { dir: null, via: null, tried: found.tried || [found.dir].filter(Boolean) };
  return { root, public: pub, private: priv, privateConfig: project?.config || null, sources };
}

export function sourceById(kb, id) {
  if (id === 'intern') return kb.config.sources.find((s) => s.level === 'project') || null;
  return kb.config.sources.find((s) => s.id === id) || null;
}

// ---------------------------------------------------------------- files

export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}
const matchAny = (rel, globs) => (globs || []).some((g) => globToRegex(g).test(rel));

function walk(dir, base = dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || (e.isDirectory() && e.name.startsWith('.'))) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile() && /\.md$/i.test(e.name)) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function sourceFor(rel, cfg) {
  for (const s of cfg.sources || []) if (globToRegex(s.glob).test(rel)) return s;
  return null;
}

// ---------------------------------------------------------------- parsing

const unquote = (s) => s.replace(/^(["'])(.*)\1$/, '$2');

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const mm = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v === '') {
      const list = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) list.push(unquote(lines[++i].replace(/^\s*-\s+/, '').trim()));
      v = list.length ? list : '';
    } else if (/^\[.*\]$/.test(v)) {
      v = v.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
    } else v = unquote(v);
    meta[mm[1].toLowerCase()] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

export function normalizeAudience(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,\s]+/);
  return [...new Set(list.map((a) => AUDIENCE_ALIASES[String(a).toLowerCase()]).filter(Boolean))];
}

export function slugify(s) {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'abschnitt';
}

function firstParagraph(lines, from) {
  const buf = [];
  let fence = false;
  for (let i = from; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('```')) { fence = !fence; if (buf.length) break; continue; }
    if (fence) continue;
    if (!l) { if (buf.length) break; continue; }
    if (/^(#|\||[-*+] |\d+\. |>|<|!\[)/.test(l)) { if (buf.length) break; continue; }
    buf.push(l);
  }
  const text = buf.join(' ').replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/!?\[\[([^\]]+)\]\]/g, (m, a) => a.split('#')[0])
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '');
  return text.length > 240 ? `${text.slice(0, 237).replace(/\s+\S*$/, '')} …` : text;
}

export function parseDoc(rel, text, scope, source = {}, prefix = scope) {
  const clean = text.replace(/^﻿/, '');
  const { meta, body } = parseFrontmatter(clean);
  const bodyLine = clean.slice(0, clean.length - body.length).split('\n').length - 1;
  const lines = body.split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
  const title = meta.title || (h1 >= 0 ? lines[h1].replace(/^#\s+/, '').trim() : path.basename(rel, path.extname(rel)));
  const id = `${prefix}:${rel}`;
  const doc = {
    id, scope, rel, title,
    summary: meta.summary || source.summary || firstParagraph(lines, h1 + 1),
    audience: normalizeAudience(meta.audience).length ? normalizeAudience(meta.audience)
      : normalizeAudience(source.audience).length ? normalizeAudience(source.audience)
        : ['begriff', 'term'].includes(String(meta.type || '').toLowerCase()) ? ['business', 'domain', 'tech'] : [],
    tags: Array.isArray(meta.tags) ? meta.tags : meta.tags ? String(meta.tags).split(/,\s*/) : [],
    owner: meta.owner || null,
    reviewed: meta.reviewed || null,
    visibility: meta.visibility || (scope === 'intern' ? 'intern' : 'public'),
    type: meta.type || source.type || null,
    boost: Number(source.boost) || 1,
    language: meta.language || source.language || null,
    meta, body, bodyLine, sections: [],
  };
  // sections: intro + one per H2/H3 heading (outside code fences)
  const used = new Set();
  let cur = { heading: title, level: 1, start: 0, lines: [] };
  const stack = [];
  const flush = () => {
    const text = cur.lines.join('\n').trim();
    if (!text && cur.level === 1) return;
    let slug = cur.level === 1 ? '' : slugify(cur.heading);
    if (slug) { let n = 2; const b = slug; while (used.has(slug)) slug = `${b}-${n++}`; used.add(slug); }
    doc.sections.push({
      id: slug ? `${id}#${slug}` : id, heading: cur.heading, level: cur.level,
      trail: [title, ...cur.trail || []].join(' › '), text, line: cur.start + 1,
    });
  };
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fence = !fence;
    const hm = !fence && /^(#{2,3})\s+(.*\S)\s*$/.exec(l);
    if (hm) {
      flush();
      const level = hm[1].length;
      const heading = hm[2].replace(/[`*]/g, '');
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, heading });
      cur = { heading, level, start: i, lines: [], trail: stack.map((s) => s.heading) };
    } else if (i !== h1) cur.lines.push(l);
  });
  flush();
  return doc;
}

export const termAnchor = (term) => `begriff-${slugify(term)}`;
const splitList = (s) => (s || '').split(/\s*[,;]\s*/).map((x) => x.replace(/[.\s]+$/, '').trim()).filter((x) => x && !/^[–—-]$/.test(x));
const splitRow = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
const COLUMN_ROLES = [
  ['avoid', /nicht verwenden|statt|veraltet|synonym|avoid|deprecated|don.t use/i],
  ['code', /code/i],
  ['term', /begriff|term|name|wort/i],
  ['def', /bedeutung|definition|beschreibung|erkl|meaning/i],
];

/**
 * Glossary entries = the project's domain language. Tables are read by their header:
 * „Begriff“ (canonical term, code names in parentheses), „Bedeutung“, optional „Nicht verwenden“
 * (synonyms to avoid) and „Im Code“. Lists: `- **Begriff** (Alias): Bedeutung. Nicht verwenden: X, Y`
 */
export function parseGlossary(doc) {
  const entries = [];
  const clean = (s) => s.replace(/<[^>]+>/g, '').replace(/\*\*|`/g, '').trim();
  const lines = doc.body.split(/\r?\n/);
  let roles = null;
  let generated = false;
  lines.forEach((line, i) => {
    const lineNo = doc.bodyLine + i + 1;
    if (line.trim() === TERM_INDEX_START) { generated = true; return; }
    if (line.trim() === TERM_INDEX_END) { generated = false; return; }
    if (generated) return;
    let term, def, avoid = [], code = [], col = null;
    if (/^\s*\|/.test(line)) {
      const cells = splitRow(line);
      if (cells.every((c) => /^:?-+:?$/.test(c))) return;
      if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
        // header row: map columns to roles
        roles = cells.map((c) => (COLUMN_ROLES.find(([, re]) => re.test(c)) || ['def'])[0]);
        if (!roles.includes('term')) roles[0] = 'term';
        return;
      }
      const r = roles || ['term', ...cells.slice(1).map(() => 'def')];
      const by = (role) => cells.filter((_, j) => r[j] === role);
      [term] = by('term');
      col = r.indexOf('term');
      def = by('def').join(' ');
      avoid = by('avoid').flatMap((c) => splitList(clean(c)));
      code = by('code').flatMap((c) => splitList(clean(c)));
    } else {
      roles = null;
      const li = /^\s*[-*]\s+\*\*(.+?)\*\*\s*(?:\(([^)]*)\))?\s*[:–—-]\s*(.+)$/.exec(line);
      if (!li) return;
      term = li[2] ? `${li[1]} (${li[2]})` : li[1];
      def = li[3];
    }
    if (!term || !clean(term)) return;
    const inlineAvoid = /\s*Nicht verwenden:\s*(.+)$/i.exec(def);
    if (inlineAvoid) { avoid.push(...splitList(clean(inlineAvoid[1]))); def = def.slice(0, inlineAvoid.index); }
    const codeNames = [...code, ...[...term.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim())];
    term = clean(term);
    const main = term.replace(/\s*\(.*\)\s*$/, '').trim();
    const inParens = /\(([^)]*)\)/.exec(term);
    const aliases = [
      ...main.split(/\s*\/\s*/).filter((a) => a !== main),
      ...(inParens ? inParens[1].split(/\s*,\s*/) : []),
      ...code,
    ].map((a) => a.trim()).filter(Boolean);
    entries.push({
      term: main, aliases: [...new Set(aliases)], avoid: [...new Set(avoid)], code: [...new Set(codeNames)], definition: clean(def),
      rawDefinition: def.replace(/<a\s[^>]*><\/a>/g, '').trim(),
      docId: doc.id, scope: doc.scope, source: doc.source, level: doc.level, tag: doc.tag || '', anchor: termAnchor(main), line: lineNo, col, file: doc.file,
    });
  });
  return entries;
}

// ---------------------------------------------------------------- decisions (ADRs)

export const DECISION_STATUS = ['vorgeschlagen', 'gilt', 'übernommen', 'abgelöst', 'verworfen'];
const ADR_HEAD = /^(ADR-(?:([A-Za-z]+)-?)?(\d+))\s*[:–—-]\s*(.+)$/;
const ADR_REF = /ADR-(?:[A-Za-z]+-?)?\d+/;
/** `ADR-07` (public), `ADR-I07` (project sidecar), `ADR-HBT-07` (company source). */
export const decisionId = (prefix, n) => {
  const p = String(prefix || '').toUpperCase();
  const num = String(Number(n)).padStart(2, '0');
  return p ? (p.length === 1 ? `ADR-${p}${num}` : `ADR-${p}-${num}`) : `ADR-${num}`;
};
export function canonicalAdr(s) {
  const m = /^ADR-(?:([A-Za-z]+)-?)?(\d+)$/i.exec(String(s).trim());
  return m ? decisionId(m[1], m[2]) : null;
}
/** Jira project keys of the loaded sources (e.g. PWR); set by loadKnowledge. */
let ISSUE_KEYS = [];
/** Issue references: GitHub `#123` and Jira keys like `PWR-123` (only for configured project keys). */
export function issueRefs(s) {
  const str = String(s || '');
  const out = [...str.matchAll(/#(\d+)/g)].map((m) => `#${m[1]}`);
  if (ISSUE_KEYS.length) out.push(...[...str.matchAll(new RegExp(`\\b(${ISSUE_KEYS.join('|')})-(\\d+)\\b`, 'g'))].map((m) => `${m[1]}-${m[2]}`));
  return [...new Set(out)];
}
export function jiraKeys(config) {
  return [...new Set([config.public.jira, ...config.sources.map((s) => s.config.jira)].filter(Boolean)
    .flatMap((j) => asList(j.keys)).map((k) => k.toUpperCase()).filter((k) => /^[A-Z][A-Z0-9_]+$/.test(k) && k !== 'ADR'))];
}
const statusBase = (s) => (String(s || '').trim().toLowerCase().match(/^[a-zäöüß]+/) || [''])[0];

/** GitHub's heading anchor: lower case, punctuation removed, each space a hyphen. */
export function githubSlug(heading) {
  return heading.replace(/<[^>]+>/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '')
    .trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
}

/** All link targets inside a page: GitHub heading anchors plus explicit `<a id="…">`. */
export function docAnchors(doc) {
  if (doc.anchors) return doc.anchors;
  const set = new Set();
  const seen = new Map();
  let fence = false;
  for (const l of doc.body.split(/\r?\n/)) {
    if (/^\s*```/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) {
      const base = githubSlug(h[1]);
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      set.add(n ? `${base}-${n}` : base);
    }
    for (const m of l.matchAll(/<a\s+(?:[^>]*\s)?(?:id|name)="([^"]+)"/g)) set.add(m[1].toLowerCase());
  }
  doc.anchors = set;
  return set;
}

function bulletFields(text) {
  const fields = {};
  let cur = null;
  for (const l of text.split('\n')) {
    const m = /^[-*]\s+\*\*([^*:]+):\*\*\s*(.*)$/.exec(l);
    if (m) { cur = m[1].trim().toLowerCase(); fields[cur] = m[2]; } else if (cur) fields[cur] += `\n${l}`;
  }
  for (const k of Object.keys(fields)) fields[k] = fields[k].trim();
  return fields;
}

/**
 * Decisions are first-class knowledge: H2 sections `## ADR-07: Titel` with bullets **Status**, **Kontext**,
 * **Entscheidung**, **Konsequenzen** (arc42 chapter 9), or whole pages with `type: decision` (sidecar, `ADR-I01`).
 */
export function parseDecisions(doc) {
  const out = [];
  const make = (m, fields, meta, sectionId, line) => {
    const status = String(meta.status || fields.status || '').trim();
    const all = [status, fields.kontext, fields.entscheidung, fields.konsequenzen].join(' ');
    out.push({
      id: decisionId(m[2], m[3]), prefix: (m[2] || '').toUpperCase(), intern: !!m[2], number: Number(m[3]), title: m[4].trim(), status, base: statusBase(status),
      date: meta.date || (/seit (\d{4}(?:-\d{2}){0,2})/.exec(status) || [])[1] || null,
      issues: issueRefs(`${status} ${Array.isArray(meta.issues) ? meta.issues.join(' ') : meta.issues || ''}`),
      supersededBy: canonicalAdr((new RegExp(`abgelöst durch (${ADR_REF.source})`, 'i').exec(all) || [])[1] || '') || null,
      supersedes: [...all.matchAll(new RegExp(`löst (${ADR_REF.source}) ab`, 'gi'))].map((x) => canonicalAdr(x[1])),
      fields, scope: doc.scope, source: doc.source, tag: doc.tag || '', docId: doc.id, sectionId, line,
    });
  };
  if (doc.type === 'decision') {
    const m = ADR_HEAD.exec(doc.meta.id && !/^ADR-/i.test(doc.title) ? `${doc.meta.id}: ${doc.title}` : doc.title);
    if (m) {
      const fields = {};
      for (const s of doc.sections) if (s.level === 2) fields[s.heading.toLowerCase()] = s.text.trim();
      make(m, fields, doc.meta, doc.id, doc.bodyLine + 1);
    }
    return out;
  }
  for (const s of doc.sections) {
    const m = s.level === 2 && ADR_HEAD.exec(s.heading);
    if (m) make(m, bulletFields(s.text), {}, s.id, doc.bodyLine + s.line);
  }
  return out;
}

/** Rows of an overview table `| [07](#adr-07-…) | Titel | Status | Issues |`. */
export function parseDecisionTable(doc) {
  const rows = [];
  doc.body.split(/\r?\n/).forEach((l, i) => {
    const m = /^\|\s*\[([A-Za-z]+-?)?(\d+)\]\(#([^)]+)\)\s*\|/.exec(l);
    if (!m) return;
    const cells = splitRow(l);
    rows.push({
      id: decisionId((m[1] || '').replace('-', ''), m[2]), anchor: m[3], title: (cells[1] || '').replace(/`/g, ''), status: cells[2] || '',
      base: statusBase(cells[2]), issues: issueRefs(cells[3]), line: doc.bodyLine + i + 1,
    });
  });
  return rows;
}

export function listDecisions(kb, { status, scope = 'all', query } = {}) {
  let list = kb.decisions.filter((d) => scope === 'all' || d.scope === scope);
  if (status) list = list.filter((d) => d.base === statusBase(status) || d.status.toLowerCase().includes(String(status).toLowerCase()));
  if (query) {
    const ids = new Set(search(kb, query, { limit: 40 }).map((h) => h.id));
    list = list.filter((d) => ids.has(d.sectionId));
  }
  return list;
}

export function formatDecisions(list) {
  if (!list.length) return 'Keine Entscheidungen gefunden.';
  return list.map((d) => `- ${d.tag}**${d.id}** ${d.title} — ${d.status || 'ohne Status'}` +
    `${d.supersededBy ? ` → ${d.supersededBy}` : ''} (\`${d.sectionId}\`)`).join('\n');
}

export function decide(kb, scope, title, { issues = '' } = {}) {
  if (!title) throw new Error('Titel fehlt.');
  const today = new Date().toISOString().slice(0, 10);
  if (scope !== 'public') {
    const src = sourceById(kb, scope);
    if (!src) throw new Error(`Keine Wissensquelle „${scope}“ gefunden (siehe \`kb status\`).`);
    const dir = src.dir;
    const id = decisionId(src.adrPrefix, Math.max(0, ...kb.decisions.filter((d) => d.prefix === src.adrPrefix).map((d) => d.number)) + 1);
    const file = path.join(dir, 'entscheidungen', `${id}-${slugify(title)}.md`);
    const text = fs.readFileSync(path.join(HERE, 'templates', 'decision.md'), 'utf8')
      .replace(/\{\{id\}\}/g, id).replace(/\{\{title\}\}/g, title).replace(/\{\{today\}\}/g, today)
      .replace(/\{\{issues\}\}/g, issues ? `[${issueRefs(issues).map((n) => JSON.stringify(n)).join(', ')}]` : '[]');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return { id, file };
  }
  const pub = kb.docs.filter((d) => d.scope === 'public');
  const configured = kb.config.public.decisions?.file;
  const doc = configured
    ? pub.find((d) => d.rel === configured)
    : pub.map((d) => [d, kb.decisions.filter((x) => x.docId === d.id).length]).sort((a, b) => b[1] - a[1]).find(([, n]) => n > 0)?.[0];
  if (!doc) throw new Error('Keine Datei mit Entscheidungen gefunden; `decisions.file` in knowledge.json setzen.');
  const id = decisionId('', Math.max(0, ...kb.decisions.filter((d) => !d.prefix).map((d) => d.number)) + 1);
  const heading = `${id}: ${title}`;
  const raw = fs.readFileSync(doc.file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const rows = parseDecisionTable(doc);
  if (rows.length) {
    const last = rows[rows.length - 1].line;
    lines.splice(last, 0, `| [${id.slice(4)}](#${githubSlug(heading)}) | ${title} | vorgeschlagen | ${issues || '–'} |`);
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  lines.push('', `## ${heading}`, '', `- **Status:** vorgeschlagen${issues ? ` (${issues})` : ''}`,
    '- **Kontext:** …', '- **Entscheidung:** …', '- **Konsequenzen:**', '  - …', '');
  fs.writeFileSync(doc.file, lines.join(eol));
  return { id, file: doc.file };
}

/** Consistency of the decision log: overview vs. sections, status, numbering, successors, completeness. */
export function auditDecisions(kb) {
  const out = [];
  const add = (d, kind, detail, line = d.line) => out.push({ id: d.docId, scope: d.scope, rel: d.docId.replace(/^[\w-]+:/, ''), line, kind, detail });
  const seen = new Set();
  for (const d of kb.decisions) {
    if (seen.has(d.id)) add(d, 'Entscheidung doppelt nummeriert', d.id);
    seen.add(d.id);
    if (!DECISION_STATUS.includes(d.base)) add(d, 'Entscheidung mit unbekanntem Status', `${d.id}: ${d.status || '–'} (erlaubt: ${DECISION_STATUS.join(', ')})`);
    const missing = ['kontext', 'entscheidung', 'konsequenzen'].filter((k) => !d.fields[k] || /^…?$/.test(d.fields[k]));
    if (missing.length) add(d, 'Entscheidung unvollständig', `${d.id}: ${missing.join(', ')} fehlt`);
    if (d.base === 'abgelöst' && !d.supersededBy) add(d, 'Abgelöst ohne Nachfolger', `${d.id}: „abgelöst durch ADR-…“ fehlt`);
    for (const ref of [d.supersededBy, ...d.supersedes].filter(Boolean)) {
      if (!kb.decisions.some((x) => x.id === ref)) add(d, 'Verweis auf unbekannte Entscheidung', `${d.id} → ${ref}`);
    }
  }
  for (const prefix of new Set(kb.decisions.map((d) => d.prefix))) {
    const nums = new Set(kb.decisions.filter((d) => d.prefix === prefix).map((d) => d.number));
    const first = kb.decisions.find((d) => d.prefix === prefix);
    for (let n = 1; n < Math.max(0, ...nums); n++) if (!nums.has(n)) add(first, 'Lücke in der Nummerierung', decisionId(prefix, n));
  }
  // a decision may only build on decisions its readers can see
  for (const d of kb.decisions) {
    for (const ref of [d.supersededBy, ...d.supersedes].filter(Boolean)) {
      const target = kb.decisions.find((x) => x.id === ref);
      const lvl = (x) => LEVELS[kb.docs.find((doc) => doc.id === x.docId)?.level || 'public'];
      if (target && lvl(target) > lvl(d)) add(d, 'Verweis auf Entscheidung mit engerem Leserkreis', `${d.id} → ${ref}`);
    }
  }
  for (const doc of kb.docs) {
    if (doc.scope === 'public') {
      doc.body.split(/\r?\n/).forEach((l, i) => {
        for (const m of l.matchAll(/\bADR-[A-Z]+-?\d+\b/g)) out.push({ id: doc.id, scope: doc.scope, rel: doc.rel, line: doc.bodyLine + i + 1, kind: 'Öffentliche Seite verweist auf INTERN', detail: m[0] });
      });
    }
    const rows = parseDecisionTable(doc);
    if (!rows.length) continue;
    const inDoc = kb.decisions.filter((d) => d.docId === doc.id);
    for (const d of inDoc) {
      const r = rows.find((x) => x.id === d.id);
      if (!r) { add(d, 'Entscheidung fehlt in der Übersicht', d.id); continue; }
      if (r.base !== d.base) add(d, 'Status in der Übersicht weicht ab', `${d.id}: „${r.status}“, im Abschnitt „${d.status}“`, r.line);
      if (fpNorm(r.title) !== fpNorm(d.title.replace(/`/g, ''))) add(d, 'Titel in der Übersicht weicht ab', `${d.id}: „${r.title}“, im Abschnitt „${d.title}“`, r.line);
    }
    for (const r of rows) {
      if (!inDoc.some((d) => d.id === r.id)) out.push({ id: doc.id, scope: doc.scope, rel: doc.rel, line: r.line, kind: 'Übersicht nennt unbekannte Entscheidung', detail: r.id });
    }
  }
  return out;
}

// ---------------------------------------------------------------- term notes (Obsidian)

export const TERM_INDEX_START = '<!-- kb:begriffe -->';
export const TERM_INDEX_END = '<!-- /kb:begriffe -->';
const TERM_TYPES = new Set(['begriff', 'term']);
const asList = (v) => (Array.isArray(v) ? v : v ? String(v).split(/\s*,\s*/) : []).map((x) => String(x).trim()).filter(Boolean);
export const isTermNote = (doc) => TERM_TYPES.has(String(doc.type || '').toLowerCase());

/**
 * One note per term, Obsidian style: file name = term, `aliases` (other names Obsidian links resolve),
 * `code` (names in the code), `nicht-verwenden` (replaced words); the first paragraph is the definition.
 */
export function parseTermNote(doc) {
  const term = doc.meta.title || path.basename(doc.rel, path.extname(doc.rel));
  const code = asList(doc.meta.code);
  return {
    term, aliases: [...new Set([...asList(doc.meta.aliases), ...code])].filter((a) => a !== term),
    avoid: asList(doc.meta['nicht-verwenden'] ?? doc.meta.avoid), code,
    definition: doc.meta.summary || doc.summary, rawDefinition: doc.body.replace(/^#\s+.*\n?/m, '').trim(),
    docId: doc.id, scope: doc.scope, source: doc.source, level: doc.level, tag: doc.tag || '',
    anchor: termAnchor(term), line: doc.bodyLine + 1, col: null, note: true, file: doc.file,
  };
}

/** A file name Obsidian, Windows and GitHub all accept. */
export const noteName = (term) => term.replace(/[\\/:*?"<>|#^[\]]+/g, '-').replace(/\s+-\s+|\s{2,}/g, (m) => (m.includes('-') ? ' - ' : ' ')).trim();

// ---------------------------------------------------------------- links (Obsidian wikilinks + Markdown links)

const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;

/** `[[Ziel]]`, `[[Ziel#Abschnitt|Text]]`, `[[Ziel#^block]]`, `![[eingebettet]]` and inline #tags, outside code. */
export function extractWikiLinks(doc) {
  const links = [];
  const tags = new Set();
  let fence = false;
  doc.body.split(/\r?\n/).forEach((text, i) => {
    const line = doc.bodyLine + i + 1;
    if (/^\s*(```|~~~)/.test(text)) { fence = !fence; return; }
    if (fence) return;
    const prose = text.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
    for (const m of prose.matchAll(WIKILINK)) {
      const inner = m[2].replace(/\\\|/g, '|');
      const bar = inner.indexOf('|');
      const targetPart = bar >= 0 ? inner.slice(0, bar) : inner;
      const hash = targetPart.indexOf('#');
      const target = (hash >= 0 ? targetPart.slice(0, hash) : targetPart).trim();
      const frag = hash >= 0 ? targetPart.slice(hash + 1).trim() : null;
      links.push({
        target, heading: frag && !frag.startsWith('^') ? frag : null, block: frag?.startsWith('^') ? frag.slice(1) : null,
        alias: bar >= 0 ? inner.slice(bar + 1).trim() : null, embed: m[1] === '!', line, raw: m[0],
      });
    }
    if (/^\s*#{1,6}\s/.test(text)) return;
    const rest = prose.replace(WIKILINK, ' ').replace(/\]\([^)]*\)/g, ']').replace(/<[^>]+>/g, ' ');
    for (const m of rest.matchAll(/(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu)) tags.add(m[2].toLowerCase());
  });
  return { links, tags: [...tags] };
}

const linkKey = (s) => normalize(String(s).replace(/\.md$/i, '')).trim();
const relKey = (s) => linkKey(s).replace(/\\/g, '/');

const filesCache = new Map();
function allFiles(dir) {
  if (filesCache.has(dir)) return filesCache.get(dir);
  const out = [];
  const go = (d) => {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) go(f); else out.push(path.relative(dir, f).split(path.sep).join('/'));
    }
  };
  go(dir);
  filesCache.set(dir, out);
  return out;
}

/** Resolves a wikilink like Obsidian: by note name or alias in the vault, or by path, optionally starting with a module folder. */
export function resolveWikiLink(kb, from, l) {
  if (!l.target) return { doc: from };
  const t = l.target.replace(/\\/g, '/').replace(/^\/+/, '');
  const vaultDocs = kb.docs.filter((d) => d.scope !== 'public');
  const segs = t.split('/');
  const moduleSrc = segs.length > 1
    ? kb.config.sources.find((s) => [path.basename(s.dir), s.id, s.module].filter(Boolean).some((k) => k.toLowerCase() === segs[0].toLowerCase()))
    : null;
  let candidates;
  if (moduleSrc) {
    const rel = relKey(segs.slice(1).join('/'));
    candidates = vaultDocs.filter((d) => d.source === moduleSrc.id && (relKey(d.rel) === rel || relKey(d.rel).endsWith(`/${rel}`)));
  } else if (segs.length > 1) {
    const rel = relKey(t);
    candidates = vaultDocs.filter((d) => relKey(d.rel) === rel || relKey(d.rel).endsWith(`/${rel}`));
  } else {
    const k = linkKey(t);
    candidates = vaultDocs.filter((d) => linkKey(path.basename(d.rel)) === k || asList(d.meta.aliases).some((a) => linkKey(a) === k));
  }
  if (candidates.length > 1) {
    const same = candidates.filter((d) => d.source === from.source);
    if (same.length === 1) candidates = same;
  }
  if (candidates.length === 1) return { doc: candidates[0] };
  if (candidates.length > 1) return { ambiguous: candidates };
  // attachments (images, PDFs …)
  if (/\.[a-z0-9]{2,5}$/i.test(t) && !/\.md$/i.test(t)) {
    const srcs = moduleSrc ? [moduleSrc] : kb.config.sources;
    const name = (moduleSrc ? segs.slice(1).join('/') : t).toLowerCase();
    if (srcs.some((s) => allFiles(s.dir).some((f) => f.toLowerCase() === name || f.toLowerCase().endsWith(`/${name}`)))) return { file: true };
  }
  const folderExists = from.base && segs.length > 1 && isDir(path.join(from.base, segs[0]));
  return { missing: true, otherModule: segs.length > 1 && !moduleSrc && !folderExists ? segs[0] : null };
}

function headingTexts(doc) {
  const set = new Set([linkKey(doc.title)]);
  let fence = false;
  for (const l of doc.body.split(/\r?\n/)) {
    if (/^\s*```/.test(l)) { fence = !fence; continue; }
    const h = !fence && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) set.add(linkKey(h[1].replace(/[`*]/g, '')));
  }
  return set;
}

/** All links between pages (wikilinks and relative Markdown links), with backlinks on each page. */
export function buildLinks(kb) {
  const links = [];
  const byFile = new Map(kb.docs.map((d) => [path.resolve(d.file), d]));
  for (const d of kb.docs) {
    d.wikilinks = [];
    const { links: wl, tags } = extractWikiLinks(d);
    d.tags = [...new Set([...d.tags.map((x) => String(x).toLowerCase().replace(/^#/, '')), ...tags])];
    for (const l of wl) {
      const r = resolveWikiLink(kb, d, l);
      d.wikilinks.push({ ...l, ...r });
      if (r.doc && r.doc !== d) links.push({ from: d, to: r.doc, line: l.line, kind: 'wiki' });
    }
    for (const { value, line } of extractRefs(d).links) {
      if (!value || !/\.md$/i.test(value)) continue;
      let target;
      try { target = path.resolve(path.dirname(d.file), decodeURI(value.replace(/^<|>$/g, ''))); } catch { continue; }
      const to = byFile.get(target);
      if (to && to !== d) links.push({ from: d, to, line, kind: 'md' });
    }
  }
  for (const d of kb.docs) { d.outgoing = []; d.backlinks = []; }
  for (const l of links) {
    if (!l.from.outgoing.includes(l.to)) l.from.outgoing.push(l.to);
    if (!l.to.backlinks.includes(l.from)) l.to.backlinks.push(l.from);
  }
  return links;
}

/** Link findings: dead, ambiguous, unknown heading/block, narrower audience, wikilinks in the code repository. */
export function auditLinks(kb) {
  const out = [];
  const add = (d, line, kind, detail) => out.push({ id: d.id, scope: d.scope, rel: d.rel, line, kind, detail });
  for (const d of kb.docs) {
    for (const l of d.wikilinks || []) {
      if (d.scope === 'public') { add(d, l.line, 'Obsidian-Verknüpfung im Code-Repo (normalen Markdown-Link verwenden)', l.raw); continue; }
      if (l.ambiguous) { add(d, l.line, 'Verknüpfung mehrdeutig', `${l.raw} → ${l.ambiguous.map((x) => x.id).join(', ')}`); continue; }
      if (l.missing) {
        add(d, l.line, l.otherModule ? `Verknüpfung in ein Modul, das hier fehlt (${l.otherModule})` : 'Verknüpfung ins Leere', l.raw);
        continue;
      }
      if (!l.doc) continue;
      if (l.heading && !headingTexts(l.doc).has(linkKey(l.heading.split('#').pop()))) add(d, l.line, 'Verknüpfung auf unbekannten Abschnitt', l.raw);
      if (l.block && !new RegExp(`\\^${l.block.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l.doc.body)) add(d, l.line, 'Verknüpfung auf unbekannten Block', l.raw);
      if (LEVELS[l.doc.level || 'public'] > LEVELS[d.level || 'public']) add(d, l.line, 'Verknüpfung zu engerem Leserkreis', `${l.raw} → ${l.doc.id}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- loading

/** Hints of the weekly run about outdated code comments, in the project sidecar (replaced as a whole on every run). */
export const HINTS_FILE = 'consolidation/hints.md';

/** Open hints: one list item each, `file:line`: what is wrong, suggestion. */
export function readHints(kb) {
  const dir = kb.config.private.dir;
  if (!dir) return [];
  let text = '';
  try { text = fs.readFileSync(path.join(dir, HINTS_FILE), 'utf8'); } catch { return []; }
  let fence = false;
  const out = [];
  for (const l of text.split(/\r?\n/)) {
    if (/^\s*```/.test(l)) { fence = !fence; continue; }
    const m = !fence && /^\s*[-*]\s+(.+\S)\s*$/.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

const HINTS_SHOWN = 20;
const HINTS_RULE = 'Arbeitest du in einer dieser Stellen, korrigiere den Kommentar im selben Branch als kleine Korrektur nebenbei ' +
  '(Regel „Small fixes along the way“ in `AGENTS.md`) und lösche den Hinweis aus `consolidation/hints.md` im Projekt-Sidecar.';

export function formatHints(hints, max = HINTS_SHOWN) {
  return [...hints.slice(0, max).map((h) => `- ${h}`), ...(hints.length > max ? [`- … und ${hints.length - max} weitere: \`kb status\``] : [])].join('\n');
}

function loadScope(dir, cfg, scope, src = { id: scope, level: 'public', tag: '' }) {
  const docs = [];
  for (const rel of walk(dir)) {
    if (matchAny(rel, cfg.exclude)) continue;
    // the hints of the weekly run are a work list, no knowledge page (and no fingerprints: their text goes into public code)
    if (src.level === 'project' && rel === HINTS_FILE) continue;
    const source = sourceFor(rel, cfg);
    if (!source) continue;
    let text;
    try { text = fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { continue; }
    const doc = parseDoc(rel, text, scope, source, src.id);
    Object.assign(doc, { source: src.id, level: src.level, tag: src.tag, base: dir });
    doc.isGlossary = doc.type === 'glossary' || matchAny(rel, cfg.glossaries);
    doc.file = path.join(dir, rel);
    docs.push(doc);
  }
  return docs.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function loadKnowledge(root = findRoot()) {
  const config = loadConfig(root);
  const docs = loadScope(root, config.public, 'public');
  for (const s of config.sources) docs.push(...loadScope(s.dir, s.config, 'intern', s));
  ISSUE_KEYS = jiraKeys(config);
  const glossary = docs.flatMap((d) => (isTermNote(d) ? [parseTermNote(d)] : d.isGlossary ? parseGlossary(d) : []));
  const decisions = docs.flatMap(parseDecisions).sort((a, b) => (a.prefix || '').localeCompare(b.prefix || '') || a.number - b.number);
  const kb = { config, docs, glossary, decisions };
  filesCache.clear();
  kb.links = buildLinks(kb);
  kb.index = buildIndex(kb);
  return kb;
}

// ---------------------------------------------------------------- search

const STOP = new Set((
  'der die das den dem des ein eine einer eines einem einen und oder aber ist sind war im in ins zu zum zur mit von vom ' +
  'fuer auf an am als auch es nicht wie wird werden wurde bei aus wer was wo wann warum welche welcher welches gibt ' +
  'ich wir du sie er man kann koennen muss soll sollen dass da so nur noch schon hier dort ueber unter nach vor ' +
  'the a an and or of to in is are be for on with how what which who why when does do this that it'
).split(' '));

export function normalize(s) {
  return String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '');
}
const SUFFIXES = ['ungen', 'ung', 'en', 'er', 'es', 'e', 'n', 's'];
export function stem(t) {
  if (t.length > 4 && !/\d/.test(t)) for (const s of SUFFIXES) if (t.endsWith(s) && t.length - s.length >= 4) return t.slice(0, -s.length);
  return t;
}
export function tokenize(s) {
  return normalize(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)).map(stem);
}

function buildIndex(kb) {
  const units = [];
  const docById = new Map(kb.docs.map((d) => [d.id, d]));
  for (const d of kb.docs) {
    for (const s of d.sections) {
      units.push({
        kind: 'section', id: s.id, doc: d, section: s, decision: kb.decisions.find((x) => x.sectionId === s.id),
        fields: [[d.title, 2], [s.heading, 3], [s.level === 1 ? d.summary : '', 1.5], [d.tags.join(' '), 2], [s.text, 1]],
      });
    }
  }
  for (const g of kb.glossary) {
    units.push({
      kind: 'term', id: `${g.docId}#begriff-${slugify(g.term)}`, doc: docById.get(g.docId), term: g,
      fields: [[`${g.term} ${g.aliases.join(' ')}`, 4], [g.definition, 1]],
    });
  }
  const df = new Map();
  let total = 0;
  for (const u of units) {
    const tf = new Map();
    for (const [text, w] of u.fields) for (const t of tokenize(text)) tf.set(t, (tf.get(t) || 0) + w);
    u.tf = tf;
    u.len = [...tf.values()].reduce((a, b) => a + b, 0) || 1;
    total += u.len;
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  return { units, df, avg: total / (units.length || 1), n: units.length };
}

function expand(term, df) {
  if (df.has(term)) return [[term, 1]];
  if (term.length < 4) return [];
  const out = [];
  for (const t of df.keys()) {
    if (t.length >= 4 && (t.includes(term) || term.includes(t))) out.push([t, 0.6]);
  }
  return out.slice(0, 20);
}

function snippet(text, qtokens, max = 240) {
  const raw = text.split('\n').map((l) => l.trim());
  const isSep = (l) => /^\|[\s:|-]+\|$/.test(l || '');
  const lines = raw.filter((l, i) => l && !isSep(l) && !isSep(raw[i + 1]));
  let best = lines[0] || '', bestHits = -1;
  for (const l of lines) {
    const toks = new Set(tokenize(l));
    const hits = qtokens.filter((q) => toks.has(q) || [...toks].some((t) => t.length >= 4 && (t.includes(q) || q.includes(t)))).length;
    if (hits > bestHits) { best = l; bestHits = hits; }
  }
  best = best.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  return best.length > max ? `${best.slice(0, max - 2)} …` : best;
}

/** Words of the query that name a glossary term – directly, by code name or by a replaced synonym. */
function termsInQuery(kb, query) {
  const nq = ` ${normalize(query).replace(/[^a-z0-9]+/g, ' ')} `;
  const has = (w) => { const x = normalize(w).replace(/[^a-z0-9]+/g, ' ').trim(); return x.length > 2 && nq.includes(` ${x}`); };
  return kb.glossary.filter((g) => [g.term, ...g.aliases, ...g.avoid].some(has));
}

export function search(kb, query, { audience, scope = 'all', limit = 8 } = {}) {
  const { units, df, avg, n } = kb.index;
  // speak the domain language: a replaced word or code name also searches for the canonical term
  const named = termsInQuery(kb, query);
  const q = [...new Set(tokenize(`${query} ${named.map((g) => g.term).join(' ')}`))];
  if (!q.length) return [];
  const wantAudience = normalizeAudience(audience);
  const k1 = 1.2, b = 0.75;
  const expansions = q.map((t) => expand(t, df));
  const phrase = q.length > 1 ? normalize(query).replace(/[^a-z0-9]+/g, ' ').trim() : null;
  const results = [];
  for (const u of units) {
    if (scope !== 'all' && u.doc.scope !== scope) continue;
    if (wantAudience.length && u.doc.audience.length && !u.doc.audience.some((a) => wantAudience.includes(a))) continue;
    let score = 0, matched = 0;
    expansions.forEach((exps) => {
      let best = 0;
      for (const [t, w] of exps) {
        const tf = u.tf.get(t);
        if (!tf) continue;
        const idf = Math.log(1 + (n - df.get(t) + 0.5) / (df.get(t) + 0.5));
        best = Math.max(best, w * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * u.len) / avg))));
      }
      if (best > 0) { score += best; matched++; }
    });
    if (!score) continue;
    score *= (0.5 + (0.5 * matched) / q.length) * u.doc.boost;
    if (phrase && normalize(u.fields.map((f) => f[0]).join(' ')).replace(/[^a-z0-9]+/g, ' ').includes(phrase)) score *= 1.5;
    if (u.kind === 'term' && named.includes(u.term)) score *= 3;
    score *= 1 + Math.min(u.doc.backlinks?.length || 0, 10) * 0.02;
    results.push({ u, score, matched });
  }
  results.sort((a, b2) => b2.score - a.score);
  // at most two hits per document to keep results diverse
  const perDoc = new Map();
  const out = [];
  for (const r of results) {
    const c = perDoc.get(r.u.doc.id) || 0;
    if (c >= 2) continue;
    perDoc.set(r.u.doc.id, c + 1);
    out.push(toHit(r, q));
    if (out.length >= limit) break;
  }
  return out;
}

function toHit({ u, score, matched }, q) {
  const base = {
    id: u.id, score: Math.round(score * 100) / 100, matched, terms: q.length,
    scope: u.doc.scope, source: u.doc.source, tag: u.doc.tag || '', docTitle: u.doc.title, audience: u.doc.audience,
  };
  if (u.kind === 'term') return { ...base, kind: 'Begriff', title: u.term.term, snippet: u.term.definition.slice(0, 240) };
  if (u.decision) {
    const d = u.decision;
    return { ...base, kind: 'Entscheidung', title: `${d.id}: ${d.title} [${d.status || 'ohne Status'}]`, snippet: snippet(d.fields.entscheidung || u.section.text, q) };
  }
  return { ...base, kind: 'Abschnitt', title: u.section.trail, snippet: snippet(u.section.text || u.doc.summary, q) };
}

// ---------------------------------------------------------------- reading

export function findDoc(kb, ref) {
  const r = String(ref).replace(/\\/g, '/').replace(/^\.\//, '');
  const [docPart, frag] = r.split('#');
  const prefixes = ['public', ...kb.config.sources.map((s) => s.id)];
  const pm = /^([a-z0-9-]+):/.exec(docPart);
  const candidates = pm && prefixes.includes(pm[1]) ? [docPart] : prefixes.map((p) => `${p}:${docPart}`);
  for (const c of candidates) {
    const doc = kb.docs.find((d) => d.id === c);
    if (doc) return { doc, frag };
  }
  const byName = kb.docs.filter((d) => d.rel.endsWith(docPart) || normalize(d.title) === normalize(docPart));
  return byName.length === 1 ? { doc: byName[0], frag } : { doc: null, matches: byName };
}

const scopeLine = (doc) => (doc.scope === 'intern'
  ? `> ⚠ ${doc.level === 'company' ? 'HBT-weit (alle Mitarbeiter)' : 'nur Projektmitglieder'}. ${INTERN_NOTICE}`
  : '> Quelle: öffentlich (im Projekt-Repository).');

function metaLine(doc) {
  const parts = [];
  if (doc.audience.length) parts.push(`Zielgruppe: ${doc.audience.map((a) => AUDIENCES[a]).join(', ')}`);
  if (doc.owner) parts.push(`Verantwortlich: ${doc.owner}`);
  if (doc.reviewed) parts.push(`Geprüft: ${doc.reviewed}`);
  return parts.length ? `> ${parts.join(' · ')}\n` : '';
}

export function readEntry(kb, ref) {
  const adr = canonicalAdr(ref);
  if (adr) {
    const d = kb.decisions.find((x) => x.id === adr);
    if (!d) return null;
    ref = d.sectionId;
  }
  const { doc, frag, matches } = findDoc(kb, ref);
  if (!doc) {
    if (matches?.length) return `Mehrdeutig: ${matches.map((d) => d.id).join(', ')}`;
    return null;
  }
  const head = `# ${doc.title}\n\`${doc.id}\`\n${scopeLine(doc)}\n${metaLine(doc)}`;
  if (frag) {
    if (frag.startsWith('begriff-')) {
      const g = kb.glossary.find((e) => e.docId === doc.id && `begriff-${slugify(e.term)}` === frag);
      if (g) return `${head}\n**${g.term}**${g.aliases.length ? ` (${g.aliases.join(', ')})` : ''}: ${g.definition}${g.note ? linkFooter(doc) : ''}`;
    }
    const s = doc.sections.find((x) => x.id === `${doc.id}#${frag}`);
    if (s) return `${head}\n## ${s.trail}\n\n${s.text}`;
  }
  const toc = doc.sections.filter((s) => s.level > 1).map((s) => `${'  '.repeat(s.level - 2)}- ${s.heading} → \`${s.id}\``).join('\n');
  return `${head}\n${toc ? `Abschnitte:\n${toc}\n\n---\n` : ''}${doc.body.trim()}${linkFooter(doc)}`;
}

function linkFooter(doc) {
  const fmt = (list) => list.slice(0, 15).map((d) => `${d.tag || ''}${d.title} (\`${d.id}\`)`).join(' · ') + (list.length > 15 ? ` … (+${list.length - 15})` : '');
  const parts = [];
  if (doc.tags?.length) parts.push(`Schlagworte: ${doc.tags.map((t) => `#${t}`).join(' ')}`);
  if (doc.outgoing?.length) parts.push(`Verknüpft mit: ${fmt(doc.outgoing)}`);
  if (doc.backlinks?.length) parts.push(`Rückverweise: ${fmt(doc.backlinks)}`);
  return parts.length ? `\n\n---\n${parts.join('\n')}` : '';
}

export function define(kb, term) {
  const t = normalize(term).trim();
  const names = (g) => [g.term, ...g.aliases];
  const exact = kb.glossary.filter((g) => names(g).some((a) => normalize(a) === t));
  if (exact.length) return exact;
  const avoided = kb.glossary.filter((g) => g.avoid.some((a) => normalize(a) === t)).map((g) => ({ ...g, instead: term }));
  if (avoided.length) return avoided;
  return kb.glossary.filter((g) => names(g).some((a) => normalize(a).includes(t) || (t.length > 3 && t.includes(normalize(a)))));
}

/** Compact domain language for agents: canonical term, code names, words to avoid. */
export function domainLanguage(kb, { scope = 'all' } = {}) {
  const seen = new Set();
  return kb.glossary.filter((g) => scope === 'all' || g.scope === scope).filter((g) => {
    const k = normalize(g.term);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((g) => {
    const extra = [g.aliases.length ? g.aliases.join(', ') : '', g.avoid.length ? `nicht: ${g.avoid.join(', ')}` : ''].filter(Boolean).join('; ');
    return `${g.tag}${g.term}${extra ? ` (${extra})` : ''}`;
  }).join(' · ');
}

export function overview(kb, { audience, scope = 'all', compact = false, max = Infinity } = {}) {
  const want = normalizeAudience(audience);
  const groups = { public: [] };
  for (const s of kb.config.sources) groups[s.id] = [];
  for (const d of kb.docs) {
    if (scope !== 'all' && d.scope !== scope) continue;
    if (want.length && d.audience.length && !d.audience.some((a) => want.includes(a))) continue;
    groups[d.scope === 'public' ? 'public' : d.source].push(d);
  }
  const fmt = (d) => {
    const aud = d.audience.length ? ` [${d.audience.map((a) => AUDIENCES[a]).join(', ')}]` : '';
    return compact
      ? `- ${d.title} — \`${d.id}\`${aud}`
      : `- **${d.title}** — \`${d.id}\`${aud}${d.summary ? `\n  ${d.summary}` : ''}`;
  };
  // a capped list (session context) names how many are left out; the full list comes from `overview`
  const list = (docs) => [...docs.slice(0, max).map(fmt), ...(docs.length > max ? [`- … und ${docs.length - max} weitere: \`overview\``] : [])];
  const out = [];
  if (groups.public.length) out.push(`## Öffentlich (${groups.public.length})`, ...list(groups.public));
  for (const s of kb.config.sources) {
    if (scope !== 'all' && scope !== 'intern') continue;
    const who = s.level === 'project' ? 'Projekt-Sidecar, nur Projektmitglieder' : 'HBT-weit, alle Mitarbeiter';
    out.push('', `## ${s.label} – ${who} (${groups[s.id].length})`, ...list(groups[s.id]));
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- leak guard

const fpNorm = (s) => normalize(s).replace(/[^a-z0-9]+/g, ' ').trim();

function templateLines() {
  const set = new Set();
  const dir = path.join(HERE, 'templates');
  for (const rel of walk(dir)) {
    for (const l of fs.readFileSync(path.join(dir, rel), 'utf8').split(/\r?\n|(?<=[.!?])\s+/)) set.add(fpNorm(l));
  }
  return set;
}

const SENTENCES = /\r?\n|(?<=[.!?])\s+/;

/**
 * The commit whose public pages count as "already public": what the remote already has (merge base with the
 * upstream or origin/HEAD), else HEAD. Local commits that are not pushed yet never whitelist a sidecar sentence,
 * nor does the working tree or the index.
 */
function publicBase(root) {
  const remote = git(root, ['rev-parse', '--verify', '-q', '@{u}']).trim() || git(root, ['rev-parse', '--verify', '-q', 'refs/remotes/origin/HEAD']).trim();
  return (remote && git(root, ['merge-base', remote, 'HEAD']).trim()) || remote || 'HEAD';
}

/**
 * The public pages as committed in the public base (see publicBase). A sidecar sentence that was just written,
 * staged or committed locally into a public page must still be found. Without git or without a commit nothing
 * counts as public (strict).
 */
function committedPublicBodies(kb) {
  if (kb.committedPublic) return kb.committedPublic;
  const root = kb.config.root;
  const base = publicBase(root);
  const rels = kb.docs.filter((d) => d.scope === 'public').map((d) => d.rel);
  const bodies = [];
  if (rels.length) {
    let out = null;
    try {
      out = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: rels.map((r) => `${base}:${r}`).join('\n') + '\n', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 256 << 20 });
    } catch { out = null; }
    if (out) {
      let pos = 0;
      while (pos < out.length) {
        const nl = out.indexOf(10, pos);
        if (nl < 0) break;
        const header = out.subarray(pos, nl).toString('utf8');
        pos = nl + 1;
        const m = /^\S+ blob (\d+)$/.exec(header);
        if (!m) continue; // "<name> missing": not committed yet
        const size = Number(m[1]);
        bodies.push(parseFrontmatter(out.subarray(pos, pos + size).toString('utf8').replace(/^﻿/, '')).body);
        pos += size + 1;
      }
    }
  }
  kb.committedPublic = bodies;
  return bodies;
}

/**
 * Sentences and terms that must not reach a place readable at `targetLevel` (0 public, 1 company).
 * `extra`: further internal texts that are no pages, e.g. what was read from Jira.
 */
export function fingerprints(kb, { minLen = 40, targetLevel = 0, extra = [] } = {}) {
  const lvl = (d) => LEVELS[d.level || (d.scope === 'public' ? 'public' : 'project')];
  const publicText = new Set();
  const addPublic = (body) => { for (const l of body.split(SENTENCES)) publicText.add(fpNorm(l)); };
  committedPublicBodies(kb).forEach(addPublic);
  // private sources readable at the target level (company knowledge when writing into company knowledge)
  for (const d of kb.docs.filter((x) => x.scope !== 'public' && lvl(x) <= targetLevel)) addPublic(d.body);
  const allowed = templateLines();
  const fps = new Set();
  const addInternal = (body) => {
    for (const piece of body.split(SENTENCES)) {
      const f = fpNorm(piece.replace(/^\s*([-*+]|\d+\.|#+|\|)\s*/, ''));
      if (f.length >= minLen && !publicText.has(f) && !allowed.has(f)) fps.add(f);
    }
  };
  for (const d of kb.docs.filter((x) => lvl(x) > targetLevel)) addInternal(d.body);
  // extra texts are lists like `- [INTERN] PWR-7 Summary (Typ, Status)` or `- 2026-11-01: comment`: the prefixes are no content
  const extraLine = (l) => l.replace(/\[INTERN[^\]]*\]\s*/g, '').replace(/^\s*(?:[-*+]|#+)\s*/, '')
    .replace(/^[A-Z][A-Z0-9_]+-\d+:?\s+/, '').replace(/^\d{4}-\d{2}-\d{2}:\s*/, '').replace(/\s+\([^()]*\)\s*$/, '');
  for (const t of extra) addInternal(String(t).split(/\r?\n/).map(extraLine).join('\n'));
  const terms = kb.config.sources.filter((s) => LEVELS[s.level] > targetLevel)
    .flatMap((s) => s.config.sensitiveTerms || []).map((t) => fpNorm(t)).filter(Boolean);
  return { fps, terms };
}

/** Added lines of a unified diff, without the `+++` headers. */
const addedLines = (diff) => diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Text of a file with NUL bytes: UTF-16 (with or without BOM) decoded, anything else (real binaries) null.
 * PowerShell 5 writes UTF-16 with `echo … >`; git takes such a file for binary and its diff shows no lines.
 */
export function decodeText(buf) {
  if (!buf || buf.length < 2) return null;
  const le = (b) => b.subarray(0, b.length & ~1).toString('utf16le');
  const be = (b) => le(Buffer.from(b.subarray(0, b.length & ~1)).swap16());
  if (buf[0] === 0xff && buf[1] === 0xfe) return le(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return be(buf.subarray(2));
  const n = Math.min(buf.length, 4096) & ~1;
  let even = 0, odd = 0;
  for (let i = 0; i < n; i++) if (buf[i] === 0) { if (i % 2) odd++; else even++; }
  if (odd > n / 4 && even === 0) return le(buf);
  if (even > n / 4 && odd === 0) return be(buf);
  return null;
}

/** Changed files git counts as binary in `git diff <args>`, with their decoded text (whole file, read by `read`). */
function binaryTexts(root, args, read) {
  const out = [];
  for (const rec of git(root, ['diff', '--numstat', '-z', '--no-renames', ...args]).split('\0')) {
    const m = /^-\t-\t([\s\S]+)$/.exec(rec);
    if (!m) continue;
    const text = decodeText(read(m[1]));
    if (text) out.push({ file: m[1], text });
  }
  return out;
}

const readWorktree = (root) => (rel) => {
  try { const f = path.join(root, rel); return fs.statSync(f).size <= 1 << 20 ? fs.readFileSync(f) : null; } catch { return null; }
};
const readBlob = (root, rev) => (rel) => {
  try { return execFileSync('git', ['show', `${rev}:${rel}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 20 }); } catch { return null; }
};
/** Text of a file in the working tree: UTF-8, or UTF-16 decoded; null for a binary or an unreadable file. */
function readText(file) {
  let buf;
  try { if (fs.statSync(file).size > 1 << 20) return null; buf = fs.readFileSync(file); } catch { return null; }
  return buf.includes(0) ? decodeText(buf) : buf.toString('utf8');
}

/** What `git push` would publish: the text of the commits the remote doesn't have yet. */
function unpushedText(root) {
  const base = publicBase(root);
  const range = [base === 'HEAD' ? EMPTY_TREE : base, 'HEAD'];
  return [addedLines(git(root, ['diff', '-U0', '--no-color', ...range])),
    ...binaryTexts(root, range, readBlob(root, 'HEAD')).map((b) => b.text)].join('\n');
}

/** Text a `git commit` in this command would record, including `-a` and a `git add` in the same command. */
function commitText(root, cmd) {
  const all = /git\s+commit\b[^;&|]*\s(--all\b|-[a-zA-Z]*a[a-zA-Z]*\b)/.test(cmd);
  const adds = /git\s+add\b/.test(cmd);
  if (!all && !adds) {
    return [addedLines(git(root, ['diff', '--cached', '-U0', '--no-color'])),
      ...binaryTexts(root, ['--cached'], readBlob(root, '')).map((b) => b.text)].join('\n');
  }
  const head = git(root, ['rev-parse', '--verify', '-q', 'HEAD']).trim() || EMPTY_TREE;
  let text = [addedLines(git(root, ['diff', '-U0', '--no-color', head])),
    ...binaryTexts(root, [head], readWorktree(root)).map((b) => b.text)].join('\n');
  if (adds) {
    for (const rel of git(root, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) {
      const t = readText(path.join(root, rel));
      if (t) text += `\n${t}`;
    }
  }
  return text;
}

export function findLeaks(text, guard) {
  const norm = ` ${fpNorm(text)} `;
  const hits = [];
  for (const fp of guard.fps) if (norm.includes(fp)) hits.push({ kind: 'Satz aus dem Sidecar', text: fp });
  for (const t of guard.terms) if (norm.includes(` ${t} `)) hits.push({ kind: 'sensibler Begriff', text: t });
  return hits;
}

function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); } catch { return ''; }
}

export function checkRepo(kb, { staged = false, extra = [] } = {}) {
  const root = kb.config.root;
  const guard = fingerprints(kb, { extra });
  const findings = [];
  if (staged) {
    let file = null, line = 0;
    for (const l of git(root, ['diff', '--cached', '-U0', '--no-color']).split('\n')) {
      if (l.startsWith('+++ ')) { file = l.slice(6); continue; }
      const h = /^@@ -\S+ \+(\d+)/.exec(l);
      if (h) { line = Number(h[1]); continue; }
      if (l.startsWith('+')) {
        if (/^\+visibility:\s*intern\s*$/i.test(l)) findings.push({ file, line, kind: 'visibility: intern im öffentlichen Repo', text: '' });
        for (const hit of findLeaks(l.slice(1), guard)) findings.push({ file, line, ...hit });
        line++;
      }
    }
    for (const b of binaryTexts(root, ['--cached'], readBlob(root, ''))) {
      b.text.split(/\r?\n/).forEach((l, i) => {
        for (const hit of findLeaks(l, guard)) findings.push({ file: b.file, line: i + 1, ...hit });
      });
    }
    return { findings, guard };
  }
  const files = git(root, ['ls-files']).split('\n').filter(Boolean);
  for (const rel of files) {
    const text = readText(path.join(root, rel));
    if (text === null) continue;
    if (/\.md$/i.test(rel) && /^intern$/i.test(String(parseFrontmatter(text).meta.visibility || ''))) {
      findings.push({ file: rel, line: 1, kind: 'visibility: intern im öffentlichen Repo', text: '' });
    }
    if (!guard.fps.size && !guard.terms.length) continue;
    text.split(/\r?\n/).forEach((l, i) => {
      for (const hit of findLeaks(l, guard)) findings.push({ file: rel, line: i + 1, ...hit });
    });
  }
  return { findings, guard };
}

// ---------------------------------------------------------------- hooks

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

/** The session context lists at most this many pages per source, so it stays small as the vault grows. */
const SESSION_DOCS_PER_SOURCE = 80;

export function sessionContext(kb) {
  const p = kb.config.private;
  const pub = kb.docs.filter((d) => d.scope === 'public').length;
  const srcs = kb.config.sources.map((s) => `${s.label} (${s.level === 'project' ? 'Projekt' : 'HBT-weit'}, ${kb.docs.filter((d) => d.source === s.id).length} Dokumente)`);
  const lines = [
    '# Wissensbasis dieses Projekts (automatisch geladen)',
    `${pub} öffentliche Dokumente${srcs.length ? `; private Quellen: ${srcs.join(', ')}` : '; keine private Wissensquelle gefunden, nur öffentliches Wissen'}. ${kb.glossary.length} Glossarbegriffe.`,
    '',
    'Nutze die Wissensbasis, bevor du Fragen zu Fachlichkeit, Prozessen, Begriffen, Architektur oder Entscheidungen beantwortest',
    'und bevor du Code änderst, dessen fachliche Bedeutung du nicht kennst: MCP-Server `knowledge` (Tools `search`, `read`, `define`,',
    '`overview`) oder `node tools/knowledge/kb.mjs search "<frage>"`. Nenne die Quelle (`id`) in deiner Antwort.',
    'Antworte in der Sprache des Fragenden und passend zu seinem Hintergrund (Wirtschaft, Fachlichkeit, Technik).',
  ];
  if (kb.config.sources.length || p.dir) {
    lines.push('', `**Regel für INTERN-Quellen:** ${INTERN_NOTICE} Ein Hook blockiert Commits, Issues, PRs und Dateien mit wörtlichen Übernahmen.`);
  }
  if (kb.decisions.length) {
    lines.push('', '## Entscheidungen',
      'Architektur- und Fachentscheidungen gelten, bis eine neue sie ablöst. Vor Änderungen, die eine berühren, `read ADR-nn`; ' +
      'neue Entscheidungen mit `kb.mjs decide`.', '',
      kb.decisions.map((d) => `${d.tag}${d.id} ${d.title} (${d.base || '?'}${d.supersededBy ? ` → ${d.supersededBy}` : ''})`).join(' · '));
  }
  if (kb.glossary.length) {
    lines.push('', '## Domänensprache',
      'Verwende in Antworten, Code, Kommentaren, Oberflächentexten und Doku genau diese Begriffe; Wörter hinter „nicht:“ sind ersetzt. ' +
      'Neue Begriffe kommen ins Glossar, bevor sie benutzt werden. Details: `define <begriff>`.', '', domainLanguage(kb));
  }
  const hints = readHints(kb);
  if (hints.length) lines.push('', `## Offene Hinweise zum Code (${hints.length})`, HINTS_RULE, '', formatHints(hints));
  lines.push('', overview(kb, { compact: true, max: SESSION_DOCS_PER_SOURCE }));
  return lines.join('\n');
}

function hookPrompt(kb, input) {
  const prompt = String(input.prompt || '');
  if (tokenize(prompt).length < 2 || prompt.trim().startsWith('/')) return '';
  const hits = search(kb, prompt, { limit: 4 }).filter((h) => h.score >= 2.5 && h.matched >= Math.min(2, h.terms));
  if (!hits.length) return '';
  return [
    'Möglicherweise relevantes Wissen (Wissensbasis, mit `read` vollständig lesen):',
    ...hits.map((h) => `- ${h.tag}${h.title} — \`${h.id}\`: ${h.snippet}`),
  ].join('\n');
}

const OUTWARD = /\b(git\s+(commit|push|tag)|gh\s+(issue|pr|release|api|gist|repo)|glab\s|curl\s.*-(d|F|-data)|Invoke-(WebRequest|RestMethod)\s)/i;

/** Windows paths ignore case (and may differ in the drive letter's case). */
const pathKey = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
const isInside = (file, dir) => { const f = pathKey(file), d = pathKey(dir); return f === d || f.startsWith(d + path.sep); };

export function guardDecision(kb, input) {
  if (!kb.config.sources.length) return null;
  const root = kb.config.root;
  let targetLevel = 0;
  const name = input.tool_name || '';
  const ti = input.tool_input || {};
  let text = '';
  let target = '';
  if (name === 'Bash' || name === 'PowerShell' || /device_bash$/.test(name)) {
    const cmd = String(ti.command || '');
    if (!OUTWARD.test(cmd)) return null;
    text = cmd;
    if (/git\s+commit/.test(cmd)) text += `\n${commitText(root, cmd)}`;
    if (/git\s+push/.test(cmd)) text += `\n${unpushedText(root)}`;
    target = 'Befehl';
  } else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) {
    const file = path.resolve(root, String(ti.file_path || ti.notebook_path || ''));
    const src = kb.config.sources.find((s) => isInside(file, s.dir));
    if (src) {
      // writing into a private source: only content from sources with a narrower audience is a leak
      if (src.level === 'project') return null;
      targetLevel = LEVELS[src.level];
      text = [ti.content, ti.new_string, ti.new_source, ...(ti.edits || []).map((e) => e.new_string)].filter(Boolean).join('\n');
      const hits = findLeaks(text, fingerprints(kb, { targetLevel }));
      return hits.length ? deny(`${src.label}/${path.relative(src.dir, file).split(path.sep).join('/')}`, hits, 'Projektwissen gehört nicht in HBT-weites Wissen.') : null;
    }
    if (!isInside(file, root) || pathKey(file) === pathKey(root)) return null;
    const rel = path.relative(root, file);
    try { execFileSync('git', ['check-ignore', '-q', rel], { cwd: root, stdio: 'ignore' }); return null; } catch { /* not ignored */ }
    text = [ti.content, ti.new_string, ti.new_source, ...(ti.edits || []).map((e) => e.new_string)].filter(Boolean).join('\n');
    target = rel.split(path.sep).join('/');
  } else return null;
  const hits = findLeaks(text, fingerprints(kb, { targetLevel }));
  return hits.length ? deny(target, hits, 'Interne Inhalte gehören nur in die privaten Wissensquellen.') : null;
}

function deny(target, hits, hint) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Wissensbasis-Leak-Schutz: ${target} enthält Inhalte aus einer Wissensquelle mit engerem Leserkreis ` +
        `(${hits.slice(0, 3).map((h) => `${h.kind}: „${h.text.slice(0, 80)}“`).join('; ')}). ` +
        `Formuliere neutral ohne interne Details oder frage den Nutzer. ${hint}`,
    },
  };
}

// ---------------------------------------------------------------- MCP server

const TOOLS = [
  {
    name: 'decisions',
    description:
      'Entscheidungsregister des Projekts: alle ADRs (öffentlich in arc42, intern im Sidecar) mit Status, Nachfolger und id. ' +
      'Vor Änderungen an Architektur, Abläufen oder Regeln prüfen, welche Entscheidung gilt; mit `read ADR-nn` vollständig lesen.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional: Thema, z. B. „Redis“ oder „Löschen“' },
        status: { type: 'string', description: 'Optional: gilt, vorgeschlagen, übernommen, abgelöst, verworfen' },
        scope: { type: 'string', enum: ['all', 'public', 'intern'], default: 'all' },
      },
    },
  },
  {
    name: 'search',
    description:
      'Volltextsuche in der Wissensbasis des Projekts (öffentliche Doku wie arc42, README, AGENTS.md plus privater Sidecar mit internen ' +
      'fachlichen Prozessen). Nutze sie vor Antworten zu Fachlichkeit, Prozessen, Begriffen, Architektur und Entscheidungen. ' +
      'Liefert Abschnitte mit id, Quelle (öffentlich/INTERN) und Ausschnitt; danach mit `read` lesen.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Frage oder Stichworte, deutsch oder englisch' },
        audience: { type: 'string', enum: ['business', 'domain', 'tech'], description: 'Optional: nur Dokumente für Wirtschaft, Fachlichkeit oder Technik' },
        scope: { type: 'string', enum: ['all', 'public', 'intern'], default: 'all' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 8 },
      },
      required: ['query'],
    },
  },
  {
    name: 'read',
    description: 'Liest ein Dokument, einen Abschnitt oder eine Entscheidung über ihre id (z. B. `public:docs/arc42/05-bausteinsicht.md#edge`, nur den Pfad, oder `ADR-07`).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'define',
    description: 'Schlägt einen Begriff der Domänensprache nach (Glossare öffentlich und intern), auch über Code-Namen. Für ein Wort, das nicht verwendet werden soll, nennt es den richtigen Begriff. Vor dem Benennen von Dingen in Code, UI-Texten und Doku nutzen.',
    inputSchema: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] },
  },
  {
    name: 'overview',
    description: 'Inhaltsverzeichnis der Wissensbasis mit Kurzfassungen, optional gefiltert nach Zielgruppe oder Quelle.',
    inputSchema: {
      type: 'object',
      properties: {
        audience: { type: 'string', enum: ['business', 'domain', 'tech'] },
        scope: { type: 'string', enum: ['all', 'public', 'intern'], default: 'all' },
      },
    },
  },
];

function formatHits(hits) {
  if (!hits.length) return 'Keine Treffer. Andere Begriffe versuchen, `define` für Fachbegriffe nutzen oder `overview` ansehen.';
  return hits.map((h, i) =>
    `${i + 1}. ${h.tag}${h.kind}: ${h.title}\n   id: ${h.id}\n   ${h.snippet}`).join('\n')
    + (hits.some((h) => h.scope === 'intern') ? `\n\n⚠ ${INTERN_NOTICE}` : '');
}

function formatDefs(defs) {
  if (!defs.length) return 'Kein Glossareintrag gefunden. Mit `search` im Volltext suchen. Fehlt der Begriff, gehört er ins Glossar.';
  return defs.map((g) => [
    g.instead ? `„${g.instead}“ gehört nicht zur Domänensprache. Verwende **${g.term}**.` : null,
    `${g.tag}**${g.term}**${g.aliases.length ? ` (${g.aliases.join(', ')})` : ''}: ${g.definition}`,
    g.avoid.length ? `  Nicht verwenden: ${g.avoid.join(', ')}` : null,
    `  Quelle: ${g.note ? g.docId : `${g.docId}#${g.anchor}`}`,
  ].filter(Boolean).join('\n')).join('\n\n');
}

export function callTool(kb, name, args = {}) {
  switch (name) {
    case 'search': return formatHits(search(kb, String(args.query || ''), { audience: args.audience, scope: args.scope || 'all', limit: Math.min(25, args.limit || 8) }));
    case 'read': return readEntry(kb, String(args.id || '')) ?? `Nicht gefunden: ${args.id}. Ids liefert \`search\` oder \`overview\`.`;
    case 'define': return formatDefs(define(kb, String(args.term || '')));
    case 'overview': return overview(kb, { audience: args.audience, scope: args.scope || 'all' });
    case 'decisions': return formatDecisions(listDecisions(kb, { status: args.status, scope: args.scope || 'all', query: args.query }));
    default: throw Object.assign(new Error(`Unbekanntes Tool: ${name}`), { code: -32602 });
  }
}

const SERVER_INSTRUCTIONS =
  'Wissensbasis des Projekts: öffentliche Doku und ein privater Sidecar mit internem Fachwissen. Vor Antworten zu Fachlichkeit, ' +
  'Prozessen, Begriffen, Architektur oder Entscheidungen erst `search` bzw. `define`, dann `read`; Quelle (id) nennen. ' +
  `Treffer mit [INTERN]: ${INTERN_NOTICE}`;

export function startMcp(root) {
  let cache = null, cacheAt = 0;
  const kbNow = () => {
    if (!cache || Date.now() - cacheAt > 3000) { cache = loadKnowledge(root); cacheAt = Date.now(); }
    return cache;
  };
  const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    const { id, method, params = {} } = msg;
    const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
    try {
      switch (method) {
        case 'initialize':
          return reply({
            protocolVersion: params.protocolVersion || '2025-06-18',
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: 'knowledge', version: VERSION },
            instructions: SERVER_INSTRUCTIONS,
          });
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools: TOOLS });
        case 'tools/call': {
          const text = callTool(kbNow(), params.name, params.arguments || {});
          return reply({ content: [{ type: 'text', text }] });
        }
        case 'resources/list':
          return reply({
            resources: kbNow().docs.map((d) => ({
              uri: `kb://${d.id.split(':')[0]}/${d.rel}`, name: d.title, mimeType: 'text/markdown',
              description: `${d.tag}${d.summary}`.slice(0, 300),
            })),
          });
        case 'resources/read': {
          const m = /^kb:\/\/([a-z0-9-]+)\/(.+)$/.exec(params.uri || '');
          const text = m && readEntry(kbNow(), `${m[1]}:${m[2]}`);
          if (!text) return fail(-32002, `Resource not found: ${params.uri}`);
          return reply({ contents: [{ uri: params.uri, mimeType: 'text/markdown', text }] });
        }
        default:
          if (method?.startsWith('notifications/')) return undefined;
          return fail(-32601, `Method not found: ${method}`);
      }
    } catch (e) {
      if (e.code === -32602) return fail(-32602, e.message);
      if (method === 'tools/call') return reply({ content: [{ type: 'text', text: `Fehler: ${e.message}` }], isError: true });
      return fail(-32603, e.message);
    }
  });
}

// ---------------------------------------------------------------- init / scaffolding

function copyDir(src, dst, { skip = [], rename = {}, overwrite = false } = {}) {
  const written = [];
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, rename[e.name] || e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); written.push(...copyDir(s, d, { skip, overwrite })); }
    else if (overwrite ? !fs.existsSync(d) || !fs.readFileSync(d).equals(fs.readFileSync(s)) : !fs.existsSync(d)) {
      fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); written.push(d);
    }
  }
  return written;
}

function mergeJson(file, mutate) {
  const data = readJson(file) || {};
  mutate(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

const HOOK = (args) => `node "$CLAUDE_PROJECT_DIR/tools/knowledge/kb.mjs" hook ${args}`;
const AGENTS_MARKER = '<!-- knowledge-base -->';

/**
 * Vendors the tool into a repository (tools/knowledge) and wires hooks, MCP server, skill and AGENTS.md.
 * `update: true` only refreshes the vendored tool files to this version. Projects that get the tool as a
 * plugin (central tool distribution) need neither: there only knowledge.json belongs into the project.
 */
export function init(target, { name, update = false } = {}) {
  const root = path.resolve(target);
  const log = [];
  const toolDir = path.join(root, 'tools', 'knowledge');
  if (path.resolve(toolDir) !== path.resolve(HERE)) {
    fs.mkdirSync(toolDir, { recursive: true });
    log.push(...copyDir(HERE, toolDir, { skip: ['test', 'node_modules'], overwrite: update }).map((f) => `${update ? 'aktualisiert' : 'kopiert'} ${posix(path.relative(root, f))}`));
  }
  if (update) {
    const skillDst = path.join(root, '.claude', 'skills', 'knowledge', 'SKILL.md');
    if (fs.existsSync(skillDst)) log.push(...copyDir(path.join(HERE, 'skills', 'knowledge'), path.dirname(skillDst), { overwrite: true }).map((f) => `aktualisiert ${posix(path.relative(root, f))}`));
    log.push(`Werkzeug auf Version ${VERSION}`);
    return log;
  }
  const cfgFile = path.join(root, 'knowledge.json');
  if (!fs.existsSync(cfgFile)) {
    fs.writeFileSync(cfgFile, `${JSON.stringify({ name: name || path.basename(root), sources: DEFAULT_PUBLIC.sources, glossaries: DEFAULT_PUBLIC.glossaries }, null, 2)}\n`);
    log.push('angelegt knowledge.json');
  }
  mergeJson(path.join(root, '.mcp.json'), (d) => {
    d.mcpServers ||= {};
    d.mcpServers.knowledge ||= { command: 'node', args: ['tools/knowledge/kb.mjs', 'mcp'] };
  });
  log.push('MCP-Server in .mcp.json');
  mergeJson(path.join(root, '.claude', 'settings.json'), (d) => {
    d.hooks ||= {};
    const add = (event, matcher, cmd) => {
      d.hooks[event] ||= [];
      if (JSON.stringify(d.hooks[event]).includes('tools/knowledge/kb.mjs')) return;
      d.hooks[event].push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: cmd, timeout: 15 }] });
    };
    add('SessionStart', null, HOOK('session'));
    add('UserPromptSubmit', null, HOOK('prompt'));
    add('PreToolUse', 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit', HOOK('guard'));
    d.enabledMcpjsonServers ||= [];
    if (!d.enabledMcpjsonServers.includes('knowledge')) d.enabledMcpjsonServers.push('knowledge');
  });
  log.push('Hooks und Freigabe in .claude/settings.json');
  const skillDst = path.join(root, '.claude', 'skills', 'knowledge', 'SKILL.md');
  if (!fs.existsSync(skillDst)) {
    fs.mkdirSync(path.dirname(skillDst), { recursive: true });
    fs.copyFileSync(path.join(HERE, 'skills', 'knowledge', 'SKILL.md'), skillDst);
    log.push('Skill .claude/skills/knowledge/SKILL.md');
  }
  const gi = path.join(root, '.gitignore');
  const giText = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const giAdd = ['.knowledge.local.json', '.knowledge-intern/'].filter((l) => !giText.split(/\r?\n/).includes(l));
  if (giAdd.length) {
    fs.writeFileSync(gi, `${giText}${giText && !giText.endsWith('\n') ? '\n' : ''}\n# Wissensbasis: privater Sidecar und lokale Einstellung\n${giAdd.join('\n')}\n`);
    log.push(`.gitignore: ${giAdd.join(', ')}`);
  }
  const agents = path.join(root, 'AGENTS.md');
  const snippet = fs.readFileSync(path.join(HERE, 'templates', 'AGENTS-snippet.md'), 'utf8');
  if (fs.existsSync(agents)) {
    const t = fs.readFileSync(agents, 'utf8');
    if (!t.includes(AGENTS_MARKER)) { fs.writeFileSync(agents, `${t.replace(/\s*$/, '\n')}\n${snippet}`); log.push('Abschnitt in AGENTS.md'); }
  } else { fs.writeFileSync(agents, `# AGENTS.md\n\n${snippet}`); log.push('AGENTS.md angelegt'); }
  return log;
}

export function initSidecar(dir, { company = false, project } = {}) {
  const target = path.resolve(dir);
  fs.mkdirSync(target, { recursive: true });
  if (company) return copyDir(path.join(HERE, 'templates', 'company'), target);
  // the template keeps the workflow under github/ so it is not mistaken for this repository's own workflows
  const written = copyDir(path.join(HERE, 'templates', 'sidecar'), target, { rename: { github: '.github' } });
  const name = project || path.basename(target).replace(/-knowledge$/, '');
  mergeJson(path.join(target, 'knowledge.json'), (d) => { if (!d.project) d.project = name; if (!d.module) d.module = name; });
  return written;
}

/**
 * A modular Obsidian vault: one folder with shared settings and templates, the knowledge repositories as
 * subfolders (modules). Everyone clones only the modules they may read; links into missing modules stay
 * unresolved for them, and the audit reports them separately instead of as errors.
 */
export function initVault(dir, { update = false, register = false } = {}) {
  const target = path.resolve(expandHome(dir));
  fs.mkdirSync(target, { recursive: true });
  const log = copyDir(path.join(HERE, 'templates', 'vault'), target, { rename: { obsidian: '.obsidian' }, overwrite: update })
    .map((f) => `${update ? 'aktualisiert' : 'angelegt'} ${posix(path.relative(target, f)) || f}`);
  if (register) {
    mergeJson(userConfigFile(), (d) => {
      d.vaults ||= [];
      if (!d.vaults.map((v) => path.resolve(expandHome(v))).includes(target)) d.vaults.push(target);
    });
    log.push(`Vault in ${userConfigFile()} eingetragen`);
  }
  return log;
}

export function newPage(kb, scope, rel, { title, audience }) {
  const base = scope === 'public' ? kb.config.root : sourceById(kb, scope)?.dir;
  if (!base) throw new Error(`Keine Wissensquelle „${scope}“ gefunden (siehe \`kb status\`).`);
  const file = path.join(base, rel.endsWith('.md') ? rel : `${rel}.md`);
  if (fs.existsSync(file)) throw new Error(`Existiert schon: ${file}`);
  const tpl = fs.readFileSync(path.join(HERE, 'templates', 'page.md'), 'utf8')
    .replace('{{title}}', title || path.basename(rel, '.md'))
    .replace('{{audience}}', normalizeAudience(audience || 'business,domain,tech').join(', '))
    .replace('{{visibility}}', scope === 'public' ? 'public' : 'intern')
    .replace('{{today}}', new Date().toISOString().slice(0, 10));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, tpl);
  return file;
}

// ---------------------------------------------------------------- consolidation: audit, changes, report

const PATH_TOKEN = /^[\w.-]+(?:\/[\w.-]+)+\/?$/;
const IDENT_TOKEN = /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/;

/** References a page makes to files, code identifiers and other knowledge ids, with file line numbers. */
export function extractRefs(doc) {
  const refs = { links: [], paths: [], idents: [], ids: [] };
  let fence = false;
  doc.body.split(/\r?\n/).forEach((text, i) => {
    const line = doc.bodyLine + i + 1;
    if (/^\s*```/.test(text)) { fence = !fence; return; }
    if (fence) return;
    for (const m of text.replace(/`[^`]*`/g, (x) => ' '.repeat(x.length)).matchAll(/\]\(([^)\s]+)\)/g)) {
      const [t, frag] = m[1].split('#');
      if ((t || frag) && !/^[a-z][a-z0-9+.-]*:/i.test(t)) refs.links.push({ value: t, frag, line });
    }
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const t = m[1].trim();
      if (/^(public|intern):\S+$/.test(t)) refs.ids.push({ value: t, line });
      else if (PATH_TOKEN.test(t) && !/\.\.\.|…/.test(t)) refs.paths.push({ value: t.replace(/\/$/, ''), line });
      else if (IDENT_TOKEN.test(t)) refs.idents.push({ value: t, line });
    }
  });
  return refs;
}

/**
 * Windows and macOS ignore case, GitHub does not: check the spelling of the path segments below `base`
 * (the repository or source folder). Segments above it are not checked, because on Windows they may come
 * as short 8.3 names (C:\\Users\\ABCDEF~1) or with a different drive letter case.
 */
function existsExactCase(file, base) {
  const rel = path.relative(path.resolve(base), path.resolve(file));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
  let cur = path.resolve(base);
  for (const seg of rel.split(path.sep)) {
    try { if (!fs.readdirSync(cur).includes(seg)) return false; } catch { return true; }
    cur = path.join(cur, seg);
  }
  return true;
}

function isGitRepo(root) {
  try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'ignore' }); return true; } catch { return false; }
}

/** Which of the identifiers occur as whole words in tracked non-Markdown files; null if git is unavailable. */
function codeIdentifiers(root, idents) {
  if (!idents.length) return new Set();
  if (!isGitRepo(root)) return null;
  const tmp = path.join(fs.mkdtempSync(path.join(osTmp(), 'kb-')), 'patterns.txt');
  fs.writeFileSync(tmp, `${idents.join('\n')}\n`);
  try {
    const outText = execFileSync('git', ['grep', '-h', '-o', '-w', '-F', '-f', tmp, '--', '.', ':(exclude)*.md'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 << 20 });
    return new Set(outText.split('\n').filter(Boolean));
  } catch (e) {
    return e.status === 1 ? new Set() : null;
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}
function gitIgnored(base, rel) {
  try { execFileSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: base, stdio: 'ignore' }); return true; } catch { return false; }
}
const osTmp = () => process.env.RUNNER_TEMP || process.env.TMPDIR || process.env.TEMP || '/tmp';

const inflected = (w) => new RegExp(`(^|[^\\p{L}\\p{N}_])(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e|en|er|ern|es|s|n|in|innen)?)(?=$|[^\\p{L}\\p{N}_])`, 'u');

const termIndexRe = (flags = '') => new RegExp(`^[ \\t]*${TERM_INDEX_START}[ \\t]*\\r?$[\\s\\S]*?^[ \\t]*${TERM_INDEX_END}[ \\t]*\\r?$`, `m${flags}`);
const withoutTermIndex = (body) => body.replace(termIndexRe('g'), (m) => m.replace(/[^\n]/g, ''));

/** Domain language: synonyms to avoid in docs and configured files, duplicate or conflicting terms. */
export function auditTerms(kb) {
  const out = [];
  const avoid = kb.glossary.flatMap((g) => g.avoid.map((w) => ({ w, re: inflected(w), g })));
  // technical names that contain a replaced word, e.g. a service called „View-Profile Service“
  const allow = [...(kb.config.public.terminology?.allow || []), ...kb.config.sources.flatMap((s) => s.config.terminology?.allow || [])];
  const scanText = (text, report, startLine = 1, markdown = true) => {
    let fence = false;
    text.split(/\r?\n/).forEach((l, i) => {
      if (/^\s*```/.test(l)) { fence = !fence; return; }
      if (fence) return;
      // code spans, link targets and HTML tags name code or files, not the domain
      let prose = l.replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/<[^>]+>/g, ' ');
      for (const phrase of allow) prose = prose.split(phrase).join(' ');
      // a word mentioned as a word („Template“, *Template*) is not a use of it
      if (markdown) prose = prose.replace(/„[^“]*“/g, ' ').replace(/(^|[^*\w])\*[^*\n]+\*(?!\*)/g, '$1 ');
      for (const a of avoid) {
        const m = a.re.exec(prose);
        if (m) report(startLine + i, `${m[2]} → ${a.g.term}`, a);
      }
    });
  };
  if (avoid.length) {
    const lang = kb.config.public.terminology?.language || kb.config.public.language || 'de';
    for (const doc of kb.docs) {
      if (doc.isGlossary || isTermNote(doc) || (doc.language && doc.language !== lang)) continue; // e.g. English docs translate terms
      scanText(withoutTermIndex(doc.body), (line, detail, a) => {
        // the HBT-wide domain language applies everywhere; project terms only inside the project sidecar
        if (a.g.level === 'project' && doc.level !== 'project') return;
        out.push({ id: doc.id, scope: doc.scope, rel: doc.rel, line, kind: 'Nicht in der Domänensprache', detail });
      }, doc.bodyLine + 1);
    }
    const globs = kb.config.public.terminology?.scan || [];
    if (globs.length) {
      const root = kb.config.root;
      for (const rel of git(root, ['ls-files']).split('\n').filter((f) => f && matchAny(f, globs))) {
        let text;
        try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
        // in message files only the texts count, not the keys
        if (/\.json$/i.test(rel)) text = text.replace(/^(\s*)"(?:[^"\\]|\\.)*"\s*:/gm, '$1');
        else if (/\.properties$/i.test(rel)) text = text.replace(/^(\s*)[^=:#!\s][^=:]*[=:]/gm, '$1');
        scanText(text, (line, detail, a) => {
          if (a.g.level === 'project') return;
          out.push({ id: `public:${rel}`, scope: 'public', rel, line, kind: 'Nicht in der Domänensprache', detail });
        }, 1, false);
      }
    }
  }
  const byName = new Map();
  for (const g of kb.glossary) {
    const k = normalize(g.term);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(g);
  }
  for (const [, list] of byName) {
    for (const g of list.slice(1)) {
      const first = list[0];
      // the public repository must explain its terms itself, so a public copy of a private term is intended
      if ((g.scope === 'public') !== (first.scope === 'public')) continue;
      const kind = g.source === first.source ? 'Begriff mehrfach definiert' : 'Begriff in mehreren Quellen (der erste gilt)';
      out.push({ id: g.docId, scope: g.scope, rel: g.docId.replace(/^[\w-]+:/, ''), line: g.line, kind, detail: `${g.term} (auch in ${first.docId})` });
    }
  }
  for (const g of kb.glossary) {
    for (const w of g.avoid) {
      const clash = byName.get(normalize(w));
      if (clash) out.push({ id: g.docId, scope: g.scope, rel: g.docId.replace(/^[\w-]+:/, ''), line: g.line, kind: 'Widerspruch im Glossar', detail: `${g.term}: „${w}“ ist zugleich eigener Begriff` });
    }
  }
  return out;
}

export function audit(kb) {
  const root = kb.config.root;
  const findings = [];
  const add = (doc, line, kind, detail = '') => findings.push({ id: doc.id, scope: doc.scope, rel: doc.rel, line, kind, detail });
  const idents = new Map();
  const yearAgo = Date.now() - 365 * 864e5;
  for (const doc of kb.docs) {
    const base = doc.base || root;
    const refs = extractRefs(doc);
    for (const { value, frag, line } of refs.links) {
      let target;
      try { target = value ? path.resolve(path.dirname(path.join(base, doc.rel)), decodeURI(value)) : path.resolve(doc.file); } catch { continue; }
      if (!fs.existsSync(target)) { add(doc, line, 'Link ins Leere', value); continue; }
      if (!existsExactCase(target, base)) { add(doc, line, 'Link mit falscher Groß-/Kleinschreibung (auf GitHub tot)', value); continue; }
      if (!frag) continue;
      let anchor;
      try { anchor = decodeURIComponent(frag).toLowerCase(); } catch { anchor = frag.toLowerCase(); }
      const tdoc = kb.docs.find((d) => d.file && path.resolve(d.file) === target);
      if (tdoc && !docAnchors(tdoc).has(anchor)) {
        if (kb.glossary.some((g) => g.docId === tdoc.id && g.anchor === anchor)) add(doc, line, 'Begriff ohne Anker im Glossar (`kb.mjs terms --anchors`)', `${value}#${frag}`);
        else add(doc, line, anchor.startsWith('begriff-') ? 'Link auf unbekannten Begriff' : 'Link auf unbekannten Abschnitt', `${value}#${frag}`);
      }
    }
    for (const { value, line } of refs.paths) {
      const first = value.split('/')[0];
      if (first === '.' || first === '..' || gitIgnored(base, value)) continue;
      const bases = (doc.scope === 'intern' ? [root, base] : [root]).filter((b) => fs.existsSync(path.join(b, first)));
      if (bases.length && !bases.some((b) => fs.existsSync(path.join(b, value)))) add(doc, line, 'Pfad existiert nicht mehr', value);
    }
    for (const { value, line } of refs.ids) {
      const refSrc = kb.config.sources.find((s) => value.startsWith(`${s.id}:`)) || (value.startsWith('intern:') ? { level: 'project' } : null);
      if (refSrc && LEVELS[refSrc.level] > LEVELS[doc.level || 'public']) add(doc, line, doc.scope === 'public' ? 'Öffentliche Seite verweist auf INTERN' : 'Verweis auf Wissen mit engerem Leserkreis', value);
      const { doc: target, frag } = findDoc(kb, value);
      const known = !frag || (frag.startsWith('begriff-')
        ? kb.glossary.some((g) => g.docId === target?.id && g.anchor === frag)
        : target?.sections.some((s) => s.id === `${target.id}#${frag}`));
      if (!target || !known) {
        add(doc, line, 'Verweis auf unbekannte Wissens-id', value);
      }
    }
    for (const r of refs.idents) { if (!idents.has(r.value)) idents.set(r.value, []); idents.get(r.value).push({ doc, line: r.line }); }
    if (doc.reviewed && Date.parse(doc.reviewed) < yearAgo) add(doc, null, 'Länger als 12 Monate nicht geprüft', String(doc.reviewed));
    if (!doc.summary) add(doc, null, 'Ohne Kurzfassung');
    if (!doc.audience.length) add(doc, null, 'Ohne Zielgruppe');
  }
  findings.push(...auditTerms(kb));
  findings.push(...auditDecisions(kb));
  findings.push(...auditLinks(kb));
  for (const g of kb.glossary) {
    // code names of glossary terms (e.g. `ViewProfile`, `initials`) must exist in the code
    for (const a of g.code) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) continue;
      const doc = kb.docs.find((d) => d.id === g.docId);
      if (!idents.has(a)) idents.set(a, []);
      idents.get(a).push({ doc, line: g.line });
    }
  }
  const ignore = new Set(kb.config.public.auditIgnore || []);
  for (const s of kb.config.sources) for (const i of s.config.auditIgnore || []) ignore.add(i);
  for (const i of ignore) idents.delete(i);
  const found = codeIdentifiers(root, [...idents.keys()]);
  if (found) {
    for (const [ident, uses] of idents) if (!found.has(ident)) for (const u of uses) add(u.doc, u.line, 'Bezeichner nicht im Code gefunden', ident);
  }
  return findings.filter((f) => !ignore.has(f.detail));
}

export function formatAudit(findings) {
  if (!findings.length) return 'Keine Auffälligkeiten.';
  const byKind = new Map();
  for (const f of findings) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind).push(f); }
  const out = [];
  for (const [kind, list] of byKind) {
    out.push(`### ${kind} (${list.length})`, '');
    for (const f of list) out.push(`- \`${f.id}\`${f.line ? ` Zeile ${f.line}` : ''}${f.detail ? `: \`${f.detail}\`` : ''}`);
    out.push('');
  }
  return out.join('\n').trim();
}

export function readState(kb) {
  const dir = kb.config.private.dir;
  return (dir && readJson(path.join(dir, 'consolidation', 'state.json'))) || {};
}

export function changes(kb, { since } = {}) {
  const root = kb.config.root;
  const from = since || readState(kb).lastCommit;
  let range, label;
  if (from && git(root, ['rev-parse', '--verify', '-q', `${from}^{commit}`]).trim()) {
    range = [`${from}..HEAD`];
    label = `seit Commit ${from.slice(0, 10)}`;
  } else {
    const d = since || '8 days ago';
    range = [`--since=${d}`, 'HEAD'];
    label = `seit ${d}`;
  }
  const commits = git(root, ['log', '--date=short', '--format=%h%x09%ad%x09%s', ...range]).split('\n').filter(Boolean)
    .map((l) => { const [hash, date, subject] = l.split('\t'); return { hash, date, subject }; });
  const files = { A: new Set(), M: new Set(), D: new Set(), R: [] };
  for (const l of git(root, ['log', '--format=', '--name-status', '-M', ...range]).split('\n').filter(Boolean)) {
    const [st, a, b] = l.split('\t');
    if (st.startsWith('R')) files.R.push([a, b]);
    else if (files[st[0]]) files[st[0]].add(a);
  }
  for (const f of files.D) { files.A.delete(f); files.M.delete(f); }
  for (const f of files.A) files.M.delete(f);
  const issues = [...new Set(commits.flatMap((c) => issueRefs(c.subject)))]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  // pages that mention files that were deleted, renamed or changed
  const name = (f) => path.basename(f).replace(/\.[^.]+$/, '');
  const signals = [
    ...[...files.D].map((f) => [f, 'gelöscht']),
    ...files.R.map(([a, b]) => [a, `umbenannt in ${b}`]),
    ...[...files.M].filter((f) => !/\.md$/i.test(f)).map((f) => [f, 'geändert']),
  ];
  const affected = [];
  for (const doc of kb.docs) {
    const hits = [];
    for (const [f, what] of signals) {
      const n = name(f);
      const word = n.length >= 6 && new RegExp(`(^|[^\\w])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`).test(doc.body);
      if (doc.body.includes(f) || word) hits.push(`${f} (${what})`);
    }
    if (hits.length) affected.push({ id: doc.id, hits });
  }
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const decisions = kb.decisions
    .filter((d) => d.issues.some((n) => issues.includes(n)) || commits.some((c) => c.subject.toUpperCase().includes(d.id)))
    .map((d) => ({ id: d.id, title: d.title, status: d.status, scope: d.scope, tag: d.tag, issues: d.issues.filter((n) => issues.includes(n)) }));
  return { label, head, commits, issues, files: { added: [...files.A], modified: [...files.M], deleted: [...files.D], renamed: files.R }, affected, decisions };
}

export function formatChanges(c) {
  const out = [`Zeitraum: ${c.label}, bis ${c.head.slice(0, 10)}. ${c.commits.length} Commits.`, ''];
  if (!c.commits.length) return `${out.join('\n')}Keine Änderungen.`;
  out.push('### Commits', '', ...c.commits.map((x) => `- ${x.date} \`${x.hash}\` ${x.subject}`), '');
  if (c.issues.length) out.push(`Erwähnte Issues/PRs: ${c.issues.join(', ')}`, '');
  const byTop = (list) => {
    const m = new Map();
    for (const f of list) { const t = f.includes('/') ? f.split('/')[0] : '(Wurzel)'; m.set(t, (m.get(t) || 0) + 1); }
    return [...m].map(([t, n]) => `${t} ${n}`).join(', ');
  };
  out.push('### Dateien', '');
  if (c.files.added.length) out.push(`- neu: ${byTop(c.files.added)}`);
  if (c.files.modified.length) out.push(`- geändert: ${byTop(c.files.modified)}`);
  if (c.files.deleted.length) out.push(`- gelöscht: ${c.files.deleted.map((f) => `\`${f}\``).join(', ')}`);
  if (c.files.renamed.length) out.push(`- umbenannt: ${c.files.renamed.map(([a, b]) => `\`${a}\` → \`${b}\``).join(', ')}`);
  out.push('', '### Entscheidungen zu Issues dieses Zeitraums', '');
  out.push(...(c.decisions.length ? c.decisions.map((d) => `- ${d.tag}${d.id} ${d.title} (${d.status}) – ${d.issues.length ? d.issues.join(', ') : 'im Commit genannt'}`) : ['- keine']));
  out.push('', '### Seiten, die geänderte Dateien erwähnen', '');
  out.push(...(c.affected.length ? c.affected.map((a) => `- \`${a.id}\`: ${a.hits.slice(0, 6).join('; ')}${a.hits.length > 6 ? ` … (+${a.hits.length - 6})` : ''}`) : ['- keine']));
  return out.join('\n');
}

export async function consolidationReport(kb, { since } = {}) {
  const c = changes(kb, { since });
  const f = audit(kb);
  const jc = jiraConfig(kb);
  let jira = '';
  if (jiraReady(jc)) {
    const lastRun = readState(kb).lastRun;
    const from = /^\d{4}-\d{2}-\d{2}/.test(since || '') ? since.slice(0, 10) : lastRun ? lastRun.slice(0, 10) : '-8d';
    try {
      const list = formatJiraList(await jiraSearch(jc, { since: from }));
      logJira(list);
      jira = `## Jira: seit ${from} geänderte Vorgänge (INTERN)\n\n${list}\n\nDetails mit \`kb jira <SCHLÜSSEL>\`.\n`;
    } catch (e) { jira = `## Jira\n\nNicht erreichbar: ${e.message}\n`; }
  } else if (jc.keys.length) {
    jira = `## Jira\n\nProjektschlüssel ${jc.keys.join(', ')} konfiguriert, aber ohne JIRA_URL/JIRA_TOKEN nicht abgefragt.\n`;
  }
  const text = [
    `# Eingaben für die Konsolidierung (${new Date().toISOString().slice(0, 10)})`,
    '',
    status(kb),
    '',
    '## Änderungen im Code',
    '',
    formatChanges(c),
    '',
    `## Auffälligkeiten im Wissen (${f.length})`,
    '',
    formatAudit(f),
    '',
    jira,
  ].join('\n');
  return { text, changes: c, findings: f };
}

// ---------------------------------------------------------------- Jira (read only)

/**
 * Jira of a project: keys in knowledge.json (`"jira": {"keys": ["PWR"], "url": "…"}`, the URL only in a private
 * source), credentials only from the environment (JIRA_URL, JIRA_USER + JIRA_TOKEN for Cloud, or JIRA_TOKEN alone
 * as bearer token for Server/Data Center). Everything read from Jira is internal.
 */
export function jiraConfig(kb) {
  // the URL never comes from the public knowledge.json, only from the environment or a private source
  const cfgs = kb.config.sources.map((s) => s.config.jira).filter(Boolean);
  const url = (process.env.JIRA_URL || cfgs.map((c) => c.url).find(Boolean) || '').replace(/\/+$/, '');
  return { url, keys: jiraKeys(kb.config), user: process.env.JIRA_USER || '', token: process.env.JIRA_TOKEN || '' };
}
export const jiraReady = (cfg) => Boolean(cfg.url && cfg.token && cfg.keys.length);

async function jiraGet(cfg, p) {
  const auth = cfg.user ? `Basic ${Buffer.from(`${cfg.user}:${cfg.token}`).toString('base64')}` : `Bearer ${cfg.token}`;
  const res = await fetch(`${cfg.url}${p}`, { headers: { Accept: 'application/json', Authorization: auth } });
  if (!res.ok) { const e = new Error(`Jira antwortet ${res.status} auf ${p.split('?')[0]}`); e.status = res.status; throw e; }
  return res.json();
}

const jiraText = (v) => (typeof v === 'string' ? v : v?.content ? adfText(v) : '').trim();
function adfText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  const inner = (node.content || []).map(adfText).join('');
  return ['paragraph', 'heading', 'listItem', 'codeBlock'].includes(node.type) ? `${inner}\n` : inner;
}

export async function jiraIssue(cfg, key) {
  const k = String(key).toUpperCase();
  if (!cfg.keys.some((p) => k.startsWith(`${p}-`))) throw new Error(`${k} gehört zu keinem konfigurierten Jira-Projekt (${cfg.keys.join(', ') || 'keine'}).`);
  const j = await jiraGet(cfg, `/rest/api/2/issue/${encodeURIComponent(k)}?fields=summary,status,issuetype,description,comment,resolution,resolutiondate,labels,fixVersions,issuelinks,created`);
  const f = j.fields || {};
  const out = [
    `# [INTERN] ${k}: ${f.summary || ''}`,
    `> ⚠ Aus Jira, intern. ${INTERN_NOTICE}`,
    `${f.issuetype?.name || '?'} · ${f.status?.name || '?'}${f.resolution ? ` · ${f.resolution.name}` : ''}${f.resolutiondate ? ` · erledigt ${String(f.resolutiondate).slice(0, 10)}` : ''} · angelegt ${String(f.created || '').slice(0, 10)}`,
  ];
  if (f.labels?.length) out.push(`Labels: ${f.labels.join(', ')}`);
  if (f.fixVersions?.length) out.push(`Versionen: ${f.fixVersions.map((v) => v.name).join(', ')}`);
  out.push('', '## Beschreibung', '', jiraText(f.description) || '(leer)');
  const links = (f.issuelinks || []).map((l) => {
    const o = l.outwardIssue || l.inwardIssue;
    return o && `- ${l.outwardIssue ? l.type?.outward : l.type?.inward}: ${o.key} ${o.fields?.summary || ''}`;
  }).filter(Boolean);
  if (links.length) out.push('', '## Verknüpfte Vorgänge', '', ...links);
  // comments without author names: knowledge is about content and roles, not persons
  const comments = (f.comment?.comments || []).slice(-10);
  if (comments.length) out.push('', `## Kommentare (letzte ${comments.length})`, '', ...comments.map((c) => `- ${String(c.created || '').slice(0, 10)}: ${jiraText(c.body).replace(/\s+/g, ' ').slice(0, 600)}`));
  return out.join('\n');
}

/** Issues of the configured projects updated since a date (YYYY-MM-DD) or a relative period like -8d. */
export async function jiraSearch(cfg, { since = '-8d', max = 100 } = {}) {
  const when = /^\d{4}-\d{2}-\d{2}$/.test(since) ? `"${since}"` : since;
  const jql = `project in (${cfg.keys.join(',')}) AND updated >= ${when} ORDER BY updated DESC`;
  const q = `jql=${encodeURIComponent(jql)}&fields=summary,status,issuetype,resolution&maxResults=${max}`;
  let data;
  try { data = await jiraGet(cfg, `/rest/api/2/search/jql?${q}`); } catch (e) {
    if (![404, 405, 410].includes(e.status)) throw e;
    data = await jiraGet(cfg, `/rest/api/2/search?${q}`); // Jira Server / Data Center
  }
  return (data.issues || []).map((i) => ({
    key: i.key, summary: i.fields?.summary || '', type: i.fields?.issuetype?.name || '', status: i.fields?.status?.name || '', resolution: i.fields?.resolution?.name || '',
  }));
}

export const formatJiraList = (list) => (list.length
  ? list.map((i) => `- [INTERN] ${i.key} ${i.summary} (${i.type}, ${i.status}${i.resolution ? `, ${i.resolution}` : ''})`).join('\n')
  : '- keine');

// ---------------------------------------------------------------- domain language

/** Adds `<a id="begriff-…"></a>` to every glossary entry so pages can link terms the same way everywhere. */
export function addTermAnchors(kb) {
  const changed = [];
  for (const doc of kb.docs.filter((d) => d.isGlossary)) {
    const entries = kb.glossary.filter((g) => g.docId === doc.id && !g.note);
    const raw = fs.readFileSync(doc.file, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    let n = 0;
    for (const g of entries) {
      const i = g.line - 1;
      if (!lines[i] || lines[i].includes(`id="${g.anchor}"`)) continue;
      const a = `<a id="${g.anchor}"></a>`;
      if (g.col !== null) {
        const cells = splitRow(lines[i]);
        cells[g.col] = `${a}${cells[g.col]}`;
        lines[i] = `| ${cells.join(' | ')} |`;
      } else lines[i] = lines[i].replace(/^(\s*[-*]\s+)/, `$1${a}`);
      n++;
    }
    if (n) { fs.writeFileSync(doc.file, lines.join(eol)); changed.push(`${doc.id}: ${n} Anker`); }
  }
  return changed;
}

export function formatTerms(kb) {
  const rows = kb.glossary.map((g) => `| ${g.tag}${g.term} | ${g.code.join(', ')} | ${g.avoid.join(', ')} | \`${g.note ? g.docId : `${g.docId}#${g.anchor}`}\` |`);
  return ['| Begriff | Im Code | Nicht verwenden | Verweis |', '|---|---|---|---|', ...rows].join('\n');
}

// ---------------------------------------------------------------- term notes: create, migrate, index

const yamlList = (xs) => `[${xs.map((x) => JSON.stringify(x)).join(', ')}]`;

export function termNoteText(term, { definition = '', aliases = [], code = [], avoid = [] } = {}) {
  const name = noteName(term);
  const fm = ['---', 'type: begriff'];
  if (name !== term) fm.push(`title: ${JSON.stringify(term)}`);
  const al = [...new Set([...(name !== term ? [term] : []), ...aliases])];
  if (al.length) fm.push(`aliases: ${yamlList(al)}`);
  if (code.length) fm.push(`code: ${yamlList(code)}`);
  if (avoid.length) fm.push(`nicht-verwenden: ${yamlList(avoid)}`);
  fm.push('tags: [begriff]', '---', '', `# ${term}`, '', definition || 'Definition in einem Satz, verständlich ohne Vorwissen.', '');
  return fm.join('\n');
}

const termsDir = (kb, scope) => (scope === 'public'
  ? path.resolve(kb.config.root, kb.config.public.terms?.dir || 'docs/glossar')
  : path.join(sourceById(kb, scope)?.dir || '', 'Begriffe'));

/** New term note: public in `terms.dir` (Markdown links), private in `Begriffe/` (Obsidian vault). */
export function createTerm(kb, scope, term, { definition, aliases = [], code = [], avoid = [] } = {}) {
  if (scope !== 'public' && !sourceById(kb, scope)) throw new Error(`Keine Wissensquelle „${scope}“ gefunden (siehe \`kb status\`).`);
  const existing = kb.glossary.find((g) => normalize(g.term) === normalize(term) && (scope === 'public' ? g.scope === 'public' : g.source === sourceById(kb, scope).id));
  if (existing) throw new Error(`„${term}“ gibt es schon: ${existing.docId}`);
  const file = path.join(termsDir(kb, scope), `${noteName(term)}.md`);
  if (fs.existsSync(file)) throw new Error(`Existiert schon: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, termNoteText(term, { definition, aliases, code, avoid }));
  return file;
}

const mdTarget = (rel) => (/[\s<>()]/.test(rel) ? `<${rel}>` : rel);
const relLink = (fromDir, file, frag) => mdTarget(`${path.relative(fromDir, file).split(path.sep).join('/')}${frag ? `#${frag}` : ''}`);

/** Converts glossary tables of the public repository into one note per term and replaces each table by a generated index. */
export function termsToNotes(kb, dirRel, { from } = {}) {
  const root = kb.config.root;
  const outDir = path.resolve(root, dirRel || kb.config.public.terms?.dir || 'docs/glossar');
  const written = [];
  const moved = new Map(); // `${file}#${anchor}` -> note file
  for (const doc of kb.docs.filter((d) => d.scope === 'public' && d.isGlossary && (!from || d.rel === from))) {
    const entries = kb.glossary.filter((g) => g.docId === doc.id && !g.note);
    if (!entries.length) continue;
    for (const g of entries) moved.set(`${path.resolve(doc.file)}#${g.anchor}`, path.join(outDir, `${noteName(g.term)}.md`));
    const rebase = (def) => def.replace(/\]\((<[^>]+>|[^)\s]+)\)/g, (m, raw) => {
      const target = raw.replace(/^<|>$/g, '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return m;
      const [p, frag] = target.split('#');
      const abs = p ? path.resolve(path.dirname(doc.file), p) : path.resolve(doc.file);
      const note = frag && moved.get(`${abs}#${frag}`);
      return `](${note ? relLink(outDir, note) : relLink(outDir, abs, frag)})`;
    });
    fs.mkdirSync(outDir, { recursive: true });
    for (const g of entries) {
      const file = path.join(outDir, `${noteName(g.term)}.md`);
      if (fs.existsSync(file)) continue;
      fs.writeFileSync(file, termNoteText(g.term, {
        definition: rebase(g.rawDefinition), aliases: g.aliases.filter((a) => !g.code.includes(a)), code: g.code, avoid: g.avoid,
      }));
      written.push(file);
    }
    const raw = fs.readFileSync(doc.file, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    let first = Math.min(...entries.map((g) => g.line)) - 1;
    const last = Math.max(...entries.map((g) => g.line)) - 1;
    if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[first - 1] || '')) first -= 2;
    lines.splice(first, last - first + 1, TERM_INDEX_START, TERM_INDEX_END);
    fs.writeFileSync(doc.file, lines.join(eol));
  }
  // links elsewhere that pointed at a table row now point at the note
  for (const doc of kb.docs.filter((d) => d.scope === 'public')) {
    const raw = fs.readFileSync(doc.file, 'utf8');
    const next = raw.replace(/\]\((<[^>]+>|[^)\s]+)\)/g, (m, r) => {
      const target = r.replace(/^<|>$/g, '');
      const [p, frag] = target.split('#');
      if (!frag || /^[a-z][a-z0-9+.-]*:/i.test(target)) return m;
      let abs;
      try { abs = p ? path.resolve(path.dirname(doc.file), decodeURI(p)) : path.resolve(doc.file); } catch { return m; }
      const note = moved.get(`${abs}#${frag}`);
      return note ? `](${relLink(path.dirname(doc.file), note)})` : m;
    });
    if (next !== raw) fs.writeFileSync(doc.file, next);
  }
  return written;
}

/**
 * The definition of a term note as Markdown for a table cell: the whole first paragraph with inline code and
 * links kept (links rebased to `dir`), `|` escaped, nothing cut off.
 */
export function termDefinitionCell(g, dir) {
  const para = [];
  let fence = false;
  for (const l of String(g.rawDefinition || '').split(/\r?\n/)) {
    const t = l.trim();
    if (t.startsWith('```')) { fence = !fence; if (para.length) break; continue; }
    if (fence) continue;
    if (!t) { if (para.length) break; continue; }
    if (/^(#|\||>|<!--)/.test(t)) { if (para.length) break; continue; }
    para.push(t);
  }
  const text = para.join(' ') || g.definition || '';
  const noteDir = path.dirname(g.file || path.join(dir, 'x'));
  const rebased = text.replace(/\]\((<[^>]+>|[^)\s]+)\)/g, (m, raw) => {
    const target = raw.replace(/^<|>$/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) return m;
    const [p, frag] = target.split('#');
    let abs;
    try { abs = path.resolve(noteDir, decodeURI(p)); } catch { return m; }
    return `](${relLink(dir, abs, frag)})`;
  });
  return rebased.replace(/(?<!\\)\|/g, '\\|');
}

/** Regenerates every `<!-- kb:begriffe -->` region in public pages from the public term notes. */
export function writeTermIndex(kb) {
  const changed = [];
  const notes = kb.glossary.filter((g) => g.note && g.scope === 'public').sort((a, b) => a.term.localeCompare(b.term, 'de'));
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  for (const doc of kb.docs.filter((d) => d.scope === 'public')) {
    const raw = fs.readFileSync(doc.file, 'utf8');
    if (!termIndexRe().test(raw)) continue;
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const dir = path.dirname(doc.file);
    const table = [
      '| Begriff | Bedeutung | Im Code | Nicht verwenden |', '|---|---|---|---|',
      ...notes.map((g) => `| [${esc(g.term)}](${relLink(dir, g.file)}) | ${termDefinitionCell(g, dir)} | ${g.code.map((c) => `\`${esc(c)}\``).join(', ')} | ${esc(g.avoid.join(', '))} |`),
    ].join(eol);
    const next = raw.replace(termIndexRe(), () =>
      `${TERM_INDEX_START}${eol}<!-- Erzeugt von \`kb terms --index\` aus den Begriffs-Notizen; dort ändern, nicht hier. -->${eol}${eol}${table}${eol}${eol}${TERM_INDEX_END}`);
    if (next !== raw) { fs.writeFileSync(doc.file, next); changed.push(doc.id); }
  }
  return changed;
}

// ---------------------------------------------------------------- status

export function status(kb) {
  const c = kb.config;
  const intern = kb.docs.filter((d) => d.scope === 'intern');
  const pub = kb.docs.filter((d) => d.scope === 'public');
  const lines = [
    `Wissensbasis ${VERSION} · Projekt: ${c.public.name || path.basename(c.root)}`,
    `Repository:  ${c.root}`,
    `Öffentlich:  ${pub.length} Dokumente, ${pub.reduce((n, d) => n + d.sections.length, 0)} Abschnitte`,
    c.private.dir ? null : `Projekt-Sidecar: nicht gefunden. Gesucht: ${(c.private.tried || []).join(' | ')}`,
    ...c.sources.map((s) => `${s.label.padEnd(12)} ${s.level === 'project' ? 'Projekt-Sidecar' : 'HBT-weit'}: ${s.dir} (über ${s.via}) – ${intern.filter((d) => d.source === s.id).length} Dokumente, Entscheidungen ADR-${s.adrPrefix}…`),
    `Glossar:     ${kb.glossary.length} Begriffe (${kb.glossary.filter((g) => g.scope === 'intern').length} intern)`,
  ];
  lines.splice(0, lines.length, ...lines.filter((l) => l !== null));
  const noAud = kb.docs.filter((d) => !d.audience.length);
  if (noAud.length) lines.push(`Ohne Zielgruppe: ${noAud.map((d) => d.id).join(', ')}`);
  const year = Date.now() - 365 * 864e5;
  const stale = kb.docs.filter((d) => d.reviewed && Date.parse(d.reviewed) < year);
  if (stale.length) lines.push(`Länger als 12 Monate nicht geprüft: ${stale.map((d) => `${d.id} (${d.reviewed})`).join(', ')}`);
  const noSummary = kb.docs.filter((d) => !d.summary);
  if (noSummary.length) lines.push(`Ohne Kurzfassung: ${noSummary.map((d) => d.id).join(', ')}`);
  const hints = readHints(kb);
  if (hints.length) lines.push('', `Offene Hinweise zum Code (${hints.length}, ${HINTS_FILE} im Projekt-Sidecar):`, formatHints(hints, Infinity), HINTS_RULE);
  return lines.join('\n');
}

// ---------------------------------------------------------------- CLI

const HELP = `Wissensbasis (kb) ${VERSION}

  node tools/knowledge/kb.mjs <befehl> [optionen]

  search <frage> [--audience business|domain|tech] [--scope all|public|intern] [--limit n]
  read <id>                  Dokument oder Abschnitt lesen
  define <begriff>           im Glossar nachschlagen (leitet Wörter aus „Nicht verwenden“ um)
  terms                      Domänensprache als Tabelle
  terms --index              Übersicht <!-- kb:begriffe --> in öffentlichen Seiten aus den Begriffs-Notizen erneuern
  terms --to-notes [ordner] [--from datei]   Glossar-Tabellen in eine Notiz je Begriff überführen
  term <public|intern|hbt> <begriff> [--definition "…"] [--code A,B] [--avoid X,Y] [--aliases …]   Begriffs-Notiz anlegen
  decisions [thema] [--status gilt] [--scope intern]   Entscheidungsregister (ADRs öffentlich + intern)
  decide <public|intern> <titel> [--issues "#12"]       neue Entscheidung mit nächster Nummer anlegen
  overview [--audience x] [--scope x]
  status                     Quellen, Sidecar, Pflegehinweise
  check [--staged] [--extra a.md,b.md]   Leak-Prüfung: interne Inhalte im öffentlichen Repo? (Exit 1 bei Fund)
  scan <datei|-> [--extra …]  Leak-Prüfung für einen Text, z. B. eine PR-Beschreibung (Exit 1 bei Fund)
                             --extra: weitere interne Texte, z. B. aus Jira (KB_JIRA_LOG sammelt sie beim Lesen)
  new <public|intern> <pfad> --title "…" [--audience business,domain]

  Konsolidierung (wöchentlicher Lauf, siehe tools/knowledge/consolidate/):
  audit [--json]             tote Links, Pfade, Bezeichner und Wissens-ids; Pflegehinweise
  changes [--since <ref|datum>] [--json]   Code-Änderungen seit dem letzten Lauf und betroffene Seiten
  report [--since x] [--out datei]          beides als Eingabe für den Agenten
  state --set <commit>       Stand des letzten Laufs im Sidecar merken (consolidation/state.json)
  jira [SCHLÜSSEL …] [--since 2026-11-01|-8d]   Jira-Vorgänge lesen (nur lesen, Inhalt INTERN);
                             Projektschlüssel in knowledge.json "jira": {"keys": [...]}, Zugang über JIRA_URL, JIRA_USER, JIRA_TOKEN
  init [zielordner] [--name x] [--update]   in ein Repository einbauen (MCP, Hooks, Skill, AGENTS.md);
                             --update bringt nur das kopierte Werkzeug auf diese Version
  init-sidecar <ordner> [--company] [--project name]   Gerüst für den Projekt-Sidecar bzw. das HBT-weite Wissen anlegen
  vault <ordner> [--register] [--update]   modularen Obsidian-Vault anlegen (Einstellungen, Vorlagen, Anleitung);
                             --register trägt ihn in ~/.config/knowledge/sources.json ein
  version
  mcp                        MCP-Server (stdio)
  hook session|prompt|guard  Claude-Code-Hooks

  Optionen: --root <dir> (sonst KB_ROOT, CLAUDE_PROJECT_DIR oder nächstes Git-Repo)
  Projekt-Sidecar: KB_PRIVATE_DIR, .knowledge.local.json {"privateDir": "…"}, ../<repo>-knowledge oder .knowledge-intern/
  Vault:    KB_VAULTS, .knowledge.local.json {"vaults": […]} oder ~/.config/knowledge/sources.json {"vaults": […]}
  HBT-weit: Nachbarordner mit knowledge.json {"level": "company"}, KB_SOURCES="<ordner>",
            .knowledge.local.json {"sources": [{"dir": "…"}]} oder ~/.config/knowledge/sources.json`;

/** `--extra a.md,b.md`: further internal texts for the leak check (missing files are skipped). */
function extraTexts(opt) {
  return asList(typeof opt.extra === 'string' ? opt.extra : '').flatMap((f) => {
    try { return [fs.readFileSync(path.resolve(f), 'utf8')]; } catch { return []; }
  });
}

/** Jira texts are internal but no pages: with KB_JIRA_LOG set they are collected for `check --extra`. */
function logJira(text) {
  if (!process.env.KB_JIRA_LOG) return;
  try { fs.appendFileSync(path.resolve(process.env.KB_JIRA_LOG), `${text}\n`); } catch { /* ignore */ }
}

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      opt[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else pos.push(argv[i]);
  }
  return { pos, opt };
}

export async function main(argv = process.argv.slice(2)) {
  const { pos, opt } = parseArgs(argv);
  const [cmd, ...rest] = pos;
  const root = opt.root ? path.resolve(opt.root) : findRoot();
  const kb = () => loadKnowledge(root);
  const out = (s) => process.stdout.write(`${s}\n`);
  switch (cmd) {
    case 'search': out(formatHits(search(kb(), rest.join(' '), { audience: opt.audience, scope: opt.scope || 'all', limit: Number(opt.limit) || 8 }))); break;
    case 'read': { const r = readEntry(kb(), rest.join(' ')); if (!r) { out(`Nicht gefunden: ${rest.join(' ')}`); process.exitCode = 1; } else out(r); break; }
    case 'define': out(formatDefs(define(kb(), rest.join(' ')))); break;
    case 'overview': out(overview(kb(), { audience: opt.audience, scope: opt.scope || 'all' })); break;
    case 'status': out(status(kb())); break;
    case 'check': {
      const k = kb();
      const { findings, guard } = checkRepo(k, { staged: !!opt.staged, extra: extraTexts(opt) });
      if (!k.config.private.dir) out('Hinweis: kein Sidecar gefunden – geprüft wird nur `visibility: intern` im öffentlichen Repo.');
      else out(`Prüfe gegen ${guard.fps.size} Sätze und ${guard.terms.length} sensible Begriffe aus dem Sidecar.`);
      for (const f of findings) out(`${f.file}:${f.line}: ${f.kind}${f.text ? ` – „${f.text.slice(0, 100)}“` : ''}`);
      out(findings.length ? `${findings.length} Fund(e).` : 'Keine internen Inhalte gefunden.');
      if (findings.length) process.exitCode = 1;
      break;
    }
    case 'scan': {
      const k = kb();
      const text = !rest[0] || rest[0] === '-' ? readStdin() : fs.readFileSync(path.resolve(rest[0]), 'utf8');
      const hits = findLeaks(text, fingerprints(k, { extra: extraTexts(opt) }));
      for (const h of hits) out(`${h.kind}: „${h.text.slice(0, 100)}“`);
      out(hits.length ? `${hits.length} Fund(e).` : 'Keine internen Inhalte gefunden.');
      if (hits.length) process.exitCode = 1;
      break;
    }
    case 'decisions': {
      out(formatDecisions(listDecisions(kb(), { status: opt.status, scope: opt.scope || 'all', query: rest.join(' ') || undefined })));
      break;
    }
    case 'decide': {
      const [scope, ...words] = rest;
      if (!scope || !words.length) { out(HELP); process.exitCode = 2; break; }
      const r = decide(kb(), scope, words.join(' '), { issues: typeof opt.issues === 'string' ? opt.issues : '' });
      out(`${r.id} angelegt in ${r.file}. Kontext, Entscheidung und Konsequenzen ausfüllen.`);
      break;
    }
    case 'terms': {
      const k = kb();
      if (opt.anchors) { const c = addTermAnchors(k); out(c.length ? c.join('\n') : 'Alle Begriffe haben schon Anker.'); }
      else if (opt['to-notes']) {
        const w = termsToNotes(k, typeof opt['to-notes'] === 'string' ? opt['to-notes'] : undefined, { from: typeof opt.from === 'string' ? opt.from : undefined });
        out(`${w.length} Begriffs-Notizen angelegt.`);
        const c = writeTermIndex(kb());
        if (c.length) out(`Übersicht erzeugt in: ${c.join(', ')}`);
      } else if (opt.index) { const c = writeTermIndex(k); out(c.length ? `Übersicht erneuert in: ${c.join(', ')}` : 'Keine Übersicht zu erneuern.'); }
      else out(formatTerms(k));
      break;
    }
    case 'term': {
      const [scope, ...words] = rest;
      if (!scope || !words.length) { out(HELP); process.exitCode = 2; break; }
      const file = createTerm(kb(), scope, words.join(' '), {
        definition: typeof opt.definition === 'string' ? opt.definition : '',
        aliases: asList(typeof opt.aliases === 'string' ? opt.aliases : ''), code: asList(typeof opt.code === 'string' ? opt.code : ''),
        avoid: asList(typeof opt.avoid === 'string' ? opt.avoid : ''),
      });
      out(`Angelegt: ${file}`);
      if (scope === 'public') { const c = writeTermIndex(kb()); if (c.length) out(`Übersicht erneuert in: ${c.join(', ')}`); }
      break;
    }
    case 'audit': { const f = audit(kb()); out(opt.json ? JSON.stringify(f, null, 2) : formatAudit(f)); break; }
    case 'changes': { const c = changes(kb(), { since: opt.since }); out(opt.json ? JSON.stringify(c, null, 2) : formatChanges(c)); break; }
    case 'report': {
      const r = await consolidationReport(kb(), { since: opt.since });
      if (opt.out) { fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true }); fs.writeFileSync(path.resolve(opt.out), r.text); out(`Bericht: ${opt.out} (${r.changes.commits.length} Commits, ${r.findings.length} Auffälligkeiten)`); }
      else out(r.text);
      break;
    }
    case 'state': {
      const k = kb();
      if (!k.config.private.dir) { out('Kein Sidecar gefunden.'); process.exitCode = 1; break; }
      const file = path.join(k.config.private.dir, 'consolidation', 'state.json');
      if (opt.set) {
        const commit = git(root, ['rev-parse', '--verify', '-q', `${opt.set}^{commit}`]).trim();
        if (!commit) { out(`Unbekannter Commit: ${opt.set}`); process.exitCode = 1; break; }
        mergeJson(file, (d) => { d.lastCommit = commit; d.lastRun = new Date().toISOString(); });
      }
      out(JSON.stringify(readState(k), null, 2));
      break;
    }
    case 'new': {
      const [scope, rel] = rest;
      if (!scope || !rel) { out(HELP); process.exitCode = 2; break; }
      out(`Angelegt: ${newPage(kb(), scope, rel, { title: opt.title, audience: opt.audience })}`);
      break;
    }
    case 'init': out(init(rest[0] || root, { name: opt.name, update: !!opt.update }).join('\n')); break;
    case 'init-sidecar': {
      if (!rest[0]) { out(HELP); process.exitCode = 2; break; }
      const w = initSidecar(rest[0], { company: !!opt.company, project: typeof opt.project === 'string' ? opt.project : undefined });
      out(w.length ? w.map((f) => `angelegt ${f}`).join('\n') : 'Nichts zu tun, alles vorhanden.');
      break;
    }
    case 'jira': {
      const k = kb();
      const jc = jiraConfig(k);
      if (!jiraReady(jc)) { out(`Jira nicht eingerichtet: Projektschlüssel (${jc.keys.join(', ') || 'keine'}) in knowledge.json, JIRA_URL und JIRA_TOKEN (Cloud zusätzlich JIRA_USER) nötig.`); process.exitCode = 1; break; }
      try {
        if (opt.since || !rest.length) { const t = formatJiraList(await jiraSearch(jc, { since: typeof opt.since === 'string' ? opt.since : '-8d' })); logJira(t); out(t); }
        for (const key of rest) { const t = await jiraIssue(jc, key); logJira(t); out(t); }
      } catch (e) { out(e.message); process.exitCode = 1; }
      break;
    }
    case 'vault': {
      if (!rest[0]) { out(HELP); process.exitCode = 2; break; }
      const log = initVault(rest[0], { update: !!opt.update, register: !!opt.register });
      out(log.length ? log.join('\n') : 'Nichts zu tun, alles vorhanden.');
      out('Module (nur die, die du lesen darfst) als Unterordner klonen, z. B. hbt/ und <projekt>/. Anleitung: README.md im Vault.');
      break;
    }
    case 'mcp': startMcp(root); break;
    case 'hook': {
      const mode = rest[0];
      let input = {};
      try { input = JSON.parse(readStdin() || '{}'); } catch { /* ignore */ }
      try {
        const k = kb();
        if (mode === 'session') out(sessionContext(k));
        else if (mode === 'prompt') { const t = hookPrompt(k, input); if (t) out(t); }
        else if (mode === 'guard') { const d = guardDecision(k, input); if (d) out(JSON.stringify(d)); }
        else { out(HELP); process.exitCode = 2; }
      } catch (e) {
        // never break the agent session because of the knowledge base
        process.stderr.write(`kb hook ${mode}: ${e.message}\n`);
      }
      break;
    }
    case 'version': out(VERSION); break;
    default: out(HELP); if (cmd && cmd !== 'help') process.exitCode = 2;
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
