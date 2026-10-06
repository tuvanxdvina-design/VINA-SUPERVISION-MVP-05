# Trạng thái MVP-05

Đang triển khai chống ghi đè `row_version` trên nhánh `codex/mvp05-optimistic-concurrency`, build `2026-10-06.2-mvp05`, PR #1 đang mở. Main ban đầu `d4221a1` chưa có cơ chế này.

Bản .2 sửa thử lại hồ sơ sau lỗi tải tệp/GET bằng checkpoint metadata và hàng đợi tệp bền vững. Thêm 3 ca UI: thử lại upload không lặp PATCH/tệp, GET lỗi rồi tải lại trang, sửa tiếp sau lỗi upload vẫn phát hiện thay đổi của người khác. Kiểm tra cú pháp đạt; kết quả Actions phải tra theo commit mới, không dùng kết quả của `5158600` để kết luận cho bản .2.

Đã bổ sung SQL so sánh phiên bản nguyên tử cho projects/daily_logs/documents/issues, trigger tăng phiên bản, giữ biểu mẫu và hàng đợi xung đột, xuất bản nháp/tải bản mới có xác nhận. Giữ gói thầu, mẫu báo cáo ngày và nhiều người nhận của MVP-05; không đổi MVP-03/MVP-04.

Quy trình: GitHub Actions chạy kiểm thử; Codex kiểm tra cú pháp, diff và kết quả đúng commit. Kết quả Windows phiên trước không chứng minh nhánh này. Chưa triển khai vào Windows hay DB thật; nghiệm thu hai thiết bị thật còn lại. Hướng dẫn: `docs/CAP-NHAT-MVP05-ROW-VERSION.md`.
