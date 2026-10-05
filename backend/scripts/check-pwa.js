const { chromium } = require('playwright-core');

const baseUrl = (process.argv[2] || 'http://127.0.0.1:3004').replace(/\/$/, '');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.evaluate(async () => {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker không sẵn sàng sau 15 giây')), 15000))
      ]);
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });

    const worker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return { scope: registration.scope, controlled: !!navigator.serviceWorker.controller };
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');
    const manifest = await cdp.send('Page.getAppManifest');
    const installabilityResult = await cdp.send('Page.getInstallabilityErrors');
    const installabilityErrors = installabilityResult.installabilityErrors || installabilityResult || [];
    // Chrome headless chạy trong phiên tạm; lỗi này không xuất hiện khi người dùng mở Chrome bình thường.
    const blockingInstallabilityErrors = installabilityErrors.filter(error => error.errorId !== 'in-incognito');
    const result = {
      url: page.url(),
      title: await page.title(),
      manifestUrl: manifest.url,
      manifestErrors: manifest.errors || [],
      installabilityErrors,
      blockingInstallabilityErrors,
      serviceWorker: worker
    };

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    result.offlineShell = {
      title: await page.title(),
      loginVisible: await page.locator('#loginScreen').isVisible(),
      scriptCount: await page.locator('script[src]').count(),
      serverDataUnavailable: await page.evaluate(async () => {
        try { await fetch('/health'); return false; } catch (_) { return true; }
      })
    };
    console.log(JSON.stringify(result, null, 2));
    if (!worker.controlled || !manifest.url || result.manifestErrors.length || blockingInstallabilityErrors.length
      || result.offlineShell.title !== 'VINA-SUPERVISION' || !result.offlineShell.loginVisible
      || result.offlineShell.scriptCount < 2 || !result.offlineShell.serverDataUnavailable) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
