# Hồ sơ nhân sự công ty — MVP-05

Nhánh: `codex/mvp05-ho-so-nhan-su`, tạo từ `main` tại `f0c0a2b`.
Build mã mới: `2026-10-09.8-mvp05`.
Thực hiện trong worktree `runtime-logs/worktrees/ho-so-nhan-su`; thư mục vận hành vẫn ở `main`.

## Hành vi sau thay đổi

- Mục **Hồ sơ nhân sự công ty** có một dòng cho mỗi hồ sơ, liên kết tài khoản tùy chọn. Chọn hồ sơ đã có để phân công vào các công trình, dùng chung chứng chỉ và scan.
- Chứng chỉ gồm loại, số, hạng, lĩnh vực, ngày cấp, ngày hết hạn, nơi cấp; nhiều scan PDF/ảnh, tối đa 15 MB/tệp.
- Chỉ ADMIN/DIRECTOR thêm, sửa, xóa hồ sơ, chứng chỉ, scan. Máy chủ kiểm tra mọi đường ghi, kể cả đường nhân sự công trình cũ.
- (Cập nhật 10/10) Mục **Hồ sơ nhân sự công ty** — danh sách, chi tiết, scan, thống kê chứng chỉ hết hạn — **chỉ ADMIN/DIRECTOR thấy**; mọi API `/company-personnel` trả 403 với vai trò khác. Tài khoản khác chỉ xem nhân sự của công trình được phân công (trang Nhân sự), gồm chứng chỉ, và scan qua `/project-personnel/:id/files` (quyền công trình + DOWNLOAD).
- Hồ sơ đang phân công phải được rút khỏi công trình trước khi xóa. Xóa hồ sơ/chứng chỉ/scan là xóa mềm; không xóa bytes đã dùng trong bản chụp lịch sử.
- Xóa công trình chỉ xóa phân công; hồ sơ công ty, chứng chỉ và scan tập trung vẫn còn.
- Phân công người có bất kỳ chứng chỉ hết hạn nào trả `409 EXPIRED_CERTIFICATES` nếu chưa xác nhận. Giao diện bắt tích **Tôi đã biết**. Backend chỉ nhận boolean `true`; audit `ACK_EXPIRED_CERTIFICATES` ghi người, thời điểm, công trình và các chứng chỉ trong cùng giao dịch. Lỗi audit hủy phân công.
- Tổng quan có số chứng chỉ hết hạn và sắp hết hạn trong 30 ngày; tính ngày theo múi giờ Việt Nam. Hết hạn trước hôm nay; từ hôm nay đến ngày thứ 30 thuộc sắp hết hạn. Chưa khai báo hạn không được tính là hết hạn.
- Gợi ý gộp có lý do **Trùng tên + trùng số chứng chỉ** hoặc **Chỉ trùng tên — Cần kiểm tra kỹ**. Chỉ ADMIN/DIRECTOR được xem và xác nhận. **Không gộp** giữ hai hồ sơ và ẩn lại gợi ý cho cặp đó.
- Gộp bị chặn (409) nếu hai hồ sơ cùng đang được phân công ở một công trình; rút một bên trước. DB có chỉ mục duy nhất `(project_id, personnel_profile_id)` cho phân công đang hoạt động.
- Gộp cần xác nhận rõ ràng; giữ nguyên từng chứng chỉ và scan, chuyển liên kết phân công về hồ sơ đích, giữ hồ sơ nguồn để tách lại. Hai hồ sơ liên kết hai tài khoản khác nhau bị chặn. Gộp/từ chối/tách đều có nhật ký và người thực hiện.
- **Tách lại** trả chứng chỉ và các phân công trước gộp về nguồn. Không xóa nội dung được sửa thêm sau gộp. Nếu đã gộp tiếp, phải tách lần sau trước; không tự đoán khi liên kết đã đổi.
- Báo cáo ngày và hồ sơ/biên bản loại BB chụp chứng chỉ khi **Gửi duyệt**, hoặc khi trưởng tự **Xác nhận** nháp của mình. Biên bản hiện trường trong Chất lượng hiện có **Đóng**, không có Gửi duyệt: chụp khi Đóng, giữ quy trình hiện có.
- Bản chụp giữ metadata, mã băm, tham chiếu scan và người/thời điểm. Sửa/xóa chứng chỉ về sau không đổi bản chụp. Xem scan lịch sử vẫn qua quyền công trình và DOWNLOAD; quyền nháp riêng của báo cáo ngày được giữ.

## Migration và dữ liệu cũ

`migrations/20261009_company_personnel.sql` chạy trong một giao dịch, có thể chạy lại.

