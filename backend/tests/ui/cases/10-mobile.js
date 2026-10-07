const assert = require('node:assert/strict');
const { uiTest, loginViaApi, openPage } = require('../helpers');

module.exports = function register() {
  uiTest('GD-13 mobile: dieu huong, noi dung va hop thoai nam gon trong man hinh', async page => {
    await loginViaApi(page, 'admin');
    await openPage(page, 'projects');

    const layout = await page.evaluate(() => {
      const nav = document.querySelector('aside');
      const main = document.querySelector('main');
      const nr = nav.getBoundingClientRect();
      const mr = main.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        navBottomGap: Math.abs(window.innerHeight - nr.bottom),
        navWithinViewport: nr.left >= 0 && nr.right <= window.innerWidth + 1,
        mainWithinViewport: mr.left >= 0 && mr.right <= window.innerWidth + 1
      };
    });
    assert.equal(layout.viewportWidth, 390);
    assert.ok(layout.documentWidth <= layout.viewportWidth + 1, 'Trang bi tran ngang');
    assert.ok(layout.navBottomGap <= 1 && layout.navWithinViewport, 'Thanh dieu huong mobile khong bam day/man hinh');
    assert.ok(layout.mainWithinViewport, 'Noi dung chinh vuot khoi man hinh');

    await page.click('#newProjectButton');
    await page.waitForSelector('#modal.show');
    const modal = await page.locator('#modal .modalbox').boundingBox();
    assert.ok(modal, 'Khong mo duoc hop thoai them cong trinh');
    assert.ok(modal.x >= 0 && modal.y >= 0, 'Hop thoai nam ngoai canh tren/trai');
    assert.ok(modal.x + modal.width <= 391, 'Hop thoai tran ngang');
    assert.ok(modal.y + modal.height <= 845, 'Hop thoai tran doc');
    assert.deepEqual(page.__console, [], 'Co loi console tren giao dien mobile');
  }, { viewport: { width: 390, height: 844 } });

  uiTest('GD-22 mobile: bang danh sach hien thanh the, nut thao tac nam trong man hinh khong can cuon ngang', async page => {
    await loginViaApi(page, 'admin');
    await openPage(page, 'projects');
    // Background project refresh can replace the table between separate await calls.
    // Capture the existing table and its layout in one browser turn; keep all assertions below.
    const sample = await page.waitForFunction(() => {
      const t = document.querySelector('#projectsTable table.mcards');
      const tr = t?.querySelector('tbody tr');
      if (!tr) return null;
      const btn = tr.querySelector('td.mc-actions button');
      const b = btn && btn.getBoundingClientRect();
      return {
        theadHidden: getComputedStyle(t.querySelector('thead') || t).display === 'none',
        rowBlock: getComputedStyle(tr).display,
        label: tr.querySelector('td[data-label]')?.getAttribute('data-label'),
        btnInView: !!b && b.left >= 0 && b.right <= window.innerWidth + 1,
        docWidth: document.documentElement.scrollWidth
      };
    });
    const r = await sample.jsonValue();
    await sample.dispose();
    assert.ok(r.theadHidden, 'tieu de bang phai an (nhan nam trong tung the)');
    assert.equal(r.rowBlock, 'block', 'moi dong phai hien thanh the');
    assert.ok(r.label, 'o phai co nhan cot');
    assert.ok(r.btnInView, 'nut thao tac phai nam trong man hinh, khong phai cuon ngang');
    assert.ok(r.docWidth <= 391, 'trang khong duoc tran ngang');
    assert.deepEqual(page.__console, [], 'Co loi console');
  }, { viewport: { width: 390, height: 844 } });

  uiTest('GD-23 PC: bang van giu dang bang (the chi ap dung tren dien thoai)', async page => {
    await loginViaApi(page, 'admin');
    await openPage(page, 'projects');
    await page.waitForSelector('#projectsTable table tbody tr');
    const d = await page.evaluate(() => getComputedStyle(document.querySelector('#projectsTable tbody tr')).display);
    assert.equal(d, 'table-row');
  });
};
