// Run: node --test tools/knowledge/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as kbm from '../kb.mjs';

const KB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'kb.mjs');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
  const repo = path.join(base, 'demo');
  const side = path.join(base, 'demo-knowledge');
  const w = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  w(repo, 'knowledge.json', JSON.stringify({ name: 'demo', sources: [{ glob: 'docs/**/*.md', audience: ['tech'] }, { glob: '*.md' }] }));
  w(repo, 'README.md', '# Demo\n\nEine App zur Verwaltung von Beraterprofilen.\n');
  w(repo, 'docs/arc42/05-bausteine.md', '# Bausteine\n\nÜberblick.\n\n## Edge\n\nDie Edge prüft das Token und setzt Identitäts-Header.\n\n## Skill-Suche\n\nDie Skillsuche ignoriert Groß- und Kleinschreibung.\n\n```\n## kein Abschnitt\n```\n');
  w(repo, 'docs/arc42/12-glossar.md', '# Glossar\n\n| Begriff | Bedeutung |\n|---|---|\n| **Berater** (`Consultant`) | Mitarbeiter mit Profil |\n| **Kürzel** (`initials`) | Eindeutige Kennung |\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  w(side, 'knowledge.json', JSON.stringify({ exclude: ['README.md'], sensitiveTerms: ['Projekt Nordlicht'] }));
  w(side, 'prozesse/angebot.md', '---\ntitle: Profil vor Angebot\nsummary: Wie Profile vor einem Angebot aktualisiert werden.\naudience: [business, domain]\nreviewed: 2020-01-01\n---\n\n# Profil vor Angebot\n\n## Kurz gesagt\n\nVor jeder Angebotsabgabe prüft der Vertrieb die Profile aller vorgeschlagenen Berater auf Aktualität.\n');
  w(side, 'glossar.md', '---\ntype: glossary\n---\n# Glossar\n\n| Begriff | Bedeutung |\n|---|---|\n| **Angebotsrunde** | Interner Abstimmungstermin vor der Abgabe |\n');
  return { base, repo, side };
}

test('frontmatter: inline and block lists, quotes', () => {
  const { meta, body } = kbm.parseFrontmatter('---\ntitle: "A: B"\naudience: [business, Technik]\ntags:\n  - x\n  - y\n---\n# T\n');
  assert.equal(meta.title, 'A: B');
  assert.deepEqual(meta.audience, ['business', 'Technik']);
  assert.deepEqual(meta.tags, ['x', 'y']);
  assert.equal(body, '# T\n');
  assert.deepEqual(kbm.normalizeAudience(meta.audience), ['business', 'tech']);
});

test('glob matching', () => {
  assert.ok(kbm.globToRegex('docs/**/*.md').test('docs/a/b/c.md'));
  assert.ok(kbm.globToRegex('docs/**/*.md').test('docs/c.md'));
  assert.ok(kbm.globToRegex('*/README.md').test('svc/README.MD'));
  assert.ok(!kbm.globToRegex('*.md').test('docs/c.md'));
});

test('loads public docs and sidecar, sections ignore code fences', () => {
  const { repo, side } = fixture();
  const kb = kbm.loadKnowledge(repo);
  assert.equal(kb.config.private.dir, side);
  const ids = kb.docs.map((d) => d.id);
  assert.ok(ids.includes('public:docs/arc42/05-bausteine.md'));
  assert.ok(ids.includes('intern:prozesse/angebot.md'));
  assert.ok(!ids.includes('intern:README.md'));
  const bs = kb.docs.find((d) => d.rel === 'docs/arc42/05-bausteine.md');
  assert.deepEqual(bs.sections.map((s) => s.heading), ['Bausteine', 'Edge', 'Skill-Suche']);
  assert.deepEqual(bs.audience, ['tech']);
  assert.equal(kb.docs.find((d) => d.rel === 'README.md').summary, 'Eine App zur Verwaltung von Beraterprofilen.');
});

test('search: German stems, compounds, scope label, audience filter', () => {
  const { repo } = fixture();
  const kb = kbm.loadKnowledge(repo);
  assert.equal(kbm.search(kb, 'Wer prüft Tokens?')[0].id, 'public:docs/arc42/05-bausteine.md#edge');
  assert.equal(kbm.search(kb, 'Skillsuche Großschreibung')[0].id, 'public:docs/arc42/05-bausteine.md#skill-suche');
  const offer = kbm.search(kb, 'Angebot Profile aktualisieren')[0];
  assert.equal(offer.scope, 'intern');
  assert.ok(kbm.search(kb, 'Angebot', { audience: 'tech' }).every((h) => h.scope !== 'intern'));
  assert.ok(kbm.search(kb, 'Angebot', { scope: 'public' }).every((h) => h.scope === 'public'));
});

test('read and define', () => {
  const { repo } = fixture();
  const kb = kbm.loadKnowledge(repo);
  assert.match(kbm.readEntry(kb, 'docs/arc42/05-bausteine.md#edge'), /Identitäts-Header/);
  assert.match(kbm.readEntry(kb, 'prozesse/angebot.md'), /INTERN/);
  assert.equal(kbm.define(kb, 'initials')[0].term, 'Kürzel');
  assert.equal(kbm.define(kb, 'angebotsrunde')[0].scope, 'intern');
});

test('guard blocks literal copies and sensitive terms, allows sidecar and normal text', () => {
  const { repo, side } = fixture();
  const kb = kbm.loadKnowledge(repo);
  const leak = 'Vor jeder Angebotsabgabe prüft der Vertrieb die Profile aller vorgeschlagenen Berater auf Aktualität.';
  const deny = kbm.guardDecision(kb, { tool_name: 'Write', tool_input: { file_path: path.join(repo, 'docs/x.md'), content: `Text\n${leak}` } });
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(kbm.guardDecision(kb, { tool_name: 'Bash', tool_input: { command: 'gh issue create --title "Projekt Nordlicht braucht X"' } }));
  assert.equal(kbm.guardDecision(kb, { tool_name: 'Bash', tool_input: { command: 'ls -la' } }), null);
  assert.equal(kbm.guardDecision(kb, { tool_name: 'Write', tool_input: { file_path: path.join(side, 'neu.md'), content: leak } }), null);
  assert.equal(kbm.guardDecision(kb, { tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'a.md'), new_string: 'Harmloser Text über Profile.' } }), null);
});