1. Tự ghép hồ sơ **chỉ khi cùng user_id**. Dòng không có tài khoản giữ danh tính riêng, kể cả trùng tên/số chứng chỉ.
2. `personnel_imports` giữ bản gốc của từng dòng nhân sự. Chuỗi chứng chỉ cũ được giữ nguyên trong chứng chỉ loại **Chứng chỉ cũ**, không đoán ngày/hạng/lĩnh vực từ văn bản tự do.
3. Scan cũ được tham chiếu sang bảng tập trung bằng cùng storage key/mã băm. Bảng file công trình cũ giữ làm lưu trữ; đường ghi mới chỉ ghi vào bảng tập trung.
4. `project_personnel.personnel_profile_id` tham chiếu hồ sơ. Cột `certificate` cũ được làm rỗng sau khi lưu nguồn; API đọc chứng chỉ từ hồ sơ tập trung. `full_name` cũ còn để tương thích, tên hiển thị đọc từ hồ sơ.
5. Gợi ý gộp được tính từ các hồ sơ còn hoạt động, không phải thao tác gộp tự động. Chạy lại migration không tách lần gộp đã xác nhận, không khôi phục chứng chỉ/file đã xóa mềm.
6. API phân công cũ vẫn hoạt động. Khi chọn tài khoản có sẵn, gửi user_id ngay lúc tạo nhân sự để tái sử dụng hồ sơ của đúng tài khoản, không suy đoán theo tên.

Không sửa migration row_version, quyền mặc định/tùy chỉnh hoặc cơ chế hàng đợi ngoại tuyến. Bản chụp được gán trong UPDATE trạng thái hiện có; row_version chỉ tăng một lần. Luồng đồng bộ nhân sự gửi lại ID ổn định để giữ tính lặp lại khi bỏ ghép theo tên.

## Danh sách file — trước và sau

| File | Trước | Sau |
|---|---|---|
| `migrations/20261009_company_personnel.sql` | Chưa có hồ sơ tập trung | Bảng hồ sơ/chứng chỉ/scan/import/gộp/bản chụp, tham chiếu phân công, trigger nhập và chụp |
| `backend/src/services/companyPersonnelService.js` | Chưa có | CRUD, hạn chứng chỉ, audit nguyên tử, gợi ý/gộp/tách |
| `backend/src/routes/companyPersonnel.js` | Chưa có | API đọc toàn bộ vai trò; ghi/gợi ý chỉ ADMIN/DIRECTOR |
| `backend/src/routes/certificateSnapshots.js` | Chưa có | Đọc lịch sử và scan bất biến sau kiểm tra quyền bản ghi |
| `backend/src/app.js` | API nhân sự công trình | Đăng ký thêm API hồ sơ công ty |
| `backend/src/services/projectPersonnelService.js` | Chứng chỉ/file theo công trình, ghép theo tên | Đọc tập trung, chỉ khớp ID/hồ sơ/user_id, xác nhận hết hạn trong giao dịch |
| `backend/src/routes/projectPersonnel.js` | Trả lỗi phân công cũ | Trả mã/chi tiết cảnh báo, actor cho audit, thông tin hồ sơ tập trung |
| `backend/src/services/projectMemberService.js` | Phân công chưa kiểm tra chứng chỉ | Kiểm tra hết hạn, chuyển xác nhận và gói thầu sang service phân công |
| `backend/src/routes/projectMembers.js` | Actor/chi tiết cảnh báo chưa chuyển | Truyền actor và trả chi tiết cảnh báo |
| `backend/src/services/dailyLogService.js` | Chuyển trạng thái chưa ghi actor chụp | Gửi actor thực tế vào cùng UPDATE trạng thái |
| `backend/src/services/documentService.js` | Danh sách hồ sơ chưa có bản chụp | Trả bản chụp cùng hồ sơ |
| `backend/src/routes/dailyLogs.js` | Chỉ tệp báo cáo | Thêm đường bản chụp sau quyền công trình và nháp riêng |
| `backend/src/routes/documents.js` | Chỉ tệp hồ sơ | Thêm đường bản chụp sau quyền công trình |
| `backend/src/routes/issues.js` | Chỉ tệp văn bản | Thêm đường bản chụp biên bản sau quyền công trình |
| `index.html` | Chỉ danh sách nhân sự công trình | Mục hồ sơ công ty, thống kê chứng chỉ, nạp module mới |
| `js/17-ho-so-nhan-su.js` | Chưa có | Màn hình hồ sơ/chứng chỉ/scan/phân công/gợi ý/tách/bản chụp |
| `js/09-nhan-su.js` | Gợi ý theo tên, sửa chứng chỉ tại công trình | Chọn rõ hồ sơ đã có, chứng chỉ từ hồ sơ, xác nhận hết hạn, user_id/ID ổn định |
| `api.js` | Mapper chưa giữ bản chụp | Mapper báo cáo/hồ sơ/biên bản giữ thêm bản chụp, không đổi thuật toán đồng bộ |
| `js/11-duyet.js` | Chỉ lịch sử/ý kiến duyệt | Hiện thêm chứng chỉ và scan tại lần gửi duyệt |
| `js/08-chat-luong.js` | Xem biên bản chưa có chứng chỉ | Hiện bản chụp khi đóng biên bản |
| `js/13-tong-quan.js` | Chưa có thống kê chứng chỉ | Tải số chứng chỉ với giới hạn tần suất, không chặn render |
| `js/16-the-dien-thoai.js` | Bảng cũ thành thẻ | Thêm bảng hồ sơ công ty vào chế độ thẻ |
| `backend/src/build.js` | `2026-10-09.7-mvp05` | `2026-10-09.8-mvp05` |
| `js/14-dang-nhap.js` | Build giao diện .7 | Build giao diện .8 |
| `sw.js` | Shell v7 | Shell v8, cache thêm module hồ sơ công ty |
| `backend/tests/company-personnel.test.js` | Chưa có | 10 ca API/DB mới, DB riêng, cổng 3115 |
| `backend/tests/ui/cases/16-company-personnel.js` | Chưa có | 4 ca Chrome về chỉ đọc, nhập scan, cảnh báo và gộp/tách |
| `backend/tests/ui/all.test.js` | Bộ giao diện cũ | Đăng ký thêm 4 ca hồ sơ |
| `backend/tests/regression.test.js` | Mong tự ghép tên | Mong giữ danh tính khác nhau; kiểm tra migrations_pending thật |
| `backend/tests/lib/testDb.js` | Phụ thuộc khóa ký từ môi trường, chưa ghi migration | Khóa ngẫu nhiên chỉ cho server thử; ghi migration đã chạy giống launcher |
| `backend/tests/ui/helpers.js` | Ca có thể chờ vô hạn | Giới hạn 120 giây/ca |
| `backend/tests/ui/cases/13-edit-conflicts.js` | Chờ PATCH không có hạn, có thể đua đồng bộ nền | Chờ đồng bộ sẵn sàng và giới hạn 25 giây nhận PATCH |
| `backend/package.json` | Chưa có lệnh riêng | Thêm `test:personnel` |
| `.github/workflows/kiem-thu.yml` | API/row_version/quyền/Chrome | Thêm DB và bước CI hồ sơ, log/artifact cùng các bộ cũ |
| `docs/CODEMAP.md` | Chưa mô tả module | Bổ sung định tuyến module/API/migration/kiểm thử |
| `docs/HO-SO-NHAN-SU-CONG-TY.md` | Chưa có | Hành vi, migration, bảng trước/sau, kết quả và nghiệm thu |

