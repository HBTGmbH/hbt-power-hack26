// Mock mode of the dev server, for screenshots and UI reviews without a backend (skill ui-screenshot). Used by
// src/setupProxy.js:
//   PWR_MOCK=true    answers /api/<service>/** from the fixtures below, no service runs
//   PWR_MOCK=record  forwards to the local services like start:local and stores every successful GET, HEAD and POST
//                    as a fixture (POST for the requests that only read, like the consultant search)
// The fixtures are invented data only (recorded against the seed data): they end up in screenshots on GitHub.
//
// A fixture is mock/fixtures/<service>/<METHOD>/<path>.<ext>, e.g. pwr-profile-service/GET/profiles/mmu.json. The
// query string, if any, goes after a "~" (skill/byName~qualifier=Java.json). A request is answered by the first fixture
// that matches: with its query, without it, then with path segments replaced by "_" (profiles/_.json stands for every
// initials), fewest "_" first. The body of a request plays no part. JSON is served as is, other extensions by their
// content type, .empty as 204.
// Requests without a fixture get 404 and are listed at GET /__mock/missing (DELETE clears the list).
const fs = require('fs');
const path = require('path');

const FIXTURES = path.resolve(__dirname, 'fixtures');
const EXTENSIONS = ['.json', '.png', '.jpg', '.gif', '.svg', '.pdf', '.docx', '.txt', '.bin', '.empty'];
const RECORDED_METHODS = ['GET', 'HEAD', 'POST'];
const EXTENSION_OF = {
    'application/json': '.json', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
    'image/svg+xml': '.svg', 'application/pdf': '.pdf', 'text/plain': '.txt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

function queryPart(query) {
    return query ? '~' + query : '';
}

/** Candidate file paths without extension, most specific first */
function candidates(service, method, requestPath, query) {
    const segments = requestPath.split('/').filter(s => s.length > 0);
    const variants = [];
    // Every combination of segments replaced by "_", ordered by the number of "_"
    for (let mask = 0; mask < (1 << segments.length); mask++) {
        const replaced = segments.map((s, i) => (mask & (1 << i)) ? '_' : s);
        variants.push({count: replaced.filter(s => s === '_').length, rel: replaced.join('/') || '_root'});
    }
    variants.sort((a, b) => a.count - b.count);
    const base = path.join(FIXTURES, service, method);
    const result = [];
    variants.forEach(v => {
        if (query) {
            result.push(path.join(base, v.rel + queryPart(query)));
        }
        result.push(path.join(base, v.rel));
    });
    return result;
}

function findFixture(service, method, requestPath, query) {
    for (const candidate of candidates(service, method, requestPath, query)) {
        for (const ext of EXTENSIONS) {
            if (fs.existsSync(candidate + ext)) {
                return candidate + ext;
            }
        }
    }
    return null;
}

/** Same order as the browser sent them, so recording and lookup agree */
function queryOf(req) {
    const index = req.originalUrl.indexOf('?');
    return index < 0 ? '' : req.originalUrl.substring(index + 1);
}

/** The path below /api/<service>, decoded, without query */
function servicePath(req, service) {
    const pathname = req.originalUrl.split('?')[0];
    return decodeURIComponent(pathname.substring(('/api/' + service).length));
}

function serveFixtures(app, missing) {
    app.use('/api/:service', (req, res) => {
        const service = req.params.service;
        const requestPath = servicePath(req, service);
        const query = queryOf(req);
        const file = findFixture(service, req.method, requestPath, query);
        if (!file) {
            const entry = `${req.method} /api/${service}${requestPath}${query ? '?' + query : ''}`;
            if (!missing.includes(entry)) {
                missing.push(entry);
            }
            console.warn('[mock] no fixture: ' + entry);
            res.status(404).json({mock: 'no fixture', request: entry});
            return;
        }
        if (file.endsWith('.empty')) {
            res.status(204).end();
            return;
        }
        res.sendFile(file);
    });
}

function recordResponses(createProxyMiddleware, responseInterceptor, target, service, headers) {
    return createProxyMiddleware({
        target,
        pathRewrite: {[`^/api/${service}`]: ''},
        headers,
        selfHandleResponse: true,
        onProxyRes: responseInterceptor(async (buffer, proxyRes, req) => {
            const status = proxyRes.statusCode;
            if (RECORDED_METHODS.includes(req.method) && status >= 200 && status < 300) {
                const type = (proxyRes.headers['content-type'] || '').split(';')[0].trim();
                // Unknown types: the statistics ping says "plain/text"
                const ext = buffer.length === 0 ? '.empty' : EXTENSION_OF[type] || (type.includes('text') ? '.txt' : '.bin');
                const rel = servicePath(req, service).split('/').filter(s => s.length > 0).join('/') || '_root';
                const file = path.join(FIXTURES, service, req.method, rel + queryPart(queryOf(req)) + ext);
                fs.mkdirSync(path.dirname(file), {recursive: true});
                fs.writeFileSync(file, ext === '.json' ? JSON.stringify(JSON.parse(buffer.toString('utf8')), null, 2) + '\n' : buffer);
                console.log('[mock] recorded ' + path.relative(FIXTURES, file));
            }
            return buffer;
        }),
    });
}

module.exports = {serveFixtures, recordResponses, findFixture};
