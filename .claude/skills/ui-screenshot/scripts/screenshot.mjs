#!/usr/bin/env node
// Screenshots of webclient pages for UI reviews (skill ui-screenshot). Takes any UI path, so new routes need no change.
// Starts the dev server in the requested mode if none runs on the port, waits until the page has loaded and every
// request is answered, and saves one PNG per path. See ../SKILL.md for the options.
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const WEBCLIENT = path.join(REPO, 'pwr-webclient');
const {chromium} = createRequire(path.join(WEBCLIENT, 'package.json'))('playwright');

const HELP = `Usage: screenshot.mjs [options] <ui-path>...
  <ui-path>          path of the app, e.g. /app/mmu/profile or /admin/home/consultants (several allowed)
  --mode <m>         mock (default: fixtures, no backend), live (local services), record (live + store fixtures)
  --user <initials>  log in as this consultant without admin role (default: local admin)
  --out <dir>        output directory (default: pwr-webclient/screenshots)
  --name <name>      file name without .png (only with one path; default: slug of the path)
  --width <px>       viewport width (default 1440)
  --height <px>      viewport height (default 900)
  --full-page        the whole scrollable page instead of the viewport
  --selector <css>   only this element
  --wait-for <css>   also wait until this element is visible
  --date <iso>       fixed date of the browser clock (default 2026-06-01T10:00:00); "now" for the real one
  --port <n>         dev server port (default 3100, mock and live need different ones)
  --keep-server      leave a dev server this script started running (faster next time)`;

function parseArgs(argv) {
    const opts = {mode: 'mock', user: '', out: path.join(WEBCLIENT, 'screenshots'), width: 1440, height: 900,
        fullPage: false, date: '2026-06-01T10:00:00', port: 3100, keepServer: false, paths: []};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
            return argv[++i];
        };
        switch (arg) {
            case '--mode': opts.mode = value(); break;
            case '--user': opts.user = value().trim(); break;
            case '--out': opts.out = path.resolve(value()); break;
            case '--name': opts.name = value(); break;
            case '--width': opts.width = Number(value()); break;
            case '--height': opts.height = Number(value()); break;
            case '--full-page': opts.fullPage = true; break;
            case '--selector': opts.selector = value(); break;
            case '--wait-for': opts.waitFor = value(); break;
            case '--date': opts.date = value(); break;
            case '--port': opts.port = Number(value()); break;
            case '--keep-server': opts.keepServer = true; break;
            case '-h': case '--help': console.log(HELP); process.exit(0); break;
            default:
                if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
                opts.paths.push(arg.startsWith('/') ? arg : '/' + arg);
        }
    }
    if (!['mock', 'live', 'record'].includes(opts.mode)) throw new Error(`unknown mode ${opts.mode}`);
    if (opts.paths.length === 0) throw new Error('no UI path given');
    if (opts.name && opts.paths.length > 1) throw new Error('--name only works with one path');
    return opts;
}

async function serverStatus(base) {
    try {
        const response = await fetch(base + '/__mock/status');
        return response.ok ? await response.json() : {mode: 'unknown'};
    } catch {
        return null;
    }
}