## Kiểm thử

Các DB đều bắt đầu `vina_reg_personnel_*` hoặc `vina_ui_personnel_*`. Không dùng DB vận hành; không sửa .env, uploads thật, backup hoặc volume hiện có. Tệp scan thử nằm trong worktree.

Biến môi trường riêng của các bộ: `TEST_DB_URL`, `CONFLICT_TEST_DB_URL`, `PERMISSION_TEST_DB_URL`, `COMPANY_PERSONNEL_TEST_DB_URL`, `UI_TEST_DB_URL`. Trên Windows worktree đặt `COMPOSE_PROJECT_NAME=vina-supervision-mvp-05` để dùng PostgreSQL hiện có, không tạo container/volume khác. Mỗi URL phải trỏ DB thử riêng; helper từ chối tên DB vận hành.

Các lệnh: kiểm tra frontend; `node --test backend/tests/regression.test.js`; `node --test backend/tests/company-personnel.test.js`; bộ concurrency/permissions/jsUnits; `node --test backend/tests/ui/all.test.js`. PWA được chạy trên server thử cổng 3114.

Kết quả cuối ngày 09/10/2026: **179/179 đạt**, không ca bị bỏ qua. Sau khi bổ sung chặn gộp trùng công trình và chỉ mục duy nhất, chạy lại toàn bộ (Claude, DB `vina_*_claude7`): **180/180 đạt** — hồ sơ công ty 11/11, phân quyền 22/22, hồi quy 46/46, xung đột 6/6, jsUnits 6/6, Chrome 89/89, cú pháp đạt.

