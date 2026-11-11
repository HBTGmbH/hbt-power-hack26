// Picked up by react-scripts' dev server. Only active for `npm run start:local` (and start:mock / start:record).
const path = require('path');
const {createProxyMiddleware, responseInterceptor} = require('http-proxy-middleware');
const {buildInfo} = require('../compileBuildInfo');
const {serveFixtures, recordResponses} = require('../mock/mockApi');

// Same routing as ingress + pwr-edge-service: /api/<service>/** -> <service>/**
const SERVICES = {
    'pwr-profile-service': 9004,
    'pwr-skill-service': 9003,
    'pwr-report-service': 9005,
    'pwr-statistics-service': 9007,
    'pwr-view-profile-service': 9008,
};

module.exports = function (app) {
    if (process.env.REACT_APP_LOCAL_DEV !== 'true') {
        return;
    }
    // PWR_MOCK=true: fixtures instead of the services, PWR_MOCK=record: services, and their answers become fixtures
    // (mock/mockApi.js)
    const mock = (process.env.PWR_MOCK || '').trim();
    // REACT_APP_LOCAL_USER=<initials>: a user without admin role (#350); the headers the edge sets from the token, so
    // the services check like in production. Without, no headers: a call not through the edge, which may do everything.
    const localUser = (process.env.REACT_APP_LOCAL_USER || '').trim();
    const missing = [];
    // Lets a script (skill ui-screenshot) tell which mode and user a running dev server has
    app.get('/__mock/status', (req, res) => res.json({mode: {true: 'mock', record: 'record'}[mock] || 'live', user: localUser}));
    app.get('/__mock/missing', (req, res) => res.json(missing));
    app.delete('/__mock/missing', (req, res) => {
        missing.length = 0;
        res.status(204).end();
    });
    app.get('/config.js', (req, res) => res.sendFile(path.resolve(__dirname, '../config.local.js')));
    // The image gets build_info.json from the CI build; locally it describes the working copy at the start of the dev
    // server, like the commit in the bundle (withCommit.js), so a local commit doesn't announce a new version (#247)
    const info = buildInfo();
    app.get('/build_info.json', (req, res) => res.json(info));
    if (mock === 'true') {
        serveFixtures(app, missing);
        return;
    }
    // The edge itself only publishes its app info, under its own prefix (management.endpoints.web.base-path)
    app.use('/api/pwr-edge-service', createProxyMiddleware({
        target: 'http://localhost:9000',
        pathRewrite: {'^/api': ''},
    }));
    const userHeaders = localUser
        ? {'X-Pwr-User-Login': localUser + '@localhost', 'X-Pwr-User-Initials': localUser, 'X-Pwr-User-Admin': 'false'}
        : {};
    Object.entries(SERVICES).forEach(([service, port]) => {
        const target = `http://localhost:${port}`;
        app.use(`/api/${service}`, mock === 'record'
            ? recordResponses(createProxyMiddleware, responseInterceptor, target, service, userHeaders)
            : createProxyMiddleware({
                target,
                pathRewrite: {[`^/api/${service}`]: ''},
                headers: userHeaders,
            }));
    });
};