test('check finds leaks in tracked files and intern visibility', () => {
  const { repo } = fixture();
  fs.writeFileSync(path.join(repo, 'notes.md'), 'Siehe Projekt Nordlicht.\n');
  fs.writeFileSync(path.join(repo, 'secret.md'), '---\nvisibility: intern\n---\n# X\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  const { findings } = kbm.checkRepo(kbm.loadKnowledge(repo));
  assert.ok(findings.some((f) => f.file === 'notes.md' && f.kind === 'sensibler Begriff'));
  assert.ok(findings.some((f) => f.file === 'secret.md'));
  const staged = kbm.checkRepo(kbm.loadKnowledge(repo), { staged: true }).findings;
  assert.ok(staged.some((f) => f.file === 'notes.md'));
});

test('status flags stale pages; session context lists docs', () => {
  const { repo } = fixture();
  const kb = kbm.loadKnowledge(repo);
  assert.match(kbm.status(kb), /nicht geprüft: intern:prozesse\/angebot\.md/);
  assert.match(kbm.sessionContext(kb), /intern:prozesse\/angebot\.md/);
});

test('init scaffolds a fresh repository idempotently', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-init-'));
  execFileSync('git', ['init', '-q'], { cwd: base });
  kbm.init(base);
  kbm.init(base);
  const settings = JSON.parse(fs.readFileSync(path.join(base, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.ok(fs.existsSync(path.join(base, 'tools/knowledge/kb.mjs')));
  assert.ok(!fs.existsSync(path.join(base, 'tools/knowledge/test')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(base, '.mcp.json'), 'utf8')).mcpServers.knowledge.command, 'node');
  assert.equal((fs.readFileSync(path.join(base, 'AGENTS.md'), 'utf8').match(/knowledge-base -->/g) || []).length, 1);
  assert.equal((fs.readFileSync(path.join(base, '.gitignore'), 'utf8').match(/\.knowledge-intern/g) || []).length, 1);
});

function gitCommit(repo, msg) {
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', 'commit', '-q', '-m', msg], { cwd: repo });
}

test('audit finds dead links, paths, identifiers and ids', () => {
  const { repo, side } = fixture();
  fs.mkdirSync(path.join(repo, 'svc/src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'svc/src/ProfileService.java'), 'class ProfileService {}\n');
  fs.writeFileSync(path.join(repo, 'docs/x.md'), '---\ntitle: X\n---\n# X\n\nSiehe [weg](weg.md), [ok](arc42/05-bausteine.md), `svc/src/ProfileService.java`, `svc/src/Gone.java`.\n\n`ProfileService` und `GoneService`, `public:docs/nix.md`, `public:README.md`.\n\n```\n`InCodeBlock`\n```\n');
  fs.writeFileSync(path.join(side, 'prozesse/ref.md'), '# R\n\nTechnik: `svc/src/Gone.java` und `intern:prozesse/angebot.md#kurz-gesagt`.\n');
  gitCommit(repo, '#1 - start');
  const f = kbm.audit(kbm.loadKnowledge(repo));
  const has = (kind, detail, id) => f.some((x) => x.kind === kind && x.detail === detail && (!id || x.id === id));
  assert.ok(has('Link ins Leere', 'weg.md'));
  assert.ok(!f.some((x) => x.detail === 'arc42/05-bausteine.md'));
  assert.ok(has('Pfad existiert nicht mehr', 'svc/src/Gone.java', 'public:docs/x.md'));
  assert.ok(has('Pfad existiert nicht mehr', 'svc/src/Gone.java', 'intern:prozesse/ref.md'));
  assert.ok(!f.some((x) => x.detail === 'svc/src/ProfileService.java'));
  assert.ok(has('Bezeichner nicht im Code gefunden', 'GoneService'));
  assert.ok(!f.some((x) => x.detail === 'ProfileService' || x.detail === 'InCodeBlock'));
  assert.ok(has('Verweis auf unbekannte Wissens-id', 'public:docs/nix.md'));
  assert.ok(!f.some((x) => x.detail === 'public:README.md' || x.detail.startsWith('intern:prozesse/angebot')));
  assert.equal(f.find((x) => x.detail === 'weg.md').line, 6);
  assert.ok(has('Länger als 12 Monate nicht geprüft', '2020-01-01'));
});

test('changes since last run: commits, issues, deleted files, affected pages, state', async () => {
  const { repo, side } = fixture();
  fs.mkdirSync(path.join(repo, 'svc'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'svc/LegacyExporter.java'), 'class LegacyExporter {}\n');
  fs.writeFileSync(path.join(repo, 'docs/export.md'), '# Export\n\nDer `LegacyExporter` schreibt Dateien.\n');
  gitCommit(repo, '#1 - start');
  const first = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  fs.rmSync(path.join(repo, 'svc/LegacyExporter.java'));
  fs.writeFileSync(path.join(repo, 'svc/NewExporter.java'), 'class NewExporter {}\n');
  gitCommit(repo, '#7 - Export neu (#8)');
  kbm.main(['state', '--root', repo, '--set', first]);
  const kb = kbm.loadKnowledge(repo);
  assert.equal(kbm.readState(kb).lastCommit, first);
  assert.equal(JSON.parse(fs.readFileSync(path.join(side, 'consolidation/state.json'), 'utf8')).lastCommit, first);
  const c = kbm.changes(kb);
  assert.equal(c.commits.length, 1);
  assert.deepEqual(c.issues, ['#7', '#8']);
  assert.deepEqual(c.files.deleted, ['svc/LegacyExporter.java']);
  assert.deepEqual(c.files.added, ['svc/NewExporter.java']);
  assert.ok(c.affected.some((a) => a.id === 'public:docs/export.md' && a.hits[0].includes('gelöscht')));
  const r = await kbm.consolidationReport(kb);
  assert.match(r.text, /Bezeichner nicht im Code gefunden/);
  assert.match(r.text, /LegacyExporter/);
});

test('scan flags sidecar sentences in arbitrary text', () => {
  const { repo } = fixture();
  const kb = kbm.loadKnowledge(repo);
  const g = kbm.fingerprints(kb);
  assert.equal(kbm.findLeaks('Neutral: Doku zu Profilen aktualisiert.', g).length, 0);
  assert.equal(kbm.findLeaks('Vor jeder Angebotsabgabe prüft der Vertrieb die Profile aller vorgeschlagenen Berater auf Aktualität.', g).length, 1);
});

test('init-sidecar creates the skeleton with .github workflow', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-side-')), 'x-knowledge');
  kbm.initSidecar(dir);
  for (const f of ['README.md', 'knowledge.json', 'Begriffe/Beispielbegriff.md', '.gitignore', '.github/workflows/consolidate.yml', '.github/zizmor.yml']) {
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  }
  assert.ok(!fs.existsSync(path.join(dir, 'github')));
});

test('init-sidecar --update brings the workflow to this version and leaves the content alone; status names a stale one', () => {
  const { repo, side } = fixture();
  kbm.initSidecar(side);
  const wf = path.join(side, '.github/workflows/consolidate.yml');
  const page = path.join(side, 'prozesse/angebot.md');
  const own = fs.readFileSync(page, 'utf8');
  assert.deepEqual(kbm.staleSidecarFiles(side), []);
  fs.writeFileSync(wf, 'alt\n');
  assert.deepEqual(kbm.staleSidecarFiles(side), ['.github/workflows/consolidate.yml']);
  assert.match(kbm.status(kbm.loadKnowledge(repo)), /Workflow im Projekt-Sidecar veraltet \(\.github\/workflows\/consolidate\.yml\).*init-sidecar .*--update/);
  const json = fs.readFileSync(path.join(side, 'knowledge.json'), 'utf8');
  assert.deepEqual(kbm.initSidecar(side, { update: true }), [wf]);
  assert.equal(fs.readFileSync(page, 'utf8'), own, 'pages stay');
  assert.equal(fs.readFileSync(path.join(side, 'knowledge.json'), 'utf8'), json, 'knowledge.json stays');
  assert.deepEqual(kbm.staleSidecarFiles(side), []);
  assert.doesNotMatch(kbm.status(kbm.loadKnowledge(repo)), /veraltet/);
  fs.writeFileSync(wf, fs.readFileSync(wf, 'utf8').replace(/\n/g, '\r\n'));
  assert.deepEqual(kbm.staleSidecarFiles(side), [], 'CRLF from a Windows checkout is no difference');
});

test('MCP server: initialize, tools/list, tools/call, resources', async () => {
  const { repo } = fixture();
  const proc = spawn(process.execPath, [KB, 'mcp', '--root', repo], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });
  const lines = [];
  let buf = '';
  proc.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => proc.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search', arguments: { query: 'Angebot Profile' } } });
  send({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'kb://public/README.md' } });
  send({ jsonrpc: '2.0', id: 5, method: 'nope' });
  await new Promise((r) => { const t = setInterval(() => { if (lines.length >= 5) { clearInterval(t); r(); } }, 20); });
  proc.kill();
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  assert.equal(byId[1].result.serverInfo.name, 'knowledge');
  assert.deepEqual(byId[2].result.tools.map((t) => t.name), ['decisions', 'search', 'read', 'define', 'overview']);
  assert.match(byId[3].result.content[0].text, /\[INTERN\]/);
  assert.match(byId[4].result.contents[0].text, /Beraterprofilen/);
  assert.equal(byId[5].error.code, -32601);
});

test('domain language: avoid column, anchors, define redirect, audit', () => {
  const { repo, side } = fixture();
  fs.writeFileSync(path.join(repo, 'docs/arc42/12-glossar.md'),
    '# Glossar\n\n| Begriff | Bedeutung | Nicht verwenden |\n|---|---|---|\n| **Berater** (`Consultant`) | Mitarbeiter mit Profil | Mitarbeiter, Consultant-Profil |\n| **Kürzel** (`initials`, `GoneField`) | Eindeutige Kennung |\n');
  fs.writeFileSync(path.join(repo, 'docs/nutzung.md'),
    '# Nutzung\n\nJeder Mitarbeiterin gehört ein Profil (`MitarbeiterDto`, das Wort „Mitarbeiter“ und *Mitarbeiter* zählen nicht), siehe [Berater](arc42/12-glossar.md#begriff-berater) und [x](arc42/12-glossar.md#begriff-gibtsnicht).\n\n```\nMitarbeiter im Code-Block zählt nicht\n```\n');
  fs.mkdirSync(path.join(repo, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'ui/de.json'), '{\n  "title": "Alle Mitarbeiter",\n  "Mitarbeiter.Liste": "Berater"\n}\n');
  fs.writeFileSync(path.join(repo, 'Consultant.java'), 'class Consultant { String initials; }\n');
  const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'knowledge.json'), 'utf8'));
  cfg.terminology = { scan: ['ui/*.json'] };
  fs.writeFileSync(path.join(repo, 'knowledge.json'), JSON.stringify(cfg));
  fs.appendFileSync(path.join(side, 'glossar.md'), '| **Berater** | doppelt |\n');
  gitCommit(repo, '#1 - glossar');
  let kb = kbm.loadKnowledge(repo);
  const berater = kb.glossary.find((g) => g.term === 'Berater' && g.scope === 'public');
  assert.deepEqual(berater.avoid, ['Mitarbeiter', 'Consultant-Profil']);
  assert.deepEqual(berater.code, ['Consultant']);
  assert.equal(berater.anchor, 'begriff-berater');
  assert.equal(kbm.search(kb, 'Was ist ein Mitarbeiter?')[0].title, 'Berater');
  const d = kbm.define(kb, 'Mitarbeiter');
  assert.equal(d[0].term, 'Berater');
  assert.equal(d[0].instead, 'Mitarbeiter');
  assert.match(kbm.sessionContext(kb), /Berater \(Consultant; nicht: Mitarbeiter, Consultant-Profil\)/);
  const f = kbm.audit(kb);
  const kinds = (k) => f.filter((x) => x.kind === k);
  assert.deepEqual(kinds('Nicht in der Domänensprache').map((x) => `${x.rel}:${x.line} ${x.detail}`).sort(),
    ['docs/nutzung.md:3 Mitarbeiterin → Berater', 'ui/de.json:2 Mitarbeiter → Berater']);
  assert.deepEqual(kinds('Link auf unbekannten Begriff').map((x) => x.detail), ['arc42/12-glossar.md#begriff-gibtsnicht']);
  assert.ok(!kinds('Begriff in mehreren Quellen (der erste gilt)').some((x) => x.detail.startsWith('Berater'))); // public copy of a private term is intended
  assert.ok(f.some((x) => x.kind === 'Bezeichner nicht im Code gefunden' && x.detail === 'GoneField'));
  assert.ok(!f.some((x) => x.detail === 'Consultant' || x.detail === 'initials'));
  // anchors are added once and keep the table readable
  assert.ok(kinds('Begriff ohne Anker im Glossar (`kb.mjs terms --anchors`)').some((x) => x.detail.endsWith('#begriff-berater')));
  assert.equal(kbm.addTermAnchors(kb).length, 2);
  kb = kbm.loadKnowledge(repo);
  assert.equal(kbm.addTermAnchors(kb).length, 0);
  assert.deepEqual(kbm.audit(kb).filter((x) => /Begriff/.test(x.kind) && /Link|Anker/.test(x.kind)).map((x) => x.detail), ['arc42/12-glossar.md#begriff-gibtsnicht']);
  const text = fs.readFileSync(path.join(repo, 'docs/arc42/12-glossar.md'), 'utf8');
  assert.match(text, /\| <a id="begriff-berater"><\/a>\*\*Berater\*\* \(`Consultant`\) \| Mitarbeiter mit Profil \| Mitarbeiter, Consultant-Profil \|/);
  assert.equal(kb.glossary.find((g) => g.term === 'Berater').definition, 'Mitarbeiter mit Profil');
});