| Bộ | Kết quả | Bằng chứng trong worktree |
|---|---|---|
| Hồi quy API | 46/46 | `runtime-logs/ho-so-nhan-su-api.txt` |
| Row_version / lưu đồng thời | 6/6 | `runtime-logs/ho-so-nhan-su-permissions-occ.txt` |
| Phân quyền cũ | 22/22 | Cùng log permissions-occ |
| Bộ tách JS | 6/6 | Cùng log permissions-occ |
| Hồ sơ công ty / migration / scan / audit | 10/10 | `runtime-logs/ho-so-nhan-su-feature-verified.txt` |
| Chrome đầy đủ | 89/89 | `runtime-logs/ho-so-nhan-su-ui-final.txt` |
| Cú pháp frontend / build | 0 lỗi, build .8 khớp | `node backend/scripts/check-frontend.js` |
| PWA thử cổng 3114 | Đạt | `runtime-logs/ho-so-nhan-su-pwa.txt`: service worker controlled, 26 script ngoại tuyến, không lỗi chặn cài |

Các lỗi tìm thấy đã sửa: phần thống kê gọi hàm đăng nhập khi api.js không nạp; ca kiểm thử giữ PATCH chờ không giới hạn; luồng C3 chọn tài khoản đã có hồ sơ nhưng tạo dòng không user_id trước; phân loại lỗi audit thành lỗi hồ sơ. Ca migration cũng có một lần reset kết nối thử do psql đồng bộ chặn event loop lâu; helper ca này nhường event loop giữa các lần migration, lượt cuối đạt đủ. Không thay retry ngoại tuyến của ứng dụng để xử lý lỗi của bộ thử.

Rà cuối: `git diff --check` không lỗi; kiểm tra cú pháp các route/service mới không lỗi. Thư mục gốc vận hành sạch, `main` vẫn `f0c0a2b`; `/health` tại 3004 trả `OK`, `database=connected`, build `2026-10-09.7-mvp05`, migrations_pending rỗng. Đây là kiểm tra giữ nguyên bản vận hành, không phải nghiệm thu tính năng mới trên bản vận hành.

## Nghiệm thu và triển khai

Chưa áp dụng migration hoặc restart backend vận hành. Chưa commit/push nhánh mới, chưa có CI GitHub cho thay đổi này. Không đổi MVP-03/MVP-04 hoặc truy cập Samsung_T5.

Chưa có nội dung đầy đủ của **kịch bản 1–9 đã gửi trước đó** trong yêu cầu hiện tại để đối chiếu từng tiêu chí; không tự đánh dấu đạt. Toàn bộ bộ kiểm thử cũ của repo vẫn được chạy, chỉ thay kỳ vọng tự ghép theo tên vì yêu cầu mới cấm hành vi đó.

Khi nghiệm thu trên môi trường thử/đã triển khai, dùng công trình thử và tài khoản thử:

1. test.gst/test.ks: mở hồ sơ, thấy thông tin/scan; không có thêm/sửa/xóa hoặc Gợi ý gộp. Gọi trực tiếp API ghi trả 403.
2. test.gd: phân công người hết hạn; bỏ tích thì không phân công được. Tích Tôi đã biết thì phân công; audit có người, thời điểm, công trình, chứng chỉ.
3. CT-A/CT-B: hai hồ sơ cùng tên+số được gợi ý, vẫn hai người trước xác nhận. Gộp thì một hồ sơ còn hoạt động, đủ scan; Tách lại trả về hai hồ sơ và phân công cũ.
4. Cùng tên khác số: lý do Cần kiểm tra kỹ, Không gộp vẫn hai người; test.gst không vào được gợi ý/lịch sử.
5. Gửi duyệt báo cáo/BB hoặc Đóng biên bản hiện trường; sửa/xóa chứng chỉ gốc, bản chụp và scan lịch sử vẫn như trước.
6. Xóa công trình thử, kiểm tra hồ sơ và scan công ty còn nguyên.

Trước triển khai thật: sao lưu DB và kiểm tra khôi phục, sao lưu .env/uploads; triển khai migration bằng launcher hiện có, cập nhật main sau PR/CI, kiểm tra SHA/build/health và nghiệm thu trực tiếp. Giữ nguyên Docker volume và bản sao lưu.

## Giao diện hợp nhất ngày 10/10/2026

- Admin/Giám đốc chỉ có mục Hồ sơ nhân sự công ty. Bộ chọn gồm Nhân sự toàn công ty và các công trình; chọn công trình giữ nguyên phân công, tài khoản, quyền truy cập, chức danh và scan.
- Các vai trò khác chỉ có mục Nhân sự, bộ chọn giới hạn các công trình có quyền VIEW; API hồ sơ toàn công ty bị chặn 403. Chi tiết công trình dùng nhãn Nhân sự và mở đúng công trình.
- Áp dụng cho cả điện thoại và máy tính; không thay cơ chế row_version hoặc đồng bộ ngoại tuyến.
