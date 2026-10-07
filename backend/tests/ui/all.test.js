// ============================================================================
// KIỂM THỬ GIAO DIỆN (dành cho người phát triển) — chạy trên CSDL THỬ RIÊNG, không đụng dữ liệu thật.
// Chạy: backend\scripts\run-ui-tests.cmd [ten_csdl_thu] [mau_ten_ca]
//   → kết quả ở backend\tests\last-ui-test.txt, ảnh lỗi ở backend\tests\ui-artifacts\
// Một tiến trình, một CSDL, một máy chủ (cổng 3103) cho cả lượt chạy; mỗi ca một
// browser context riêng. Các ca nằm trong tests/ui/cases/*.js.
// ============================================================================
const test = require('node:test');
const { startApp, stopApp } = require('./helpers');

test.before(startApp);
test.after(stopApp);

require('./cases/01-dang-nhap')();
require('./cases/02-tai-khoan-va-nav')();
require('./cases/03-tong-quan')();
require('./cases/04-nhat-ky-duyet')();
require('./cases/05-tra-lai-va-khoa-sua')();
require('./cases/06-ho-so')();
require('./cases/07-quyen-theo-chuc-danh')();
require('./cases/08-thung-rac')();
require('./cases/09-ha-tang-js')();
require('./cases/10-mobile')();
require('./cases/11-pwa')();
require('./cases/12-offline-files')();
require('./cases/13-edit-conflicts')();
require('./cases/14-role-permissions')();