test('decisions: register, read, audit, decide, changes', () => {
  const { repo, side } = fixture();
  const adrs = [
    '# 9. Entscheidungen', '',
    '| ADR | Entscheidung | Status | Issues |', '|---|---|---|---|',
    '| [01](#adr-01-monorepo) | Monorepo | gilt | #1 |',
    '| [02](#adr-02-redis-für-auszüge) | Redis für Auszüge | gilt | #2 |',
    '| [05](#adr-05-gibts-nicht) | Gibts nicht | gilt | – |', '',
    '## ADR-01: Monorepo', '', '- **Status:** abgelöst durch ADR-04 (#1)', '- **Kontext:** viele Repos', '- **Entscheidung:** eins', '- **Konsequenzen:**', '  - weniger PRs', '',
    '## ADR-02: Redis für Auszüge', '', '- **Status:** übernommen; Ablösung vorgeschlagen (#2)', '- **Kontext:** alt', '- **Entscheidung:** Redis', '- **Konsequenzen:** Migration', '',
    '## ADR-04: Ohne Übersicht', '', '- **Status:** gilt (seit 2026-10-01, #7)', '- **Kontext:** x', '- **Entscheidung:** löst ADR-01 ab', '',
    'Siehe [ADR-02](#adr-02-redis-für-auszüge), [kaputt](#adr-09-nix) und ADR-I01.', '',
  ].join('\n');
  fs.writeFileSync(path.join(repo, 'docs/arc42/09-entscheidungen.md'), adrs);
  fs.mkdirSync(path.join(side, 'entscheidungen'), { recursive: true });
  fs.writeFileSync(path.join(side, 'entscheidungen/ADR-I01-angebote.md'), '---\nid: ADR-I01\ntitle: Profile vor Angeboten prüfen\ntype: decision\nstatus: gilt\nissues: ["#7"]\n---\n# ADR-I01: Profile vor Angeboten prüfen\n\n## Kontext\n\nVertrieb\n\n## Entscheidung\n\nPrüfen\n\n## Konsequenzen\n\n- Aufwand\n');
  gitCommit(repo, '#1 - start');
  fs.writeFileSync(path.join(repo, 'x.txt'), 'x');
  gitCommit(repo, '#7 - Prüfung eingebaut');
  let kb = kbm.loadKnowledge(repo);
  assert.deepEqual(kb.decisions.map((d) => `${d.id}:${d.base}`), ['ADR-01:abgelöst', 'ADR-02:übernommen', 'ADR-04:gilt', 'ADR-I01:gilt']);
  const a1 = kb.decisions[0];
  assert.equal(a1.supersededBy, 'ADR-04');
  assert.deepEqual(kb.decisions[2].supersedes, ['ADR-01']);
  assert.equal(kb.decisions[2].date, '2026-10-01');
  assert.equal(kb.decisions[3].scope, 'intern');
  assert.deepEqual(kbm.listDecisions(kb, { status: 'gilt' }).map((d) => d.id), ['ADR-04', 'ADR-I01']);
  assert.match(kbm.readEntry(kb, 'adr-2'), /Redis/);
  assert.match(kbm.readEntry(kb, 'ADR-I01'), /INTERN/);
  assert.equal(kbm.search(kb, 'Redis Auszüge')[0].kind, 'Entscheidung');
  assert.match(kbm.sessionContext(kb), /ADR-01 Monorepo \(abgelöst → ADR-04\)/);
  const f = kbm.audit(kb);
  const has = (kind, detail) => f.some((x) => x.kind === kind && (!detail || x.detail.startsWith(detail)));
  assert.ok(has('Status in der Übersicht weicht ab', 'ADR-01'));
  assert.ok(has('Status in der Übersicht weicht ab', 'ADR-02'));
  assert.ok(has('Entscheidung fehlt in der Übersicht', 'ADR-04'));
  assert.ok(has('Entscheidung unvollständig', 'ADR-04: konsequenzen'));
  assert.ok(has('Übersicht nennt unbekannte Entscheidung', 'ADR-05'));
  assert.ok(has('Lücke in der Nummerierung', 'ADR-03'));
  assert.ok(has('Link auf unbekannten Abschnitt', '#adr-09-nix'));
  assert.ok(has('Link auf unbekannten Abschnitt', '#adr-05-gibts-nicht'));
  assert.ok(!f.some((x) => x.detail === '#adr-02-redis-für-auszüge'));
  assert.ok(has('Öffentliche Seite verweist auf INTERN', 'ADR-I01'));
  const c = kbm.changes(kb, { since: 'HEAD~1' });
  assert.deepEqual(c.decisions.map((d) => d.id), ['ADR-04', 'ADR-I01']);
  // decide: next numbers, table row, section, intern page
  const pub = kbm.decide(kb, 'public', 'Domänensprache ist deutsch', { issues: '#9' });
  assert.equal(pub.id, 'ADR-05');
  const priv = kbm.decide(kb, 'intern', 'Neue Regel');
  assert.equal(priv.id, 'ADR-I02');
  kb = kbm.loadKnowledge(repo);
  const d5 = kb.decisions.find((d) => d.id === 'ADR-05' && d.title === 'Domänensprache ist deutsch');
  assert.ok(d5 && d5.base === 'vorgeschlagen');
  assert.ok(kbm.parseDecisionTable(kb.docs.find((d) => d.rel === 'docs/arc42/09-entscheidungen.md')).some((r) => r.anchor === 'adr-05-domänensprache-ist-deutsch'));
  assert.ok(kb.decisions.some((d) => d.id === 'ADR-I02' && d.title === 'Neue Regel'));
});


