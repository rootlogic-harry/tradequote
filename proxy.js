// TradeQuote CORS Proxy
// Run with: node proxy.js
// Then set API Base URL in app to: http://localhost:3001
const http = require('http');
const https = require('https');
const PORT = 3001;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const headers = { ...req.headers, host: 'api.anthropic.com' };
    delete headers['origin'];
    delete headers['referer'];
    const proxyReq = https.request({
      hostname: 'api.anthropic.com',
      path: req.url,
      method: req.method,
      headers
    }, proxyRes => {
      const rHeaders = { ...proxyRes.headers };
      rHeaders['access-control-allow-origin'] = '*';
      res.writeHead(proxyRes.statusCode, rHeaders);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', e => { res.writeHead(502); res.end(e.message); });
    proxyReq.write(body);
    proxyReq.end();
  });
}).listen(PORT, () => console.log(`TradeQuote CORS proxy running → http://localhost:${PORT}`));
