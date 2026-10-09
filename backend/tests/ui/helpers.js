// Vỏ chạy kiểm thử giao diện: dựng CSDL thử, chạy backend cổng 3103, mở Chrome đã cài trên máy.
// Mỗi ca dùng một browser context riêng (localStorage sạch, chặn service worker).
// Các ca nằm trong tests/ui/cases/*.js và được tests/ui/all.test.js nạp — chỉ một tiến trình,
// một CSDL, một máy chủ cho cả lượt chạy.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { createTestDb } = require('../lib/testDb');

const PORT = 3103;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_URL = process.env.UI_TEST_DB_URL || 'postgres://postgres:postgres@127.0.0.1:5435/vina_ui_claude';
const ART = path.join(__dirname, '..', 'ui-artifacts');

let db = null, server = null, browser = null;

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', () => reject(new Error('Cổng ' + port + ' đang bị chiếm. Có thể lần chạy trước chưa tắt, hoặc bộ regression/bản kiểm tra tay đang chạy. Tắt tiến trình node đang giữ cổng rồi chạy lại.')));
    s.once('listening', () => s.close(() => resolve()));
    s.listen(port, '127.0.0.1');
  });
}

async function startApp() {
  await assertPortFree(PORT);
  db = createTestDb(DB_URL);
  db.setupAll();
  server = db.startServer({ port: PORT });
  await db.waitHealth(BASE);
  try {
    // CHROME_PATH: chạy trên máy không có Google Chrome (Linux/CI) bằng Chromium chỉ định sẵn.
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true });
  } catch (e) {
    throw new Error('Không mở được Chrome (channel=chrome). Máy này cần Google Chrome; nếu không có, chạy "npx playwright install chromium" rồi bỏ tham số channel. Lỗi gốc: ' + e.message);
  }
}

async function stopApp() {
  if (browser) await browser.close();
  if (server) server.kill();
}