async function ensureServer(opts) {
    const base = `http://localhost:${opts.port}`;
    const status = await serverStatus(base);
    const wanted = {mode: opts.mode, user: opts.user};
    if (status) {
        if (status.mode !== wanted.mode || status.user !== wanted.user) {
            throw new Error(`port ${opts.port} runs a dev server with ${JSON.stringify(status)}, wanted `
                + `${JSON.stringify(wanted)}: stop it or use another --port`);
        }
        console.error(`using the dev server on port ${opts.port}`);
        return {base, stop: () => {}};
    }
    const script = {mock: 'start:mock', live: 'start:local', record: 'start:record'}[opts.mode];
    console.error(`starting npm run ${script} on port ${opts.port} (first compile takes a minute) ...`);
    const log = fs.openSync(path.join(opts.out, `.dev-server-${opts.port}.log`), 'w');
    const child = spawn('npm', ['run', script], {
        cwd: WEBCLIENT, detached: true, stdio: ['ignore', log, log],
        env: {...process.env, PORT: String(opts.port), BROWSER: 'none', REACT_APP_LOCAL_USER: opts.user},
    });
    const stop = () => {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone already */ }
    };
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`dev server exited, see ${opts.out}/.dev-server-${opts.port}.log`);
        if (await serverStatus(base)) {
            // The status answers before webpack has compiled; the page itself waits for the bundle
            const page = await fetch(base + '/').catch(() => null);
            if (page && page.ok) {
                if (opts.keepServer) {
                    child.unref();
                    console.error(`dev server keeps running (pid group ${child.pid}): kill -- -${child.pid}`);
                    return {base, stop: () => {}};
                }
                return {base, stop};
            }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    stop();
    throw new Error('dev server did not start within 4 minutes');
}

function slug(uiPath) {
    return uiPath.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'root';
}

const NO_MOTION = `*, *::before, *::after { transition: none !important; animation: none !important;
    caret-color: transparent !important; }`;

async function shoot(context, base, uiPath, opts) {
    const page = await context.newPage();
    const problems = [];
    page.on('console', message => {
        const text = message.text().split('\n')[0];
        // React's and Material-UI's deprecation warnings of the dev build say nothing about the page
        // Failed requests are reported once, as HTTP lines below
        if (message.type() === 'error'
            && !/^Warning: |^Material-UI: .* renamed|^Failed to load resource|^Intercepted |^\{status: /.test(text)) {
            problems.push('console error: ' + text);
        }
    });
    page.on('pageerror', error => problems.push('page error: ' + error.message));
    page.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/api/') && response.status() >= 400) {
            problems.push(`HTTP ${response.status()} ${response.request().method()} ${url.pathname}${url.search}`);
        }
    });
    if (opts.date !== 'now') {
        await page.clock.setFixedTime(new Date(opts.date));
    }
    await fetch(base + '/__mock/missing', {method: 'DELETE'});
    await page.goto(base + uiPath, {waitUntil: 'networkidle', timeout: 90_000});
    await page.addStyleTag({content: NO_MOTION});
    // The app counts its requests and shows a bar while any runs (PwrRequestProgress); requests can chain
    await page.locator('.pwr-request-progress').waitFor({state: 'detached', timeout: 60_000});
    await page.waitForLoadState('networkidle');
    if (opts.waitFor) await page.locator(opts.waitFor).first().waitFor({state: 'visible', timeout: 30_000});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const file = path.join(opts.out, (opts.name || slug(uiPath)) + '.png');
    const target = opts.selector ? page.locator(opts.selector).first() : page;
    await target.screenshot({path: file, fullPage: opts.selector ? undefined : opts.fullPage});
    const missing = opts.mode === 'mock' ? await (await fetch(base + '/__mock/missing')).json() : [];
    const result = {path: uiPath, file, finalUrl: page.url().replace(base, ''), missingFixtures: missing, problems};
    await page.close();
    return result;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    fs.mkdirSync(opts.out, {recursive: true});
    const server = await ensureServer(opts);
    let browser;
    const results = [];
    try {
        browser = await chromium.launch();
        const context = await browser.newContext({
            viewport: {width: opts.width, height: opts.height}, deviceScaleFactor: 1, reducedMotion: 'reduce',
            locale: 'de-DE', timezoneId: 'Europe/Berlin',
        });
        for (const uiPath of opts.paths) {
            results.push(await shoot(context, server.base, uiPath, opts));
        }
    } finally {
        if (browser) await browser.close();
        server.stop();
    }
    console.log(JSON.stringify(results, null, 2));
}

main().catch(error => {
    console.error('screenshot failed: ' + error.message);
    process.exit(1);
});
