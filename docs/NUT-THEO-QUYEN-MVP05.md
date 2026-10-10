# Nút theo quyền tại công trình — MVP-05

Nhánh `codex/mvp05-nut-theo-quyen`, từ main `ea9230986935a3fad8f878c7f612cfce823cdd86` (đã đối chiếu origin/main). Build ứng viên `2026-10-10.1-mvp05`. Không đổi route, middleware, service phân quyền hoặc migration máy chủ. `backend/src/build.js` chỉ đổi mã build theo quy ước.

## Bảng nút → hàm giao diện → điều kiện máy chủ

`manager` dưới đây chỉ là `role_name` đúng `ADMIN` hoặc `DIRECTOR` của tài khoản máy chủ; không dò tên người, chức danh hoặc `db.role`. Quyền CREATE/EDIT/APPROVE/DELETE lấy từ `/project-members/my-permissions` theo đúng công trình. Lớp `permissionButtonPolicy` kiểm tra lại nút đã sinh, cả bảng và hộp thoại mở sẵn; HTTP 403 còn chặn đúng thao tác đã bị từ chối.

| Phân hệ / nút | Hàm kiểm tra giao diện | API / quyền máy chủ hiện có |
|---|---|---|
| Công trình: Thêm, Lưu mới | `canManageAssignments` | POST `/projects`: ADMIN/DIRECTOR |
| Công trình: Sửa, Lưu sửa | `canEditProject(pid)` | PATCH `/projects/:id`: APPROVE tại công trình |
| Bảng tiến độ: Thêm/Sửa/Lưu | `canEditProject(pid)` | POST/PATCH `/projects/:id/progress-plans`: APPROVE |
| Bảng tiến độ: Xóa | `canDeleteIn(pid)` | DELETE `/projects/:id/progress-plans/:planId`: DELETE |
| Tiến độ: cập nhật thực tế | `canUpdateActual(pid)` | POST `.../actuals`: CREATE |
| Công trình: Gói thầu, thêm/sửa/xóa gói, nhà thầu, hạng mục | `canManageAssignments` | `/bidding-packages`, `/bidding-contractors`: ADMIN/DIRECTOR |
| Công trình: Duyệt/Trả lại/Khóa/Mở lại/Trình công ty/Xóa công trình | Không có nút hoặc workflow này | Không có API tương ứng; không thêm quyền hoặc chức năng xóa công trình |
| Báo cáo ngày: Thêm | `canCreateLogIn(pid)`, `uiAnyCreate` | POST `/daily-logs`: CREATE |
| Báo cáo ngày: Sửa, Lưu | `canEditLog` | PATCH `/daily-logs/:id`: không LOCKED; manager hoặc người lập có CREATE khi DRAFT |
| Báo cáo ngày: Gửi duyệt | `canSubmitLog`, `uiLogAction` | POST `.../submit`: DRAFT, manager hoặc người lập có CREATE |
| Báo cáo ngày: Xác nhận nháp của mình | `canSubmitLog` + `canApproveIn` | POST `.../confirm`: DRAFT, người lập/manager + APPROVE |
| Báo cáo ngày: Duyệt, Trả lại | `uiLogAction`, `canApproveIn` | POST `.../approve`, `.../reject`: SUBMITTED, APPROVE; đã ESCALATE chỉ manager quyết định |
| Báo cáo ngày: Khóa | `uiLogAction`, `canApproveIn` | POST `.../lock`: APPROVED, APPROVE |
| Báo cáo ngày: Mở lại | `canReopenLog` | POST `.../reopen`: không DRAFT; manager hoặc EDIT tại công trình |
| Báo cáo ngày: Trình công ty | `uiLogAction`, quyết định đang mở | POST `.../escalate`: SUBMITTED, APPROVE, không manager, chưa ESCALATE |
| Báo cáo ngày: Xóa | `canDeleteIn`, `deleteBtn` | DELETE `/daily-logs/:id`: DELETE, lý do; vào Thùng rác |
| Báo cáo ngày: Gửi/Duyệt/Khóa hàng loạt | `uiLogAction` cho từng ID + điều kiện tạo thanh nút cũ | POST `/daily-logs/bulk`: kiểm từng bản theo cùng workflow, quyền và chủ sở hữu |
| Hồ sơ / báo cáo tổng hợp: Thêm | `canCreateDocIn(pid)`, `uiAnyCreate` | POST `/documents`: CREATE |
| Hồ sơ: Sửa, Lưu | `canModifyDoc` | PATCH `/documents/:id`: không LOCKED; manager hoặc DRAFT có EDIT / người lập có CREATE |
| Hồ sơ: Gửi duyệt | `uiDocAction`, `canModifyDoc` | POST `.../submit`: DRAFT, điều kiện sửa hồ sơ |
| Hồ sơ: Duyệt, Trả lại | `uiDocAction`, `docCanDecide` | POST `.../approve`, `.../reject`: SUBMITTED, APPROVE; ESCALATE chỉ manager quyết định |
| Hồ sơ: Khóa | `uiDocAction`, `canApproveIn` | POST `.../lock`: APPROVED, APPROVE |
| Hồ sơ: Mở khóa | `uiDocAction`, `canApproveIn` | POST `.../reopen`: LOCKED, APPROVE, lý do |
| Hồ sơ: Trình công ty | `uiDocAction`, quyết định đang mở | POST `.../escalate`: SUBMITTED, APPROVE, không manager, chưa ESCALATE |
| Hồ sơ: Xóa | `canDeleteIn`, `deleteBtn` | DELETE `/documents/:id`: DELETE, lý do; vào Thùng rác |
| Hồ sơ: Xóa tệp của bản nháp | `canModifyDoc` | DELETE `/documents/:id/files/:fileId`: quyền sửa hồ sơ, không phải quyền DELETE bản ghi |
| Báo cáo tổng hợp: nút lưu/gửi/duyệt/xóa | Cùng `canModifyDoc`, `uiDocAction`, `canDeleteIn` | Cùng `/documents` (không đổi workflow) |
| Văn bản chất lượng: Thêm | `qualityCanCreate(pid)`, `uiAnyCreate` | POST `/issues`: CREATE hoặc EDIT |
| Văn bản chất lượng: Sửa, Lưu | `qualityCanEdit` | PATCH `/issues/:id`: manager / EDIT; người lập có CREATE chỉ khi chưa RESOLVED/CLOSED/SIGNED/ISSUED |
| Văn bản chất lượng: Đóng | `qualityCanClose` | POST `.../resolve`: quyền sửa văn bản; đã đóng không cần hiện nút đóng lại |
| Văn bản chất lượng: Mở lại | `qualityCanReopen` | POST `.../reopen`: manager hoặc EDIT |
| Văn bản chất lượng: Xóa | `canDeleteIn`, `deleteBtn` | DELETE `/issues/:id`: DELETE, lý do; vào Thùng rác |
| Văn bản chất lượng: Duyệt/Trả lại/Khóa/Trình công ty | Không có workflow duyệt kiểu documents | Máy chủ dùng trạng thái phát hành/ký/đóng và resolve/reopen; không tự tạo quyền mới |
| Hồ sơ nhân sự công ty: Thêm/Sửa/Lưu/Xóa hồ sơ | `canManageAssignments` | POST/PUT/DELETE `/company-personnel`: ADMIN/DIRECTOR |
| Hồ sơ nhân sự: thêm/sửa/xóa chứng chỉ | `canManageAssignments` | POST/PUT/DELETE `.../certificates`: ADMIN/DIRECTOR |
| Hồ sơ nhân sự: thêm/xóa scan | `canManageAssignments` | POST/DELETE `.../files`: ADMIN/DIRECTOR |
| Hồ sơ nhân sự: gợi ý, gộp, không gộp, tách | `canManageAssignments` | `/company-personnel/suggestions`, `/merges`, `/merges/:id/undo`: ADMIN/DIRECTOR |
| Hồ sơ nhân sự: phân công, sửa phân công | `canManageAssignments` | `/project-personnel`, `/project-members`: ADMIN/DIRECTOR; cảnh báo hết hạn và audit không đổi |
| Hồ sơ nhân sự: Duyệt/Trả lại/Khóa/Mở lại/Trình công ty | Không có workflow này | Không có API tương ứng |

