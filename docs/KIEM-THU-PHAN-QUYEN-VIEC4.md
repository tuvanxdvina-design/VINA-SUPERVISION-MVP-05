# Việc 4 — phân quyền MVP-05 và nghiệm thu

Quy tắc đã được xác nhận: tài khoản ENGINEER được Admin/Giám đốc phân công chức danh Giám sát trưởng có quyền duyệt tại đúng công trình đó. Quyền tùy chỉnh thay mặc định của phân công. Không thay quy tắc chỉ vì loại tài khoản khác chức danh.

## Bản sửa

Build ứng dụng: `2026-10-07.1-mvp05`. Không thêm migration hoặc thay khóa JWT. Không sửa MVP-03/MVP-04.

- Kiểm tra quyền VIEW hiệu lực, gồm trạng thái/thời hạn phân công và quyền tùy chỉnh, trên các đường truy cập công trình. Quyền rỗng `[]` thực sự không có quyền; `null` dùng mặc định.
- Lọc danh sách công trình và hộp việc đã duyệt/bị trả lại khi không còn VIEW. Kiểm tra DOWNLOAD trên tệp báo cáo, ảnh, hồ sơ, chất lượng, công trình, tiến độ và chứng chỉ.
- Báo cáo/hồ sơ LOCKED không sửa hoặc thêm tệp trực tiếp, kể cả Admin/Giám đốc. Phải mở lại theo luồng có ghi audit trước khi sửa. Không cấm thao tác mở lại đã có trong ứng dụng.
- API chi tiết báo cáo trả quyền sửa theo người gọi, lịch sử duyệt mới nhất và số tệp để giao diện nhận đúng trạng thái sau tải lại.
- Giao việc chất lượng dựa quyền EDIT tại công trình, không dựa loại tài khoản TVGS_LEAD chung.
- Giao diện không tự tích lại APPROVE của một phân công tùy chỉnh; hiển thị đúng quyền rỗng. Giữ biểu mẫu và hàng đợi/tệp khi máy chủ từ chối lưu.
- Lưu chức danh/quyền của nhân sự không có gói thầu không còn ép chuỗi rỗng thành UUID. Trường gói thầu không gửi giữ nguyên giá trị cũ.
- Giữ quy tắc riêng: nháp báo cáo ngày chỉ tác giả/Admin/Giám đốc thấy; hồ sơ và văn bản chất lượng có quy trình khác nhau. Xóa thường vào thùng rác; chỉ Admin purge.

Quyền DOWNLOAD điều khiển đường lấy tệp và chức năng xuất trong ứng dụng. Quyền này không thể ngăn người đã được VIEW sao chép nội dung nhìn thấy hoặc tệp đã tải trước khi bị thu hồi quyền. Tab đang mở cần tải lại quyền để nút cập nhật; API kiểm tra lại quyền trên mỗi yêu cầu.

## Kiểm thử do GitHub Actions chạy

Workflow `.github/workflows/kiem-thu.yml` chạy trên PostgreSQL tạm, dùng DB riêng `vina_reg_permissions_ci` cho bộ phân quyền và `vina_ui_ci` cho trình duyệt. Test helper chỉ chấp nhận DB `vina_reg*`/`vina_ui*`; không chạy trên DB thật. Năm tài khoản thử được tạo bằng API, đổi mật khẩu ban đầu rồi mới dùng; mỗi ca có ba công trình riêng.

Codex đối chiếu kết quả đúng SHA trong PR/Actions. Cú pháp/build/diff kiểm tra ở cloud; bộ nghiệp vụ chạy trên GitHub. Số ca và kết quả cuối cùng xem báo cáo Actions và PR, không suy ra từ tên ca hoặc việc workflow đã khởi động.

| Kịch bản gốc | API | Trình duyệt Chrome tự động |
|---|---|---|
| 1. Kỹ sư A tạo/sửa của mình, không duyệt/sửa người khác | PQ01, PQ06 | GD-06, GD-09; ma trận GD-PQ ks |
| 2. ENGINEER làm GST ở B được duyệt | PQ02 | GD-PQ ks: bấm duyệt thật ở B |
| 3. Không phân công C không thấy/truy cập được | PQ03 | GD-PQ ks: phạm vi CT và API |
| 4. GST A duyệt/trả lại/khóa/trình | PQ04, PQ07 | GD-07, GD-08, GD-10, GD-PQ GST/trình công ty |
| 5. TVGS_LEAD làm Kỹ sư/Phó ở B/C không duyệt | PQ05 | GD-PQ gst: nút và quyền A/B/C |
| 6. Nháp báo cáo riêng | PQ06 | GD-24 và GD-PQ nháp riêng |
| 7. Trình công ty chặn GST tự quyết | PQ07 | GD-PQ trình công ty |
| 8. MANAGER chỉ xem/tải | PQ08 | GD-PQ ql: quyền và nút sửa/duyệt/xóa |
| 9. Giám đốc thấy tất cả, xóa vào thùng rác | PQ09 | GD-PQ gd và thùng rác |
| 10. Chỉ Admin purge | PQ10 | GD-PQ thùng rác: Admin bấm purge, Giám đốc bị chặn |
| 11. Thu hồi phân công khi đang nhập | PQ11 | GD-PQ đang nhập: ba phân hệ đều giữ nội dung sau 403 |
| 12. Hết hạn phân công | PQ12 | GD-PQ hết hạn: CT ẩn, API chi tiết bị chặn |
| 13. DELETE tùy chỉnh chỉ ở A | PQ13 | GD-PQ tùy chỉnh: nút xóa A/B, đường tải tệp |

