# Cập nhật MVP-05: chống ghi đè khi nhiều người sửa

Build: `2026-10-06.2-mvp05`. Chỉ cập nhật MVP-05, không sử dụng DB/cổng của MVP-03/MVP-04.

Bản .2 giữ kết quả lưu thông tin hồ sơ và tệp còn chờ trong hàng đợi. Khi tải tệp hoặc tải lại hồ sơ lỗi, thử lại chỉ tiếp tục phần chưa hoàn tất; không gửi lại PATCH đã thành công hoặc tải lại tệp đã xác nhận. Nếu người dùng sửa nội dung tiếp, vẫn kiểm tra phiên bản từ lần ghi đã xác nhận của chính họ, không tự dùng phiên bản mới của người khác.

## Trước khi cập nhật máy Windows

1. Chờ PR được duyệt và Actions đạt ở đúng commit sẽ triển khai. Không dùng kết quả 46/46, 1/1, 25/25 của phiên Windows trước làm bằng chứng cho nhánh này.
2. Tại `D:\Setup\QLGS-HeThong\ChatGPT\VINA-SUPERVISION-MVP-05`, chạy `git status --short`. Nếu còn sửa chưa commit từ phiên trước, lưu diff/sao chép riêng và đối chiếu trước; không chạy reset/checkout đè hoặc pull tự động.
3. Sau khi xử lý thay đổi cục bộ và PR được merge, cập nhật `main`. Dừng riêng backend MVP-05 trước migration; không dừng MVP-03/MVP-04.
4. Sao lưu DB bằng script hiện có:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\backup-db.ps1 -Label truoc-row-version
```

Giữ cả `backend\uploads`, bản `.env` an toàn và file `.dump` trong `backups` ở nơi riêng; không đưa lên GitHub. Trước vận hành, kiểm tra khôi phục `.dump` vào một DB thử riêng và kiểm tra dữ liệu/tệp trên bản thử. Phiên Codex này không đã chạy khôi phục hay migration vào DB thật. Không khôi phục đè DB đang dùng để thử.

5. Cài phụ thuộc theo lockfile rồi khởi động bằng launcher MVP-05:

```powershell
cd backend
npm ci
cd ..
.\run.bat
```

Launcher/migration hiện có phải ghi nhận cả `20261005_09_optimistic_concurrency.sql` (cột phiên bản) và **`20261006_01_row_version_guard.sql`** (trigger) vào `schema_migrations`. Máy Windows có thể đã chạy bản cũ của migration đầu từ phiên chưa commit: không sửa/chạy lại migration đã ghi nhận để cài trigger; migration mới thứ hai đảm nhiệm việc này. Không sửa một migration đã áp dụng. Migration này có thể chạy lại mà không đặt lại `row_version`; mỗi UPDATE tự tăng phiên bản, kể cả đổi trạng thái và cập nhật tiến độ.

## Truy cập và kiểm tra sau cập nhật

- Truy cập chính: `http://localhost:3004/`; giao diện phụ: `http://localhost:8083/`.
- Health `http://localhost:3004/health`: `status: OK`, `database: connected`, build mới và `migrations_pending: []`.
- PostgreSQL MVP-05: cổng `5435`, DB `vina_supervision_mvp05`.
- Tải lại giao diện để nhận cache PWA mới. Các client cũ không gửi phiên bản sẽ bị từ chối lưu thay vì ghi đè dữ liệu; xuất các bản nháp ngoại tuyến trước khi cập nhật.
- MVP-05 hiện chưa có địa chỉ Tailscale riêng được xác minh. Nếu cần truy cập từ thiết bị khác, cấu hình địa chỉ riêng theo README; không dùng địa chỉ/cổng của MVP-03/MVP-04.

## Khi báo xung đột

A lưu trước, B lưu bản cũ nhận `409 EDIT_CONFLICT`; không tự ghi đè hoặc tự lấy phiên bản mới để gửi lại nội dung cũ. Biểu mẫu trực tuyến giữ nguyên nội dung nhập. Các bản lưu ngoại tuyến giữ trong hàng đợi trên thiết bị; trạng thái `CONFLICT` không tự thử lại khi có mạng. Bấm chỉ báo “bản xung đột” để xuất JSON bản nháp, rồi chủ động bỏ bản nháp/tải bản mới và nhập phần cần giữ sau đối chiếu. Tệp ngoại tuyến còn trong IndexedDB; việc bỏ nháp không tự xóa chúng.

Hồ sơ đã mở trước khi mất mạng có thể giữ thay đổi/tệp trong hàng đợi. Tạo hồ sơ mới và tổng hợp báo cáo/ghi tiến độ vẫn cần mạng. Báo cáo tổng hợp giữ biểu mẫu khi lỗi mạng; không tự gửi các thay đổi tiến độ khi nối mạng lại. Bản nháp JSON chứa nội dung nghiệp vụ, cần bảo quản như tài liệu dự án.

## Kiểm thử và giới hạn

GitHub Actions chạy regression, `concurrency.test.js` (A/B, CAS đồng thời, thiếu/sai phiên bản, đổi trạng thái, migration chạy lại), và UI gồm các ca giữ nội dung/nối mạng lại cho bốn loại. Các DB thử bắt buộc mang tên `vina_reg*` hoặc `vina_ui*`; không dùng DB thật.

Codex kiểm tra cú pháp/diff và đọc kết quả Actions; không gọi bộ kiểm thử chạy tại cloud là kết quả GitHub. Chỉ kết luận đạt khi job và số ca của đúng commit đã hoàn tất. Kiểm tra thủ công trên hai thiết bị thật, mạng chập chờn, tệp lớn và thao tác đối chiếu bản nháp vẫn cần nghiệm thu riêng. Báo cáo ghi metadata, tiến độ và tệp qua nhiều request, chưa phải giao dịch duy nhất cho toàn bộ các bước.