## Tải lại quyền và HTTP 403

- `loadQualityPermissions` chuyển tới `refreshUiPermissions`: đọc tài khoản của chính mình qua GET `/users/:id`, sau đó đọc bản đồ quyền. Cập nhật cache chỉ sau khi cả hai yêu cầu thành công, token và lượt tải còn đúng; gộp các yêu cầu đang chạy. Khi mất mạng giữ cache ngoại tuyến; không lấy lại cache cũ để đè quyền vừa được máy chủ xác nhận.
- Tải lại khi load/pageshow, trở lại trạng thái visible, online, mở chi tiết công trình và đổi công trình ở bộ lọc/biểu mẫu. Cập nhật bảng, thanh nút và nút trong modal mà không thay HTML/nội dung modal, không xóa tệp hoặc hàng đợi.
- HTTP 403: ẩn nút tương ứng ngay, hiện `Quyền của bạn đã thay đổi`, tải lại quyền để cập nhật các nút khác. Giữ chặn thao tác bị từ chối trong lượt tải do 403; lượt tải lifecycle thành công cho phép kiểm tra quyền được cấp lại. Không áp dụng thông báo này cho MUST_CHANGE_PASSWORD; luồng đổi mật khẩu giữ nguyên.
- Các nút nạp bất đồng bộ được kiểm lại bằng MutationObserver chỉ theo childList. Không eval onclick; chỉ đọc tên hàm và tham số literal do ứng dụng sinh.
- Nút “Xem xét” lấy trạng thái từ mục trong danh sách duyệt trên máy chủ; bản nháp riêng của cùng ID không được dùng để ẩn nhầm nút. Nút quyết định trong hộp duyệt kiểm bản máy chủ vừa tải, không thay nội dung bản nháp riêng.
- Đây là lớp giao diện; API vẫn kiểm tra quyền. Không thay row_version, đồng bộ ngoại tuyến, quyền máy chủ hoặc dữ liệu thật.