async function newPage(name, options = {}) {
  const context = await browser.newContext({
    baseURL: BASE,
    serviceWorkers: 'block',
    viewport: options.viewport || { width: 1440, height: 900 }
  });
  const page = await context.newPage();
  // 25s: khi chay cung luc voi bo regression + Docker, may tai nang nen 15s qua chat.
  page.setDefaultTimeout(25000);
  page.__dialogs = [];
  page.__console = [];
  page.on('console', m => { if (m.type() === 'error') page.__console.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => page.__console.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('dialog', async d => { page.__dialogs.push(d.message()); await d.accept(); });
  page.__name = name;
  await page.goto('/');
  return page;
}

// Khi một ca lỗi: lưu ảnh chụp + văn bản trang + nội dung hộp thoại để xem lại.
async function dump(page, name) {
  try {
    fs.mkdirSync(ART, { recursive: true });
    const slug = String(name).replace(/[^\w-]+/g, '_').slice(0, 60);
    await page.screenshot({ path: path.join(ART, slug + '.png'), fullPage: true });
    const text = await page.evaluate(() => document.body.innerText.slice(0, 20000));
    fs.writeFileSync(path.join(ART, slug + '.txt'),
      'HOP THOAI: ' + JSON.stringify(page.__dialogs)
      + '\nLOI CONSOLE: ' + JSON.stringify(page.__console || []) + '\n\n' + text, 'utf8');
  } catch (_) { /* lỗi khi chụp không được che lỗi thật của ca */ }
}

function uiTest(name, fn, options = {}) {
  test(name, {timeout:120000}, async () => {
    const page = await newPage(name, options);
    try {
      await fn(page);
    } catch (e) {
      await dump(page, name);
      throw e;
    } finally {
      await page.context().close();
    }
  });
}

// Chờ app hiện một hộp thoại có nội dung chứa `text` (hộp thoại do handler trong newPage ghi lại).
async function waitForDialog(page, text, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (page.__dialogs.some(m => m.includes(text))) return true;
    await page.waitForTimeout(200);
  }
  throw new Error('Không thấy hộp thoại chứa "' + text + '". Đã thấy: ' + JSON.stringify(page.__dialogs));
}

async function loginViaApi(page, who, password = 'demo') {
  const res = await page.request.post(BASE + '/api/auth/login', { data: { username: who, password } });
  assert.equal(res.status(), 200, 'Không đăng nhập được bằng API: ' + who);
  const data = await res.json();
  const auth = JSON.stringify({ token: data.token, user: data.user, loggedAt: new Date().toISOString() });
  // Nạp phiên TRƯỚC khi script của trang chạy: nếu đặt localStorage sau khi trang đã tải,
  // app đang ở trạng thái chưa đăng nhập có thể tự đăng xuất/tải lại và phá context đánh giá.
  // Gọi lại hàm này với người khác sẽ ghi đè phiên (script nạp sau thắng) → đổi tài khoản được.
  await page.addInitScript(a => { try { localStorage.setItem('vina_supervision_auth', a); } catch (_) {} }, auth);
  // Quyền theo công trình được tải bất đồng bộ và quyết định nav "Việc cần duyệt"/"Thùng rác"
  // ẩn hay hiện. Phải chờ lời gọi đó xong, nếu không ca kiểm thử sẽ đỏ ngẫu nhiên khi máy tải nặng.
  const quyenDaTai = page.waitForResponse(r => /my-permissions/.test(r.url()), { timeout: 10000 }).catch(() => null);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav button[data-page="projects"]', { state: 'visible' });
  await quyenDaTai;
  return data.user;
}

async function loginViaForm(page, who, password = 'demo') {
  await page.fill('#loginUsername', who);
  await page.fill('#loginPassword', password);
  await page.click('#loginButton');
}

// "Báo cáo ngày" (daily) không còn nút riêng trên thanh nav (gộp vào "Báo cáo", bản MVP-05) —
// vào qua nút "Báo cáo" rồi bấm tab trong trang "📝 Báo cáo ngày (cá nhân)".
async function openPage(page, dataPage) {
  if (dataPage === 'daily') {
    await page.click('nav button[data-page="reports"]');
    // Hai trang #reports và #daily đều có thanh tab giống nhau; chỉ bấm cái đang hiện.
    await page.click('#reports .report-hub-tab[data-tab="daily"]');
    await page.waitForSelector('#daily.page.active', { state: 'visible' });
    return;
  }
  await page.click(`nav button[data-page="${dataPage}"]`);
  await page.waitForSelector(`#${dataPage}.page.active`, { state: 'visible' });
}

async function navVisible(page, dataPage) {
  const navKey = dataPage === 'daily' ? 'reports' : dataPage;
  return page.locator(`nav button[data-page="${navKey}"]`).isVisible();
}

function apiAs(token) {
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const call = async (method, p, body) => {
    if (((method === 'PATCH' && /^\/(projects|daily-logs|documents|issues)\/[^/]+$/.test(p)) || (method === 'POST' && /^\/issues\/[^/]+\/(resolve|reopen)$/.test(p))) && body?.expected_row_version === undefined) {
      const snapshot = await call('GET', p.replace(/\/(resolve|reopen)$/, ''));
      if (snapshot.status === 200) body = { ...body, expected_row_version: snapshot.body.row_version };
    }
    const res = await fetch(BASE + '/api' + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : null };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    patch: (p, b) => call('PATCH', p, b),
    del: (p, b) => call('DELETE', p, b)
  };
}

async function tokenOf(who, password = 'demo') {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: who, password })
  });
  const data = await res.json();
  assert.ok(data.token, 'Không lấy được token của ' + who + ': ' + JSON.stringify(data));
  return data.token;
}

async function projectIdByContract(token, contractNo) {
  const list = (await apiAs(token).get('/projects')).body || [];
  const p = list.find(x => x.contract_no === contractNo);
  assert.ok(p, 'Không thấy công trình có số hợp đồng ' + contractNo);
  return p.id;
}

module.exports = { PORT, BASE, DB_URL, startApp, stopApp, uiTest, waitForDialog, loginViaApi, loginViaForm, openPage, navVisible, apiAs, tokenOf, projectIdByContract };
