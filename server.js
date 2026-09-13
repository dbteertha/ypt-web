import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT || 3000);
const YPT_BASE = 'https://pi.tgclab.com';
const COOKIE = 'ypt_session';

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1_000_000) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionCookie(jwt) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(jwt)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`;
}
function clearCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}
async function yptFetch(endpoint, { method = 'GET', body, jwt } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip', 'User-Agent': 'Dart/3.11 (dart:io)' };
  if (jwt) headers.authorization = `JWT ${jwt}`;
  const r = await fetch(`${YPT_BASE}${endpoint}`, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: r.status, data };
}
function qp(url, key, fallback = '') { return url.searchParams.get(key) ?? fallback; }

async function handleApi(req, res, url) {
  if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, { googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
  if (url.pathname === '/api/auth/status' && req.method === 'GET') return json(res, 200, { authenticated: Boolean(cookies(req)[COOKIE]) });
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });

  if (url.pathname === '/api/auth/google-ypt' && req.method === 'POST') {
    const body = await readJson(req);
    const accessToken = String(body.accessToken || '');
    const providerId = String(body.providerId || '');
    const email = String(body.email || '');
    if (!accessToken || !/^g[^\s]+$/.test(providerId)) return json(res, 400, { error: 'Invalid Google credential payload.' });

    const meRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000)
    });
    if (!meRes.ok) return json(res, 401, { error: 'Google token verification failed.' });
    const me = await meRes.json();
    if (`g${me.sub}` !== providerId) return json(res, 401, { error: 'Google identity mismatch.' });

    const r = await yptFetch('/user/social/sign-up-jwt', {
      method: 'POST',
      body: { accessToken, providerId, email: email || me.email || '', loginProvider: 'Google', new: true, getx: true, version: 810046 }
    });
    if (r.status !== 200 || !r.data?.s || !r.data?.jwt) {
      return json(res, r.status === 200 ? 401 : r.status, { error: r.data?.c ? `YPT error ${r.data.c}` : 'YPT Google sign-in failed.', detail: r.data });
    }
    const safeUser = { ...r.data };
    delete safeUser.jwt;
    return json(res, 200, safeUser, { 'Set-Cookie': sessionCookie(r.data.jwt) });
  }

  if (url.pathname.startsWith('/api/ypt/')) {
    const jwt = cookies(req)[COOKIE];
    if (!jwt) return json(res, 401, { error: 'Not signed in.' });
    let r;
    if (url.pathname === '/api/ypt/reload-info' && req.method === 'POST') {
      const body = await readJson(req); r = await yptFetch('/user/v2/reload/info', { method: 'POST', body, jwt });
    } else if (url.pathname === '/api/ypt/my-groups' && req.method === 'GET') {
      r = await yptFetch('/group/groups/v2', { jwt });
    } else if (url.pathname === '/api/ypt/study-start' && req.method === 'POST') {
      const body = await readJson(req); r = await yptFetch('/study/start', { method: 'POST', body, jwt });
    } else if (url.pathname === '/api/ypt/study-stop' && req.method === 'POST') {
      const body = await readJson(req); r = await yptFetch('/study/stop', { method: 'POST', body, jwt });
    } else if (url.pathname === '/api/ypt/day-log' && req.method === 'GET') {
      r = await yptFetch(`/logs/day?date=${encodeURIComponent(qp(url,'date'))}`, { jwt });
    } else if (url.pathname === '/api/ypt/group-members' && req.method === 'GET') {
      const groupId = qp(url,'groupId'); const countryId = qp(url,'countryId','0');
      r = await yptFetch(`/logs/group/members/v2?groupID=${encodeURIComponent(groupId)}&countryID=${encodeURIComponent(countryId)}&isLooking=true&version=810046`, { jwt });
    } else if (url.pathname === '/api/ypt/category-ranks' && req.method === 'GET') {
      const categoryId=qp(url,'categoryId','0'), countryId=qp(url,'countryId','0'), type=qp(url,'type','day'), page=qp(url,'page','1'), date=qp(url,'date');
      r = await yptFetch(`/logs/category/member/ranks?date=${encodeURIComponent(date)}&categoryID=${encodeURIComponent(categoryId)}&countryID=${encodeURIComponent(countryId)}&page=${encodeURIComponent(page)}&type=${encodeURIComponent(type)}`, { jwt });
    } else if (url.pathname === '/api/ypt/my-category-rank' && req.method === 'GET') {
      r = await yptFetch(`/logs/my-category-rank?category_id=${encodeURIComponent(qp(url,'categoryId','0'))}&country_id=${encodeURIComponent(qp(url,'countryId','0'))}`, { jwt });
    } else {
      return json(res, 404, { error: 'Unknown API route.' });
    }
    if (r.status === 401 || r.status === 403) return json(res, r.status, r.data, { 'Set-Cookie': clearCookie() });
    return json(res, r.status, r.data);
  }
  return false;
}
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!rel) rel = 'index.html';
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const ext = path.extname(file);
  const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
  fs.createReadStream(file).pipe(res);
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (handled !== false) return;
      return json(res, 404, { error: 'Not found' });
    }
    serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    json(res, 500, { error: 'Server error' });
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`YPT Web listening on ${PORT}`));