test('several sources: project sidecar + company knowledge, levels, prefixes, guard', () => {
  const { base, repo, side } = fixture();
  const hbt = path.join(base, 'hbt-knowledge');
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(hbt, rel)), { recursive: true }); fs.writeFileSync(path.join(hbt, rel), text); };
  w('knowledge.json', JSON.stringify({ level: 'company', id: 'hbt', label: 'HBT', sensitiveTerms: ['Großkunde Zeta'] }));
  w('glossar.md', '---\ntype: glossary\n---\n# Glossar\n\n| Begriff | Bedeutung | Nicht verwenden |\n|---|---|---|\n| **Berater** | HBT-weite Definition | Consultant |\n| **Angebotsrunde** | HBT-weit | |\n');
  w('prozesse/urlaub.md', '# Urlaub\n\n## Kurz gesagt\n\nUrlaub beantragen alle Mitarbeiter der HBT spätestens zwei Wochen vorher im Personalportal.\n');
  w('entscheidungen/ADR-HBT-01-urlaub.md', '---\nid: ADR-HBT-01\ntitle: Urlaub über das Portal\ntype: decision\nstatus: gilt\n---\n# ADR-HBT-01: Urlaub über das Portal\n\n## Kontext\n\nx\n\n## Entscheidung\n\ny\n\n## Konsequenzen\n\nz\n');
  // another project's sidecar next to it must NOT be picked up
  fs.mkdirSync(path.join(base, 'other-knowledge'), { recursive: true });
  fs.writeFileSync(path.join(base, 'other-knowledge/knowledge.json'), JSON.stringify({ level: 'project' }));
  fs.writeFileSync(path.join(base, 'other-knowledge/geheim.md'), '# Geheim\n\nFremdes Projektwissen.\n');
  let kb = kbm.loadKnowledge(repo);
  assert.deepEqual(kb.config.sources.map((s) => `${s.id}:${s.level}:${s.adrPrefix}`), ['intern:project:I', 'hbt:company:HBT']);
  assert.ok(!kb.docs.some((d) => d.rel === 'geheim.md'));
  assert.ok(kb.docs.some((d) => d.id === 'hbt:prozesse/urlaub.md' && d.tag === '[INTERN:HBT] '));
  assert.ok(kb.docs.some((d) => d.id === 'intern:prozesse/angebot.md' && d.tag === '[INTERN] '));
  assert.match(kbm.readEntry(kb, 'prozesse/urlaub.md'), /HBT-weit/);
  assert.match(kbm.readEntry(kb, 'ADR-HBT-01'), /Urlaub über das Portal/);
  assert.equal(kbm.search(kb, 'Urlaub beantragen Personalportal')[0].tag, '[INTERN:HBT] ');
  // the project's definition wins over the company definition, the company's avoid list still applies
  assert.match(kbm.domainLanguage(kb), /Berater \(Consultant\)/);
  fs.writeFileSync(path.join(repo, 'docs/firma.md'), '# Firma\n\nEin Consultant pflegt sein Profil.\n');
  assert.ok(kbm.audit(kbm.loadKnowledge(repo)).some((f) => f.rel === 'docs/firma.md' && f.detail === 'Consultant → Berater'));
  assert.ok(!/HBT-weite Definition/.test(kbm.domainLanguage(kb)));
  // decide numbers per source
  assert.equal(kbm.decide(kb, 'hbt', 'Zweite').id, 'ADR-HBT-02');
  assert.equal(kbm.decide(kb, 'intern', 'Projektregel').id, 'ADR-I01');
  kb = kbm.loadKnowledge(repo);
  assert.deepEqual(kb.decisions.map((d) => d.id), ['ADR-HBT-01', 'ADR-HBT-02', 'ADR-I01']);
  // guard: project content must not go into company knowledge, company content not into the public repo
  const projectSentence = 'Vor jeder Angebotsabgabe prüft der Vertrieb die Profile aller vorgeschlagenen Berater auf Aktualität.';
  const companySentence = 'Urlaub beantragen alle Mitarbeiter der HBT spätestens zwei Wochen vorher im Personalportal.';
  const write = (file, content) => kbm.guardDecision(kb, { tool_name: 'Write', tool_input: { file_path: file, content } });
  assert.ok(write(path.join(hbt, 'neu.md'), projectSentence));
  assert.equal(write(path.join(hbt, 'neu.md'), companySentence), null);
  assert.ok(write(path.join(repo, 'docs/neu.md'), companySentence));
  assert.ok(write(path.join(repo, 'docs/neu.md'), 'Das betrifft Großkunde Zeta.'));
  assert.equal(write(path.join(side, 'neu.md'), companySentence + projectSentence), null);
  // company knowledge must not build on project decisions
  w('entscheidungen/ADR-HBT-03-x.md', '---\nid: ADR-HBT-03\ntitle: X\ntype: decision\nstatus: gilt\n---\n# ADR-HBT-03: X\n\n## Kontext\n\nlöst ADR-I01 ab\n\n## Entscheidung\n\ny\n\n## Konsequenzen\n\nz\n');
  kb = kbm.loadKnowledge(repo);
  assert.ok(kbm.audit(kb).some((x) => x.kind === 'Verweis auf Entscheidung mit engerem Leserkreis' && x.detail === 'ADR-HBT-03 → ADR-I01'));
  // explicit configuration and KB_DISCOVER=0
  process.env.KB_DISCOVER = '0';
  try {
    assert.deepEqual(kbm.loadKnowledge(repo).config.sources.map((s) => s.id), ['intern']);
    process.env.KB_SOURCES = `hbt=${hbt}`;
    assert.deepEqual(kbm.loadKnowledge(repo).config.sources.map((s) => s.id), ['intern', 'hbt']);
  } finally { delete process.env.KB_DISCOVER; delete process.env.KB_SOURCES; }
});

