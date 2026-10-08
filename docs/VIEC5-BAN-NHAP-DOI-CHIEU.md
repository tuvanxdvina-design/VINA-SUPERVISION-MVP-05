# Việc 5 — bản nhập cần đối chiếu

Nhánh mới từ main a2ab686: `codex/mvp05-viec5-doi-chieu`. Build dự kiến `2026-10-08.2-mvp05`.

## Kết quả triển khai Windows

Đã khởi động build 2026-10-08.2-mvp05 trên backend 3004, frontend 8083 và HTTPS Tailscale 8444. Health OK, database connected, không pending migration; .env khớp bản sao. Kiểm tra chỉ đọc đạt: 7 báo cáo ngày, 10 hồ sơ, 9 vấn đề; 8 tệp hồ sơ, 3 ảnh khớp byte; hung/nthanhb khác người. Các báo cáo THU đã dọn trong yêu cầu trước, không dọn dữ liệu thêm ở Việc 5.

Sao lưu backups/vina-supervision-2026-10-08-1426-pre-viec5-update.dump, zip uploads tương ứng, cấu hình viec5-config-20261008-142707. Khôi phục thử 31 bảng khớp số dòng/hash. Không xóa Docker volume hoặc backups/uploads.

Kiểm thử Windows: hồi quy 46/46, xung đột 6/6, phân quyền 22/22, UI toàn bộ 70/70 (lượt cuối), jsUnits 6/6, cú pháp/build và diff check đạt. Log trong runtime-logs/viec5-{regression-pass,concurrency,permissions,ui-final,health,live-api-verification}.txt hoặc .json tương ứng. Mã hiện còn thay đổi chưa commit trên nhánh riêng; chưa push/merge hoặc chạy CI GitHub cho bản này. Chưa chốt nghiệm thu điện thoại.

## Bằng chứng và giới hạn

Người dùng thử Android Chrome trên màn hình, sửa báo cáo ngày ngoại tuyến. Sau bật mạng: ONLINE, còn 1 bản chờ, không thấy từ chối. Chưa đọc được log điện thoại nên không kết luận nguyên nhân chính xác.

Ca GD-V5 trên DB thử tái hiện một trường hợp phù hợp: lần PATCH đầu khi trở lại mạng bị lỗi vận chuyển; bản nhập vẫn PENDING, máy chủ giữ bản người khác; thử gửi lại phát hiện EDIT_CONFLICT. Các ca GD-OCC cũ có gọi đồng bộ trực tiếp, không chứng minh riêng việc tự gửi sau sự kiện online.

Ca tạo mới trùng ngày/ca xác nhận bản bị từ chối cần thao tác sửa hoặc bỏ mà không bắt GET ID chưa có trên máy chủ. Ca mới xác minh đổi ngày rồi gửi thành công, hoặc bỏ chỉ bản tạo mới trên thiết bị.

## Các tệp sửa và trước/sau

| Tệp | Trước | Sau |
|---|---|---|
| js/01-core.js | Chỉ liệt kê CONFLICT, xuất JSON, bỏ nháp luôn GET máy chủ | Liệt kê cả bản chờ; thử đồng bộ lại chỉ PENDING; xem hai bản bằng bảng chữ, đánh dấu khác nhau; phân loại theo EDIT_CONFLICT; sửa bản từ chối; bỏ CREATE chưa lên máy chủ không GET và chỉ xóa bản/tệp cục bộ sau xác nhận |
| api.js | Một số lỗi 400/422 còn chờ tự gửi | Dữ liệu 400/409/422 bị từ chối được giữ để xử lý, mã EDIT_CONFLICT tiếp tục được giữ; không đổi payload phiên bản/CAS hoặc tự lấy phiên bản mới để ghi đè |
| js/13-tong-quan.js | Mọi xung đột hướng đến Công trình | Nút mở đúng màn hình đối chiếu và thử đồng bộ lại, áp dụng cả bản đang chờ |
| backend/tests/ui/cases/13-edit-conflicts.js | Ca offline gọi đồng bộ trực tiếp, không kiểm màn hình hai bản | Bổ sung tái hiện lỗi lần gửi đầu, nút thử gửi lại, bảng so sánh, reload giữ bản nhập; thử sửa/bỏ CREATE trùng; kiểm bảng hai bản trên cả bốn phân hệ |
| backend/src/build.js, js/14-dang-nhap.js, sw.js | Build .1/cache v1 | Build .2/cache v2 |

Không thêm migration, không sửa backend quyền/row_version, không thay MVP-03/04, JWT, Docker volume hay xóa backups/uploads.

## Thử trên điện thoại sau khi cập nhật

Giữ bản nhập hiện tại, chưa đăng xuất/xóa dữ liệu Chrome. Tổng quan → Bản nhập cần đối chiếu / thử đồng bộ lại → Thử đồng bộ lại. Nếu máy chủ đã được sửa: xem hai bản và kiểm bản điện thoại/máy tính đều hiện. Nếu vẫn chờ: ghi thông báo lỗi, chưa bỏ bản nhập. Đóng/mở lại để kiểm tra tồn tại. Chưa chốt nghiệm thu điện thoại từ kết quả Chrome Windows.
