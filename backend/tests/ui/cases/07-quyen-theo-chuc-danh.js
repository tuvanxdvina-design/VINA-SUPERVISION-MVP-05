// Quyền mặc định tại công trình đổi theo CHỨC DANH, và Xóa không bao giờ là quyền mặc định.
// Đây là bản sao phía client của permissionService.js (defaultPermsFor / LEAD_DEFAULT_PERMS):
// ca này đỏ nếu bản sao lệch khỏi quy tắc.
const assert = require('node:assert/strict');
const { uiTest, loginViaApi, openPage, tokenOf, projectIdByContract } = require('../helpers');

// Mã quyền đang được tích trong modal nhân sự.
const quyenDangTich = (page) => page.$$eval('.tmPerm', els => els.filter(e => e.checked).map(e => e.value));

module.exports = function () {
  uiTest('GD-11 quyền mặc định đổi theo chức danh, không bao giờ mặc định có Xóa', async (page) => {
    await loginViaApi(page, 'admin');
    await openPage(page, 'people');
    // Không phụ thuộc công trình được chọn từ các thao tác/đồng bộ trước đó.
    const pid = await projectIdByContract(await tokenOf('admin'), '001');
    await page.locator('#directoryProject option[value="' + pid + '"]').waitFor({ state: 'attached' });
    await page.selectOption('#directoryProject', pid);
    await page.waitForFunction(() => (document.getElementById('projectTeamDirectory')?.innerText || '').includes('Nguyễn Thành B'));

    // Phải chọn người ĐÃ liên kết tài khoản: khung "Quyền truy cập tại công trình" chỉ hiện khi có tài khoản.
    // (Nguyễn Thành B ↔ tài khoản thanhb, vai trò ENGINEER, chức danh GS viên tại công trình 001.)
    // Ca này KHÔNG bấm "Lưu thay đổi" — chỉ đọc quyền mặc định, để không đổi dữ liệu dùng chung với ca khác.
    await page.locator('#projectTeamDirectory tr.clickable', { hasText: 'Nguyễn Thành B' }).first().click();
    await page.waitForSelector('#modal.show #tmTitle', { state: 'visible' });
    // Khung quyền của người đã liên kết tài khoản nằm trực tiếp trong #mbody (không phải trong #tmPermWrap).
    await page.waitForSelector('#mbody .tmPerm', { state: 'attached' });

    await page.selectOption('#tmTitle', 'TVGS trưởng');
    await page.waitForFunction(() => (document.getElementById('tmDefaultsText')?.textContent || '').includes('Duyệt'));
    let perms = await quyenDangTich(page);
    assert.ok(perms.includes('APPROVE'), 'chức danh TVGS trưởng phải có quyền Duyệt theo mặc định: ' + perms.join(','));
    assert.ok(!perms.includes('DELETE'), 'Xóa không bao giờ là quyền mặc định: ' + perms.join(','));

    await page.selectOption('#tmTitle', 'GS viên');
    await page.waitForFunction(() => !(document.getElementById('tmDefaultsText')?.textContent || '').includes('Duyệt'));
    perms = await quyenDangTich(page);
    assert.ok(!perms.includes('APPROVE'), 'chức danh GS viên không được có quyền Duyệt mặc định: ' + perms.join(','));
    assert.ok(perms.includes('VIEW') && perms.includes('CREATE') && perms.includes('DOWNLOAD'),
      'GS viên phải có Xem/Thêm/Tải xuống: ' + perms.join(','));
    assert.ok(!perms.includes('DELETE'), 'Xóa không bao giờ là quyền mặc định: ' + perms.join(','));
  });
};
