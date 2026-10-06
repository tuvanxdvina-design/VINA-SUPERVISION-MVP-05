# Trạng thái MVP-05

Đang triển khai chống ghi đè `row_version` trên nhánh `codex/mvp05-optimistic-concurrency`, build `2026-10-06.1-mvp05`. Main ban đầu `d4221a1` chưa có cơ chế này; không có PR mở khi kiểm tra.

Đã bổ sung SQL so sánh phiên bản nguyên tử cho projects/daily_logs/documents/issues, trigger tăng phiên bản, giữ biểu mẫu và hàng đợi xung đột, xuất bản nháp/tải bản mới có xác nhận. Giữ gói thầu, mẫu báo cáo ngày và nhiều người nhận của MVP-05; không đổi MVP-03/MVP-04.

Quy trình: GitHub Actions chạy kiểm thử; Codex kiểm tra cú pháp, diff và kết quả đúng commit. Kết quả Windows phiên trước không chứng minh nhánh này. Chưa triển khai vào Windows hay DB thật; nghiệm thu hai thiết bị thật còn lại. Hướng dẫn: `docs/CAP-NHAT-MVP05-ROW-VERSION.md`.
