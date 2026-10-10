# Điều hướng điện thoại MVP-05 — 10/10/2026

Nhánh `codex/mvp05-thanh-duoi-dien-thoai` tạo từ main đã khớp origin/main (merge PR #9, `fe6591b`). Build ứng viên `2026-10-10.2-mvp05`.

## Phạm vi

Chỉ đổi bố cục dưới **900 px**. Thanh dưới gồm Tổng quan, Công trình, Báo cáo, Vấn đề, Thêm. Bốn mục đầu dùng lại nút/handler có sẵn; Thêm mở các mục phụ và gọi nút gốc khi chọn, không có luồng nghiệp vụ hoặc API mới. Nhãn thanh dưới 12 px, tối đa hai dòng; SVG nội tuyến ở index.html, màu và gạch dưới chỉ mục đang chọn.

CSS điện thoại trùng/ngược ở khối đầu index.html được gom thành một khối dưới 900 px; bỏ cột 72 px/ẩn aside/điều hướng cuộn ngang cũ. Quy tắc thẻ bảng ≤600 px và các biểu mẫu giữ nguyên chức năng. Header dùng grid, chiều cao tự tăng theo tên dài; nội dung nằm sau header trong luồng trang.

PC từ 900 px giữ CSS thanh bên, header và bảng. SVG/mục Thêm ẩn trên PC. Thay tên Audit Log thành **Nhật ký hệ thống** là ngoại lệ chữ theo yêu cầu, không đổi bố cục PC.

## Quyền và giới hạn Audit

| Mục phụ | Điều kiện giao diện hiện có | Đối chiếu máy chủ |
|---|---|---|
| Thiết lập | `canManageAssignments`: mã ADMIN/DIRECTOR | API quản lý phân công/tài khoản đã kiểm vai trò ở máy chủ; không đổi route/quyền |
| Thùng rác | `canSeeTrash`: quản trị hoặc DELETE tại ít nhất một công trình | GET `/api/recycle-bin` cho phép đúng phạm vi DELETE; kiểm cấp/thu hồi DELETE ở DB thử |
| Việc cần duyệt | `isReviewer`: quản trị hoặc APPROVE tại công trình | Cache quyền từ `/project-members/my-permissions`, giữ quy tắc inbox hiện có |
| Nhật ký hệ thống | **Ẩn trong menu điện thoại** | Chưa có API đọc Audit Log; trang hiện dùng `db.audit` trên thiết bị. `/api/audit` và `/api/audit-logs` trả 404 cho cả năm vai trò. Không thể xác nhận quyền máy chủ, không tự thêm API hoặc suy ra quyền từ vai trò |

Đã hỏi người dùng lựa chọn xử lý Audit; khi chưa có trả lời, áp dụng phương án đã nêu: ẩn mục điện thoại đến khi quyền máy chủ được xác nhận. PC giữ mục cũ với nhãn mới. Đây không phải xác nhận API Audit đã được phân quyền.

Menu đang mở cập nhật khi quyền gốc đổi. Đóng bằng nút Đóng, Escape hoặc nền; giữ focus trong menu, trả focus về Thêm khi đóng. Không đổi row_version, đồng bộ, dữ liệu hoặc phân quyền.

## Ảnh trước/sau

Ảnh dùng dữ liệu DB thử, công trình 001 và tên người dùng dài giả lập trong phiên Chrome; không sửa tài khoản thật. Ảnh trước đọc giao diện từ main; chỉ phục vụ index.html/js điện thoại cũ qua route kiểm thử, không rollback file làm việc. Tệp còn lại và backend thử dùng mã hiện tại, build khớp để không tạo cảnh báo giả.

| Cỡ | Trước | Sau | Menu Thêm |
|---|---|---|---|
| 360 px | [Trước](../runtime-logs/mobile-nav-screenshots/before-360.png) | [Sau](../runtime-logs/mobile-nav-screenshots/after-360.png) | [Thêm](../runtime-logs/mobile-nav-screenshots/after-360-more.png) |
| 390 px | [Trước](../runtime-logs/mobile-nav-screenshots/before-390.png) | [Sau](../runtime-logs/mobile-nav-screenshots/after-390.png) | [Thêm](../runtime-logs/mobile-nav-screenshots/after-390-more.png) |
| 768 px | [Trước](../runtime-logs/mobile-nav-screenshots/before-768.png) | [Sau](../runtime-logs/mobile-nav-screenshots/after-768.png) | [Thêm](../runtime-logs/mobile-nav-screenshots/after-768-more.png) |
| PC 1440 px | [Trước](../runtime-logs/mobile-nav-screenshots/before-1440.png) | [Sau](../runtime-logs/mobile-nav-screenshots/after-1440.png) | Không có |

Ảnh/log trong runtime-logs được giữ cục bộ, không đưa dữ liệu ảnh/log vào git. Đó là mô phỏng Chrome, chưa thay thế nghiệm thu trên điện thoại thật.

## File trước/sau

| File | Trước | Sau |
|---|---|---|
| index.html | Nhiều khối phone chồng nhau; thanh 11 mục cuộn; emoji và chữ 11 px; header cố định 54 px | Một khối bố cục dưới 900 px, 5 mục, SVG cùng file, menu Thêm, header tự cao; đổi nhãn Audit |
| js/16-the-dien-thoai.js | Chỉ chuyển bảng thành thẻ | Bổ sung trang trí SVG, menu phụ, lựa chọn hiện tại và cập nhật khi quyền/UI đổi; dùng lại handler cũ |
| backend/tests/ui/cases/18-mobile-navigation.js, all.test.js | Chưa có ca thanh 5 mục | Thêm 10 ca kích thước, năm vai trò, quyền DELETE thay đổi, PC/ngưỡng 900 và ảnh |
| backend/src/build.js, js/14-dang-nhap.js, sw.js | Build 2026-10-10.1 | Build/cache ứng viên 2026-10-10.2 |
| CLAUDE.md, docs/CODEMAP.md và nhật ký | Chưa có hướng dẫn menu mới | Ghi vị trí hàm, phạm vi và kết quả thực tế |

## Kiểm thử và vận hành

Đạt **201/201**: API 46, phân quyền 22, xung đột 6, nhân sự 11, JavaScript unit 6, Chrome **110/110** (gồm 10 ca mới). PWA/shell ngoại tuyến đạt; cú pháp và diff 0 lỗi. Chi tiết ghi ở KET-QUA-KIEM-THU-20260926.md. DB có tên riêng `vina_reg_mobile_nav_20261010_*` / `vina_ui_mobile_nav_20261010_*`, uploads thử riêng. Không reset DB vận hành, không chạy launcher, không tự commit/push/merge/triển khai trong yêu cầu này. Nghiệm thu trên điện thoại thật chưa kiểm tra.

## Phạm vi bổ sung được người dùng giao

Phần nhân sự được bổ sung cho cả điện thoại và PC: QT/GD gộp Nhân sự vào Hồ sơ nhân sự công ty, bộ chọn thêm Nhân sự toàn công ty; tài khoản khác chỉ xem nhân sự dự án được giao. Thay đổi đọc API company-personnel giới hạn ADMIN/DIRECTOR đã được đưa vào phạm vi này; các chức năng phân công, chứng chỉ, scan, gộp/tách được giữ nguyên.

| File | Trước | Sau |
|---|---|---|
| js/17-ho-so-nhan-su.js, js/09-nhan-su.js | Hai màn hình riêng | Một mục cho QT/GD, chọn phạm vi công ty hoặc công trình; người khác chỉ có dự án có VIEW |
| js/01-core.js, js/03-cong-trinh.js, index.html | Hai mục nhân sự cho quản lý, tiêu đề dài trong công trình | Một mục quản lý, nhãn Nhân sự trong công trình, mở đúng phạm vi |
| backend/src/routes/companyPersonnel.js | Vai trò khác đọc hồ sơ toàn công ty | Đọc/ghi chỉ ADMIN/DIRECTOR; project-personnel giữ nguyên quyền dự án |
| company-personnel.test.js, UI 07/16/17/18, helpers.js | Kiểm tra menu cũ và quyền xem toàn công ty | Kiểm quyền đọc mới, giữ nghiệp vụ và thêm 10 ca hợp nhất ở 390/1440 px |

## Kiểm thử phần nhân sự hợp nhất (10/10/2026)

API 46/46, quyền 22/22, xung đột 6/6, nhân sự 11/11, unit 6/6, PWA đạt. Chrome toàn bộ: 119/120; HZ-04 còn đòi nút Nhân sự riêng cho QT, đã đổi kỳ vọng sang Hồ sơ nhân sự công ty và chạy lại riêng đạt 1/1. Mười ca hợp nhất nhân sự cho năm vai trò tại 390/1440 px đều đạt. CI sẽ chạy lại toàn bộ mã cuối trước merge. Không coi kiểm thử mô phỏng là nghiệm thu điện thoại thật.