test('init --update refreshes the vendored tool; company template is discovered; plugin files are valid', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-upd-'));
  const repo = path.join(base, 'proj');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  kbm.init(repo);
  const vendored = path.join(repo, 'tools/knowledge/kb.mjs');
  fs.writeFileSync(vendored, '// alt\n');
  assert.ok(kbm.init(repo, { update: true }).some((l) => l.includes('aktualisiert tools/knowledge/kb.mjs')));
  assert.ok(fs.readFileSync(vendored, 'utf8').includes(`VERSION = '${kbm.VERSION}'`));
  assert.ok(fs.existsSync(path.join(repo, '.claude/skills/knowledge/SKILL.md')));
  kbm.initSidecar(path.join(base, 'firma-knowledge'), { company: true });
  const kb = kbm.loadKnowledge(repo);
  assert.deepEqual(kb.config.sources.map((s) => `${s.id}:${s.level}`), ['hbt:company']);
  assert.equal(kb.config.private.dir, null);
  assert.ok(!kbm.audit(kb).some((f) => f.kind === 'Nicht in der Domänensprache'));
  const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const plugin = JSON.parse(fs.readFileSync(path.join(here, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(plugin.version, kbm.VERSION);
  const hooks = JSON.parse(fs.readFileSync(path.join(here, 'hooks/hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'PreToolUse']);
  assert.ok(fs.existsSync(path.join(here, 'skills/knowledge/SKILL.md')));
});

test('obsidian: wikilinks, aliases, tags, backlinks, term notes, link audit', () => {
  const { base, repo, side } = fixture();
  const hbt = path.join(base, 'hbt-knowledge');
  const w = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  w(hbt, 'knowledge.json', JSON.stringify({ level: 'company', id: 'hbt' }));
  w(hbt, 'Begriffe/Berater.md', '---\ntype: begriff\naliases: [Beraterin]\ncode: [Consultant]\nnicht-verwenden: [Mitarbeiter]\ntags: [begriff]\n---\n# Berater\n\nAngestellte der HBT, die Kunden beraten. Siehe [[Profil]].\n');
  w(hbt, 'Begriffe/Profil.md', '---\ntype: begriff\n---\n# Profil\n\nAlle Angaben eines [[Berater|Beraters]].\n');
  w(hbt, 'prozesse/geheim-verweis.md', '# X\n\nSiehe [[intern/prozesse/angebot]].\n');
  w(side, 'prozesse/ablauf.md', '# Ablauf\n\n## Schritte\n\nDie [[Beraterin]] prüft ihr [[Profil#Profil]] und [[hbt/Begriffe/Berater|ihn]] #vertrieb #prozess/angebot.\n\n- [[Gibtsnicht]]\n- [[Berater#Unbekannt]]\n- [[anderes-projekt/Seite]]\n- ![[bild.png]]\n- [[ablauf#Schritte]] und Issue #255\n\n```\n[[im Code]]\n```\n');
  w(side, 'bild.png', 'x');
  w(repo, 'docs/wiki.md', '# Wiki\n\nFalsch: [[Berater]]. Richtig: [Ablauf](arc42/05-bausteine.md).\n');
  gitCommit(repo, '#1 - x');
  const kb = kbm.loadKnowledge(repo);
  const ablauf = kb.docs.find((d) => d.id === 'intern:prozesse/ablauf.md');
  assert.deepEqual(ablauf.tags.sort(), ['prozess/angebot', 'vertrieb']);
  assert.deepEqual(ablauf.outgoing.map((d) => d.id).sort(), ['hbt:Begriffe/Berater.md', 'hbt:Begriffe/Profil.md']);
  const berater = kb.docs.find((d) => d.id === 'hbt:Begriffe/Berater.md');
  assert.ok(berater.backlinks.some((d) => d.id === 'intern:prozesse/ablauf.md'));
  assert.match(kbm.readEntry(kb, 'hbt:Begriffe/Berater.md'), /Rückverweise: .*Ablauf/);
  const g = kb.glossary.find((x) => x.term === 'Berater' && x.note);
  assert.deepEqual(g.aliases, ['Beraterin', 'Consultant']);
  assert.deepEqual(g.avoid, ['Mitarbeiter']);
  assert.equal(g.definition, 'Angestellte der HBT, die Kunden beraten. Siehe Profil.');
  assert.equal(kbm.define(kb, 'Mitarbeiter')[0].term, 'Berater');
  const f = kbm.audit(kb);
  const kinds = (k) => f.filter((x) => x.kind === k).map((x) => x.detail);
  assert.deepEqual(kinds('Verknüpfung ins Leere'), ['[[Gibtsnicht]]']);
  assert.deepEqual(kinds('Verknüpfung auf unbekannten Abschnitt'), ['[[Berater#Unbekannt]]']);
  assert.deepEqual(kinds('Verknüpfung in ein Modul, das hier fehlt (anderes-projekt)'), ['[[anderes-projekt/Seite]]']);
  assert.ok(kinds('Verknüpfung zu engerem Leserkreis').some((d) => d.startsWith('[[intern/prozesse/angebot]]')));
  assert.deepEqual(kinds('Obsidian-Verknüpfung im Code-Repo (normalen Markdown-Link verwenden)'), ['[[Berater]]']);
  assert.ok(!f.some((x) => /\[\[im Code\]\]|bild\.png|ablauf#Schritte/.test(x.detail)));
});

test('term notes: migrate glossary table, generated index, create term', () => {
  const { repo } = fixture();
  fs.writeFileSync(path.join(repo, 'docs/arc42/12-glossar.md'),
    '# Glossar\n\nEinleitung.\n\n| Begriff | Bedeutung | Nicht verwenden |\n|---|---|---|\n| <a id="begriff-berater"></a>**Berater** (`Consultant`) | Hat ein Profil, siehe [Kapitel 5](05-bausteine.md) | Mitarbeiter |\n| **Power.User / Power.Admin** | Rollen für [Berater](#begriff-berater) |\n\n## Offene Begriffe\n\n- „Skill“\n');
  fs.writeFileSync(path.join(repo, 'docs/nutzung.md'), '# Nutzung\n\nEin [Berater](arc42/12-glossar.md#begriff-berater) pflegt.\n');
  gitCommit(repo, '#1 - g');
  let kb = kbm.loadKnowledge(repo);
  assert.equal(kbm.termsToNotes(kb, 'docs/glossar').length, 2);
  kb = kbm.loadKnowledge(repo);
  kbm.writeTermIndex(kb);
  const note = fs.readFileSync(path.join(repo, 'docs/glossar/Berater.md'), 'utf8');
  assert.match(note, /type: begriff/);
  assert.match(note, /code: \["Consultant"\]/);
  assert.match(note, /nicht-verwenden: \["Mitarbeiter"\]/);
  assert.match(note, /\[Kapitel 5\]\(\.\.\/arc42\/05-bausteine\.md\)/);
  const roles = fs.readFileSync(path.join(repo, 'docs/glossar/Power.User - Power.Admin.md'), 'utf8');
  assert.match(roles, /title: "Power.User \/ Power.Admin"/);
  assert.match(roles, /\[Berater\]\(Berater\.md\)/);
  const index = fs.readFileSync(path.join(repo, 'docs/arc42/12-glossar.md'), 'utf8');
  assert.match(index, /\| \[Berater\]\(\.\.\/glossar\/Berater\.md\) \| Hat ein Profil, siehe \[Kapitel 5\]\(05-bausteine\.md\) \| `Consultant` \| Mitarbeiter \|/);
  assert.match(index, /\[Power\.User \/ Power\.Admin\]\(<\.\.\/glossar\/Power\.User - Power\.Admin\.md>\)/);
  assert.match(index, /## Offene Begriffe/);
  assert.match(fs.readFileSync(path.join(repo, 'docs/nutzung.md'), 'utf8'), /\[Berater\]\(glossar\/Berater\.md\)/);
  kb = kbm.loadKnowledge(repo);
  assert.equal(kb.glossary.filter((g) => g.scope === 'public').length, 2);
  assert.ok(kb.glossary.every((g) => g.scope !== 'public' || g.note));
  assert.equal(kbm.define(kb, 'Mitarbeiter')[0].term, 'Berater');
  const f = kbm.audit(kb);
  assert.ok(!f.some((x) => /Link|Verknüpfung|Domänensprache/.test(x.kind)), JSON.stringify(f.filter((x) => /Link|Verknüpfung|Domänensprache/.test(x.kind))));
  const created = kbm.createTerm(kb, 'intern', 'Angebotsfreigabe', { definition: 'Abstimmung vor Abgabe.', avoid: ['Pitch-Meeting'] });
  assert.ok(created.endsWith(path.join('Begriffe', 'Angebotsfreigabe.md')));
  assert.throws(() => kbm.createTerm(kbm.loadKnowledge(repo), 'public', 'Berater'), /gibt es schon/);
});


test('modular vault: settings, templates, modules by access, project module matching', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-vault-'));
  const vault = path.join(base, 'HBT-Wissen');
  kbm.initVault(vault);
  assert.ok(fs.existsSync(path.join(vault, '.obsidian/app.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(vault, '.obsidian/app.json'), 'utf8')).useMarkdownLinks, false);
  assert.ok(fs.existsSync(path.join(vault, '_vorlagen/Begriff.md')));
  kbm.initSidecar(path.join(vault, 'hbt'), { company: true });
  kbm.initSidecar(path.join(vault, 'demo'), { project: 'demo' });
  kbm.initSidecar(path.join(vault, 'fremd'), { project: 'fremd' });
  fs.writeFileSync(path.join(vault, 'demo/prozesse/x.md'), '# X\n\nSiehe [[hbt/Begriffe/Beispielbegriff|Begriff]] und [[Beispielbegriff]].\n');
  fs.writeFileSync(path.join(vault, 'hbt/y.md'), '# Y\n\nSiehe [[demo/prozesse/x]].\n');
  const repo = path.join(base, 'code', 'demo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'knowledge.json'), JSON.stringify({ name: 'demo' }));
  process.env.KB_VAULTS = vault;
  try {
    const kb = kbm.loadKnowledge(repo);
    assert.deepEqual(kb.config.sources.map((s) => `${s.id}:${s.module}`).sort(), ['hbt:hbt', 'intern:demo']);
    assert.ok(!kb.docs.some((d) => d.base === path.join(vault, 'fremd')));
    const x = kb.docs.find((d) => d.rel === 'prozesse/x.md');
    assert.equal(x.wikilinks[0].doc.id, 'hbt:Begriffe/Beispielbegriff.md');
    assert.equal(x.wikilinks[1].doc.id, 'intern:Begriffe/Beispielbegriff.md');
    const f = kbm.audit(kb);
    assert.ok(f.some((v) => v.kind === 'Verknüpfung zu engerem Leserkreis' && v.detail.startsWith('[[demo/prozesse/x]]')));
    assert.ok(!f.some((v) => /Verknüpfung (ins Leere|mehrdeutig)/.test(v.kind)), JSON.stringify(f));
  } finally { delete process.env.KB_VAULTS; }
});

test('term index markers only count on their own line', () => {
  const { repo } = fixture();
  fs.writeFileSync(path.join(repo, 'docs/doku.md'), '# Doku\n\nDie Übersicht steht zwischen `<!-- kb:begriffe -->` und `<!-- /kb:begriffe -->`.\n');
  fs.mkdirSync(path.join(repo, 'docs/glossar'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs/glossar/Berater.md'), '---\ntype: begriff\n---\n# Berater\n\nX.\n');
  fs.writeFileSync(path.join(repo, 'docs/index.md'), '# Index\n\n<!-- kb:begriffe -->\nalt\n<!-- /kb:begriffe -->\n\nRest\n');
  const changed = kbm.writeTermIndex(kbm.loadKnowledge(repo));
  assert.deepEqual(changed, ['public:docs/index.md']);
  assert.match(fs.readFileSync(path.join(repo, 'docs/index.md'), 'utf8'), /\[Berater\]\(\.\.\/docs\/glossar\/Berater\.md\)|\[Berater\]\(glossar\/Berater\.md\)/);
  assert.match(fs.readFileSync(path.join(repo, 'docs/index.md'), 'utf8'), /Rest/);
});


test('jira: keys from private config, issue refs, read-only client, report section', async () => {
  const http = await import('node:http');
  const { repo, side } = fixture();
  const cfg = JSON.parse(fs.readFileSync(path.join(side, 'knowledge.json'), 'utf8'));
  cfg.jira = { keys: ['PWR'] };
  fs.writeFileSync(path.join(side, 'knowledge.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(repo, 'docs/arc42/09-e.md'), '# E\n\n## ADR-01: Export neu\n\n- **Status:** gilt (PWR-12)\n- **Kontext:** x\n- **Entscheidung:** y\n- **Konsequenzen:** z\n');
  gitCommit(repo, '#1 - start');
  fs.writeFileSync(path.join(repo, 'y.txt'), 'y');
  gitCommit(repo, 'PWR-12 Export umgebaut, siehe ADR-01');
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/rest/api/2/search/jql')) { res.statusCode = 410; return res.end('{}'); }
    if (req.url.startsWith('/rest/api/2/search')) return res.end(JSON.stringify({ issues: [{ key: 'PWR-12', fields: { summary: 'Export umbauen', status: { name: 'Fertig' }, issuetype: { name: 'Story' } } }] }));
    if (req.url.startsWith('/rest/api/2/issue/PWR-12')) {
      return res.end(JSON.stringify({ fields: { summary: 'Export umbauen', status: { name: 'Fertig' }, issuetype: { name: 'Story' }, created: '2026-10-01T10:00:00Z',
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Weil der Vertrieb es braucht.' }] }] },
        comment: { comments: [{ created: '2026-10-02T10:00:00Z', author: { displayName: 'Erika Muster' }, body: 'Passt so.' }] },
        issuelinks: [{ type: { outward: 'blockiert' }, outwardIssue: { key: 'PWR-13', fields: { summary: 'Vorlage' } } }] } }));
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => server.listen(0, r));
  process.env.JIRA_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.JIRA_TOKEN = 'geheim';
  try {
    const kb = kbm.loadKnowledge(repo);
    assert.deepEqual(kb.decisions[0].issues, ['PWR-12']);
    const c = kbm.changes(kb, { since: 'HEAD~1' });
    assert.deepEqual(c.issues, ['PWR-12']);
    assert.deepEqual(c.decisions.map((d) => d.id), ['ADR-01']);
    assert.deepEqual(kbm.issueRefs('ADR-07 und PWR-3 und #4 und ABC-9'), ['#4', 'PWR-3']);
    const jc = kbm.jiraConfig(kb);
    assert.ok(kbm.jiraReady(jc));
    const text = await kbm.jiraIssue(jc, 'pwr-12');
    assert.match(text, /\[INTERN\] PWR-12: Export umbauen/);
    assert.match(text, /Weil der Vertrieb es braucht/);
    assert.match(text, /blockiert: PWR-13 Vorlage/);
    assert.ok(!text.includes('Erika'));
    await assert.rejects(kbm.jiraIssue(jc, 'ABC-1'), /keinem konfigurierten/);
    const r = await kbm.consolidationReport(kb);
    assert.match(r.text, /PWR-12 Export umbauen \(Story, Fertig\)/);
    assert.equal(seen[0].auth, 'Bearer geheim');
  } finally {
    delete process.env.JIRA_URL; delete process.env.JIRA_TOKEN;
    server.close();
  }
});


test('links with wrong letter case are reported (dead on GitHub)', () => {
  const { repo } = fixture();
  fs.writeFileSync(path.join(repo, 'docs/case.md'), '# C\n\n[ok](arc42/05-bausteine.md) [falsch](arc42/05-BAUSTEINE.md)\n');
  const f = kbm.audit(kbm.loadKnowledge(repo));
  const hit = f.find((x) => x.detail === 'arc42/05-BAUSTEINE.md');
  assert.ok(hit && /Link (ins Leere|mit falscher Groß-\/Kleinschreibung)/.test(hit.kind));
  assert.ok(!f.some((x) => x.detail === 'arc42/05-bausteine.md'));
});


test('an empty leftover sidecar folder is ignored in favour of the vault module', () => {
  const { base, repo, side } = fixture();
  fs.rmSync(side, { recursive: true });
  fs.mkdirSync(path.join(side, '.git'), { recursive: true });
  const vault = path.join(base, 'Vault');
  kbm.initSidecar(path.join(vault, 'demo'), { project: 'demo' });
  process.env.KB_VAULTS = vault;
  try {
    const kb = kbm.loadKnowledge(repo);
    assert.deepEqual(kb.config.sources.map((s) => `${s.id}:${s.dir}`), [`intern:${path.join(vault, 'demo')}`]);
  } finally { delete process.env.KB_VAULTS; }
});

const LEAK = 'Vor jeder Angebotsabgabe prüft der Vertrieb die Profile aller vorgeschlagenen Berater auf Aktualität.';

test('leak check: only committed public text counts as public, a staged copy in Markdown is still found', () => {
  const { repo } = fixture();
  gitCommit(repo, '#1 - base');
  fs.writeFileSync(path.join(repo, 'docs/neu.md'), `# Neu\n\n${LEAK}\n`);
  fs.writeFileSync(path.join(repo, 'code.js'), `// ${LEAK}\n`);
  execFileSync('git', ['add', '-A'], { cwd: repo });
  const staged = kbm.checkRepo(kbm.loadKnowledge(repo), { staged: true }).findings;
  assert.ok(staged.some((f) => f.file === 'docs/neu.md'), JSON.stringify(staged));
  assert.ok(staged.some((f) => f.file === 'code.js'));
  // once committed (published on purpose), the sentence is public and no longer a leak
  gitCommit(repo, '#2 - veröffentlicht');
  assert.equal(kbm.findLeaks(LEAK, kbm.fingerprints(kbm.loadKnowledge(repo))).length, 0);
});

test('a project sidecar from a shared configuration only loads for its own project', () => {
  const { base, repo } = fixture();
  const cfgHome = path.join(base, 'cfg');
  const foreign = path.join(base, 'fremd');
  const own = path.join(base, 'eigen');
  for (const [dir, project] of [[foreign, 'anderes'], [own, 'demo']]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'knowledge.json'), JSON.stringify({ level: 'project', project }));
    fs.writeFileSync(path.join(dir, `${project}.md`), `# ${project}\n\nWissen von ${project}.\n`);
  }
  fs.mkdirSync(path.join(cfgHome, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(cfgHome, 'knowledge', 'sources.json'), JSON.stringify({ sources: [{ dir: foreign }, { dir: own }] }));
  fs.rmSync(path.join(base, 'demo-knowledge'), { recursive: true, force: true });
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = cfgHome;
  process.env.KB_DISCOVER = '0';
  try {
    assert.deepEqual(kbm.loadKnowledge(repo).config.sources.map((s) => s.dir), [own]);
    process.env.KB_SOURCES = foreign;
    assert.ok(!kbm.loadKnowledge(repo).config.sources.some((s) => s.dir === foreign));
    // named directly, e.g. a KB_PRIVATE_DIR set for the whole machine: another project's sidecar still stays out
    delete process.env.KB_SOURCES;
    process.env.KB_PRIVATE_DIR = foreign;
    assert.ok(!kbm.loadKnowledge(repo).config.sources.some((s) => s.dir === foreign));
    fs.writeFileSync(path.join(repo, '.knowledge.local.json'), JSON.stringify({ privateDir: foreign }));
    delete process.env.KB_PRIVATE_DIR;
    assert.ok(!kbm.loadKnowledge(repo).config.sources.some((s) => s.dir === foreign));
    fs.rmSync(path.join(repo, '.knowledge.local.json'));
    // a sidecar without `project` named directly still loads
    fs.writeFileSync(path.join(foreign, 'knowledge.json'), JSON.stringify({ level: 'project' }));
    process.env.KB_PRIVATE_DIR = foreign;
    assert.ok(kbm.loadKnowledge(repo).config.sources.some((s) => s.dir === foreign));
  } finally {
    if (old === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = old;
    delete process.env.KB_DISCOVER; delete process.env.KB_SOURCES; delete process.env.KB_PRIVATE_DIR;
  }
});

test('guard: commit -a, add in the same command and push are checked too', () => {
  const { repo } = fixture();
  fs.writeFileSync(path.join(repo, 'code.js'), 'x\n');
  gitCommit(repo, '#1 - base');
  const kb = kbm.loadKnowledge(repo);
  const bash = (command) => kbm.guardDecision(kb, { tool_name: 'Bash', tool_input: { command } });
  fs.appendFileSync(path.join(repo, 'code.js'), `// ${LEAK}\n`);
  assert.equal(bash('git commit -m x'), null); // nothing staged
  assert.ok(bash('git commit -am x'));
  assert.ok(bash('git commit --all -m x'));
  execFileSync('git', ['checkout', '--', 'code.js'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'neu.js'), `// ${LEAK}\n`);
  assert.ok(bash('git add -A && git commit -m x'));
  assert.ok(kbm.guardDecision(kb, { tool_name: 'PowerShell', tool_input: { command: 'git add -A; git commit -m x' } }));
  gitCommit(repo, '#2 - lokal');
  assert.ok(bash('git push'), 'unpushed commits are scanned');
});

test('guard: a leak committed locally into Markdown is still found on push, until the remote has it', () => {
  const { base, repo } = fixture();
  gitCommit(repo, '#1 - base');
  const remote = path.join(base, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  execFileSync('git', ['push', '-q', '-u', 'origin', 'HEAD:refs/heads/main'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'docs/neu.md'), `# Neu\n\n${LEAK}\n`);
  gitCommit(repo, '#2 - lokal');
  const push = () => kbm.guardDecision(kbm.loadKnowledge(repo), { tool_name: 'Bash', tool_input: { command: 'git push' } });
  assert.ok(push(), 'a local commit must not make the sentence public');
  assert.ok(kbm.checkRepo(kbm.loadKnowledge(repo)).findings.some((f) => f.file === 'docs/neu.md'));
  execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: repo });
  assert.equal(push(), null, 'published on purpose: no longer a leak');
});

test('UTF-16 files (PowerShell 5 `echo >`), which git takes for binary, are checked too', () => {
  const { base, repo } = fixture();
  const u16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  assert.equal(kbm.decodeText(u16('Grüße\r\n')), 'Grüße\r\n');
  assert.equal(kbm.decodeText(Buffer.from('Grüße', 'utf16le')), 'Grüße', 'without BOM');
  assert.equal(kbm.decodeText(Buffer.from('Grüße', 'utf16le').swap16()), 'Grüße', 'big endian');
  assert.equal(kbm.decodeText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])), null, 'a real binary');
  gitCommit(repo, '#1 - base');
  const remote = path.join(base, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  execFileSync('git', ['push', '-q', '-u', 'origin', 'HEAD:refs/heads/main'], { cwd: repo });
  const kb = kbm.loadKnowledge(repo);
  const bash = (command) => kbm.guardDecision(kb, { tool_name: 'Bash', tool_input: { command } });
  const file = path.join(repo, 'docs/ps.md');
  fs.writeFileSync(file, u16(`# PS\r\n\r\n${LEAK}\r\n`));
  assert.ok(bash('git add docs/ps.md && git commit -m x'), 'new file, add in the same command');
  execFileSync('git', ['add', 'docs/ps.md'], { cwd: repo });
  assert.ok(bash('git commit -m x'), 'staged');
  assert.ok(kbm.checkRepo(kbm.loadKnowledge(repo), { staged: true }).findings.some((f) => f.file === 'docs/ps.md' && f.line === 3));
  gitCommit(repo, '#2 - lokal');
  assert.ok(bash('git push'), 'unpushed');
  assert.ok(kbm.checkRepo(kbm.loadKnowledge(repo)).findings.some((f) => f.file === 'docs/ps.md'), 'full check');
  execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: repo });
  fs.writeFileSync(file, u16(`# PS\r\n`));
  gitCommit(repo, '#3 - weg');
  execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: repo });
  fs.writeFileSync(file, u16(`# PS\r\n\r\n${LEAK}\r\n`));
  assert.ok(bash('git commit -am x'), 'tracked file changed, commit -a');
});

test('extra internal texts (e.g. Jira) count as fingerprints for check and scan', () => {
  const { base, repo } = fixture();
  gitCommit(repo, '#1 - base');
  const jira = path.join(base, 'jira.md');
  fs.writeFileSync(jira, '- [INTERN] PWR-7 Die Bank verlangt bis Jahresende eine zweite Freigabe für jeden Export\n');
  const text = 'Die Bank verlangt bis Jahresende eine zweite Freigabe für jeden Export';
  const kb = kbm.loadKnowledge(repo);
  assert.equal(kbm.findLeaks(text, kbm.fingerprints(kb)).length, 0);
  assert.equal(kbm.findLeaks(text, kbm.fingerprints(kb, { extra: [fs.readFileSync(jira, 'utf8')] })).length, 1);
  const pr = path.join(base, 'pr.md');
  fs.writeFileSync(pr, `${text}\n`);
  let code = 0;
  try { execFileSync(process.execPath, [KB, '--root', repo, 'scan', pr, '--extra', jira], { stdio: 'ignore' }); } catch (e) { code = e.status; }
  assert.equal(code, 1);
});

test('term index keeps inline code and links, escapes pipes and cuts nothing off', () => {
  const dir = path.join(os.tmpdir(), 'kb-idx', 'docs', 'arc42');
  const long = 'sehr lang '.repeat(40).trim();
  const g = {
    term: 'Admin-Bereich', definition: 'gekürzt …', file: path.join(dir, '..', 'glossar', 'Admin-Bereich.md'),
    rawDefinition: `Die Pfade \`/admin/**\` der Services, a | b, siehe [Edge](Edge.md). ${long}\n\nZweiter Absatz.`,
  };
  const cell = kbm.termDefinitionCell(g, dir);
  assert.ok(cell.includes('`/admin/**`'));
  assert.ok(cell.includes('a \\| b'));
  assert.ok(cell.includes('[Edge](../glossar/Edge.md)'));
  assert.ok(cell.endsWith(long));
  assert.ok(!cell.includes('Zweiter Absatz'));
});

test('hints about code comments in the sidecar show in status and session context, not as pages', () => {
  const { repo, side } = fixture();
  fs.mkdirSync(path.join(side, 'consolidation'), { recursive: true });
  fs.writeFileSync(path.join(side, kbm.HINTS_FILE), '# Hinweise zum Code\n\n- `svc/Foo.java:42`: Kommentar nennt `BarClient`. Vorschlag: `BazClient`\n- `svc/Bar.java:7`: toter Verweis auf #12\n');
  const kb = kbm.loadKnowledge(repo);
  assert.deepEqual(kbm.readHints(kb).length, 2);
  assert.ok(!kb.docs.some((d) => d.rel === kbm.HINTS_FILE));
  const st = kbm.status(kb);
  assert.match(st, /Offene Hinweise zum Code \(2/);
  assert.match(st, /svc\/Foo\.java:42/);
  const ctx = kbm.sessionContext(kb);
  assert.match(ctx, /Offene Hinweise zum Code \(2\)/);
  assert.match(ctx, /Small fixes along the way/);
  assert.match(ctx, /svc\/Bar\.java:7/);
  // a hint's text is no sidecar fingerprint: fixing the comment with the suggestion is no leak
  assert.equal(kbm.findLeaks('Kommentar nennt BarClient. Vorschlag: BazClient', kbm.fingerprints(kb)).length, 0);
});

test('weekly run template rejects every changed file except Markdown and knowledge.json', (t) => {
  const yml = fs.readFileSync(path.join(path.dirname(KB), 'templates/sidecar/github/workflows/consolidate.yml'), 'utf8');
  const line = yml.split('\n').find((l) => l.trim().startsWith('not_markdown=')).trim();
  const probe = (names) => {
    const script = `${line.replace(/git diff --cached --name-only[^|]*/, `printf '%s\\n' ${names.map((n) => `'${n}'`).join(' ')} `)}\nprintf '%s' "$not_markdown"`;
    // script on stdin, not `-c`: WSL's bash.exe (first `bash` on PATH in PowerShell) re-parses `-c` and expands `$not_markdown` early
    return execFileSync('bash', ['-s'], { input: script, encoding: 'utf8' });
  };
  try { execFileSync('bash', ['-c', 'true']); } catch { t.skip('no bash'); return; }
  assert.equal(probe(['docs/a.md', 'knowledge.json', 'pwr-x/README.md']), '');
  assert.equal(probe(['docs/a.md', 'pwr-x/src/Foo.java']), 'pwr-x/src/Foo.java');
  assert.equal(probe(['pwr-webclient/src/localization/de-DE.json', 'pom.xml']).split('\n').length, 2);
  // the template's own git command, run in a repository: renaming code to Markdown still names the code file
  const gitArgs = line.match(/git (diff --cached --name-only[^|]*)/)[1].trim().split(/\s+/);
  const { repo } = fixture();
  fs.writeFileSync(path.join(repo, 'Foo.java'), 'class Foo {}\n'.repeat(20));
  gitCommit(repo, '#1 - code');
  execFileSync('git', ['mv', 'Foo.java', 'Foo.md'], { cwd: repo });
  const names = execFileSync('git', gitArgs, { cwd: repo, encoding: 'utf8' }).trim().split('\n');
  assert.equal(probe(names), 'Foo.java');
  // the hints go into public code later: the run checks them against the sidecar and Jira, and the sidecar PR warns
  assert.match(yml, /kb scan "\$KB_PRIVATE_DIR\/consolidation\/hints\.md" --extra "\$RUN_DIR\/jira\.md"/);
  assert.match(yml, /printf '%s' "\$warn"/);
});