## File sửa — trước và sau

| File | Trước | Sau |
|---|---|---|
| `js/01-core.js` | canEdit theo nhãn vai trò; modal không cập nhật nút; đọc tệp 403 chỉ báo lỗi | Bỏ canEdit sau rà hết nơi dùng; kiểm nút khi mở modal; bắt 403 đọc tệp |
| `js/02-quyen.js` | canManageAssignments dò tên; tải quyền chỉ vẽ vài bảng, lỗi lấy cache cũ | Role code chính xác; dùng refreshUiPermissions; qualityIsManager cùng điều kiện |
| `js/03-cong-trinh.js` | saveProject gọi canEdit; mở chi tiết không refresh quyền | Kiểm canEditProject(pid) / canManageAssignments cho tạo mới; refresh khi đổi chi tiết |
| `js/06-ho-so.js` | 403 có hướng dẫn suy đoán restart máy chủ | Bỏ hướng dẫn sai; giữ lỗi quyền mới và dữ liệu chưa đồng bộ |
| `js/08-chat-luong.js` | Tạo khi chưa có auth; người lập có CREATE còn thấy sửa ISSUED | Nút thêm theo quyền; điều kiện sửa khớp trạng thái máy chủ |
| `js/11-duyet.js` | Inbox can_review cũ có thể giữ menu duyệt | Menu theo quyền vừa tải; không dùng fallback inbox cũ |
| `js/18-quyen-nut.js` (mới) | Chưa có lớp cập nhật chung | Map nút/HTTP; refresh; giữ modal; chặn nút khi 403 |
| `api.js` | 403 chỉ ném lỗi; tải tệp chưa cập nhật quyền | Thông báo quyền đổi, xử lý 403 cho JSON và binary; không đổi logic hàng đợi |
| `index.html`, `sw.js` | Shell chưa có tệp kiểm nút | Nạp/cache tệp mới; cache build mới |
| `backend/src/build.js`, `js/14-dang-nhap.js` | Build .8 ngày 09/10 | Build ứng viên 2026-10-10.1-mvp05; không restart backend vận hành |
| `backend/tests/ui/cases/17-permission-buttons.js` (mới), `backend/tests/ui/all.test.js` | Chưa có ca lifecycle/403 giữ modal | Thêm ca năm vai trò, workflow, sửa công trình B, refresh và 403 giữ dữ liệu |
| Tài liệu cập nhật/kiểm thử | Chưa có bảng rà nút | Tài liệu này, changelog và kết quả thực tế |
| `CLAUDE.md`, `docs/CODEMAP.md` | Chưa có chỉ dẫn module quyền nút | Thêm vị trí hàm, quy tắc và đường dẫn kiểm thử |
| `backend/tests/ui/cases/13-edit-conflicts.js` | Đếm tệp ngay sau Lưu, có thể trùng lúc tự đồng bộ đang gửi | Chờ lượt gửi kết thúc rồi kiểm tra số tệp và số lần PATCH/upload; giữ nguyên tiêu chí |

## Kiểm thử

Đạt 191/191: API 46, phân quyền 22, xung đột 6, nhân sự 11, JavaScript unit 6, Chrome 100. PWA/shell ngoại tuyến đạt; cú pháp 0 lỗi. Chi tiết và các lỗi đã xử lý ghi trong `KET-QUA-KIEM-THU-20260926.md`. DB thử có tiền tố `vina_reg_buttons_20261010_*` / `vina_ui_buttons_20261010_*`, backend thử 3101/3103/3111/3112/3115; uploads thử riêng trong runtime-logs. Không dùng DB vận hành làm đích reset.

Không tự commit/push/merge hoặc triển khai bản vận hành trong yêu cầu sửa giao diện này.
