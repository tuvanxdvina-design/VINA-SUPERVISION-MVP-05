// Hai ca bảo vệ đợt tách index.html: mọi tệp JS khai báo trong trang phải nạp được,
// và trang phải nạp không lỗi console (bắt trường hợp câu lệnh top-level gọi hàm của file nạp sau).
const assert = require('node:assert/strict');
const { uiTest, loginViaApi, navVisible } = require('../helpers');

module.exports = function () {
  uiTest('HZ-03 mọi tệp JS khai báo trong index.html đều nạp được (không 404)', async (page) => {
    const srcs = await page.$$eval('script[src]', els => els.map(e => e.getAttribute('src')));
    assert.ok(srcs.length >= 2, 'trang phải khai báo ít nhất api.js và một tệp js/: ' + JSON.stringify(srcs));
    for (const src of srcs) {
      const res = await page.request.get(new URL(src, page.url()).href);
      assert.equal(res.status(), 200, 'tệp không nạp được (' + res.status() + '): ' + src);
    }
  });

  uiTest('HZ-04 nạp trang không có lỗi console và nav hiện đủ mục', async (page) => {
    const loi = [];
    page.on('console', m => { if (m.type() === 'error') loi.push(m.text()); });
    page.on('pageerror', e => loi.push('pageerror: ' + e.message));
    await loginViaApi(page, 'admin');
    for (const p of ['dashboard', 'projects', 'daily', 'docs', 'issues', 'reports', 'companyPeople', 'settings']) {
      assert.equal(await navVisible(page, p), true, 'thiếu mục nav: ' + p);
    }
    assert.equal(await navVisible(page, 'people'), false, 'QT dùng mục Hồ sơ nhân sự công ty hợp nhất');
    assert.deepEqual(loi, [], 'không được có lỗi console khi nạp trang');
  });
};