Ca bổ sung PQ14–PQ21 kiểm tra quyền rỗng, bỏ DOWNLOAD, bỏ APPROVE, không tự nâng chức danh, ưu tiên chức danh nhân sự, LOCKED, hộp việc sau thu hồi quyền và lưu nhân sự với gói thầu trống/giữ gói cũ. GD-PQ bổ sung kiểm tra trình chỉnh quyền tùy chỉnh và ngoại tuyến trên báo cáo ngày/hồ sơ/chất lượng: bản nhập, hàng đợi và nội dung tệp còn đủ, máy chủ không bị thay đổi sau thu hồi phân công. Các ca GD-OCC cũ vẫn kiểm tra bản nháp không bị phản hồi tải lại ghi đè và thử lại tệp không tải trùng.

Lặp quyền xem/thêm/sửa/phạm vi công trình cho cả ba phân hệ. Văn bản chất lượng thử đóng/mở lại, không dùng cùng chuỗi gửi duyệt/duyệt/trả lại/khóa của báo cáo và hồ sơ. Ca trình duyệt tự động không thay cho nghiệm thu thủ công Chrome/Edge trên Windows.

## Cập nhật Windows sau khi PR được rà soát và merge

Chưa tự triển khai hoặc merge. Không chạy các lệnh dưới đây trước khi bản sửa được chấp thuận. Agent Windows/người vận hành thực hiện; localhost cloud không phải máy đang dùng.

1. Chọn thời gian cập nhật, giữ/xuất bản nhập và tệp chưa đồng bộ. Sao lưu DB bằng `backup-db.ps1`, kiểm tra khôi phục bằng `verify-backup.ps1` vào DB thử riêng. Sao lưu thư mục uploads thực tế và cấu hình `.env` tại nơi riêng có quyền truy cập hạn chế; không in khóa/token hoặc đưa vào Git. Không truy cập Samsung_T5.
2. Tại thư mục MVP-05 đang dùng, kiểm tra `git status --short`. Nếu còn sửa cục bộ hoặc lỗi khóa Git, giữ bản đó để đối chiếu; không `reset --hard`, `clean` hoặc xóa thư mục để cưỡng ép cập nhật.
3. Khi cây làm việc phù hợp, chạy `git fetch origin`, `git switch main`, `git pull --ff-only` và kiểm tra `git log -1 --oneline` khớp main đã merge PR này. Giữ nguyên `.env`, uploads, backups và Docker volume MVP-05.
4. Khởi động bằng `run.bat`/launcher của dự án. Nếu cần dừng backend cũ, xác định đúng tiến trình MVP-05; không dừng tất cả Node, Docker hoặc MVP-03/MVP-04. Bản sửa này không yêu cầu migration mới, nhưng vẫn kiểm tra migration còn chờ.
5. Chạy kiểm tra bên dưới; lỗi kết nối phải dừng, không đếm migration trên biến null hoặc biến cũ:

```powershell
$ErrorActionPreference = 'Stop'
$health = $null
$health = Invoke-RestMethod 'http://127.0.0.1:3004/health' -TimeoutSec 10 -ErrorAction Stop
if ($null -eq $health -or $health.status -ne 'OK' -or $health.database -ne 'connected') {
    throw 'Backend/DB MVP-05 chua dat'
}
if ($health.build -ne '2026-10-07.1-mvp05') { throw 'Build chua dung ban phan quyen' }
if ($null -eq $health.migrations_pending -or @($health.migrations_pending).Count -ne 0) {
    throw 'Chua xac nhan migration da day du'
}
$health | Select-Object status, database, build, migrations_pending
```

Sau cập nhật, truy cập trang đăng nhập MVP-05 qua launcher/cấu hình đang dùng và kiểm tra đúng build; không suy ra frontend đã chạy từ /health backend. Dùng hai phiên Chrome/Edge thử các kịch bản gốc trên dữ liệu thử, đặc biệt quyền A/B/C, từ chối lưu khi tab còn mở, quyền tải tệp, bản LOCKED và online lại với hàng đợi. Không ghi mật khẩu/token vào ảnh/log.

Nếu khởi động lỗi: giữ bản mới, log và bản sao cũ để rà soát. Không tự khôi phục DB hoặc đổi JWT. Bản cũ có các khoảng trống phân quyền được sửa ở PR này, nên việc quay lại cần người vận hành đánh giá; không coi rollback là nghiệm thu đạt.

## Chốt nghiệm thu

Ghi mỗi ca: mã ca, build/SHA, môi trường, tài khoản, CT, ID bản ghi, thao tác, HTTP/UI, trạng thái và row_version trước/sau, kết quả ĐẠT/LỖI/CHƯA CHẠY, mức độ, ảnh/log đã che bí mật. Lỗi quyền/mất dữ liệu/sửa LOCKED trái quy tắc là nghiêm trọng. Nút hiện nhưng chặn chức năng hợp lệ có thể là trung bình, không luôn là lỗi nhẹ.

Tách ba mốc: **mã và CI đã đạt**, **đã cập nhật Windows**, **đã nghiệm thu trên Windows**. Chỉ chốt Việc 4 ở máy đang dùng khi đủ các ca áp dụng và không còn lỗi nghiêm trọng. Giữ bằng chứng trước khi dọn công trình/tài khoản thử; không xóa dữ liệu thật hoặc bản sao lưu vận hành.
