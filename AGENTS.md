# VICOAD cho VINA Supervision

Trả lời tiếng Việt, hành động trong phạm vi người dùng giao; chỉ hỏi khi thiếu thông tin chặn triển khai hoặc cần quyết định quan trọng. Giữ thay đổi có sẵn. Hướng dẫn này bổ sung quy ước kỹ thuật tại CLAUDE.md và docs/CODEMAP.md; yêu cầu người dùng hiện tại có ưu tiên với thỏa thuận công cụ cũ.

## Định tuyến yêu cầu

Chọn và đọc SKILL.md phù hợp dưới plugins/vicoad/skills/ (đường dẫn tính từ repo), không nạp cả 7:

| Yêu cầu | Skill |
|---|---|
| Hỏi nhanh/giải thích ngắn | vicoad-quick |
| Phân tích nguyên nhân, phương án, yêu cầu | vicoad-analyze |
| Lỗi/log/API/Docker/PostgreSQL | vicoad-debug |
| Thiết kế DB/API/quyền/module | vicoad-design |
| Thực hiện sửa code/migration/test | vicoad-implement |
| Review diff, hồi quy, bảo mật | vicoad-review |
| Báo cáo ngày/nghiệm thu/báo cáo/hồ sơ TVGS | vicoad-tvgs |

Yêu cầu sửa lỗi: debug rồi implement. Kết hợp tvgs với design/implement nếu cần; đừng kết thúc ở kế hoạch khi người dùng đã giao triển khai. Các tên $vicoad-* là cách gọi tắt trong yêu cầu; nếu plugin chưa cài, đọc file tương ứng trực tiếp theo bảng trên. Đây là routing bằng hướng dẫn, không tự đổi model.

Không chạy run.bat/start-dev.ps1/migrate-db.ps1 để kiểm tra plugin. Không thay production/DB thật hoặc restart backend đang dùng khi chưa thuộc phạm vi. Plugin/tài liệu thuần không đổi build runtime và không cần bộ test DB. Chi tiết: plugins/vicoad/references/project-context.md.

## Quy định sử dụng AI và công cụ (07/10/2026)

Áp dụng cho công việc tiếp theo của MVP-05; xem [quy trình đổi JWT](docs/DOI-JWT-VA-QUY-DINH-AI-MVP05.md). Giữ MVP-03/MVP-04 ở chế độ chỉ đọc khi cần đối chiếu; Samsung_T5 nằm ngoài phạm vi truy cập.

| Công việc | Cách xử lý bắt buộc |
|---|---|
| Sinh/đổi/so sánh khóa, sao lưu, đối chiếu tệp | Lệnh hoặc script chạy tại máy đích. Không đưa giá trị bí mật vào đầu vào/đầu ra AI; chỉ trả kết quả đạt/khác/thiếu/lỗi đã che bí mật. |
| Câu hỏi, tài liệu, sửa nhỏ rõ phạm vi | Chỉ đọc các đoạn liên quan; dùng mức xử lý thấp nhất đủ hoàn thành khi phiên có lựa chọn. Không nạp toàn bộ repo hoặc gọi nhiều AI để làm cùng một việc. |
| Phân quyền, xác thực, xung đột, migration | Codex phân tích chuỗi UI/API/SQL liên quan và kiểm tra tác động; dùng mức xử lý phù hợp với rủi ro. Không thay đổi chính sách nghiệp vụ để làm kiểm thử đạt. |
| Kiểm thử hồi quy/API/UI khi sửa mã | GitHub Actions chạy; Codex đọc kết quả đúng commit, số ca và trạng thái. Cú pháp/diff có thể kiểm tra cục bộ. Tài liệu thuần không cần tạo thêm bộ kiểm thử nghiệp vụ. |
| Nghiệm thu bằng tay và vận hành Windows | Agent/công cụ thực thi trên Windows hoặc người vận hành làm; phiên cloud chỉ báo điều đã quan sát, không nhận localhost cloud là máy Windows. |
| Plugin, bộ nhớ AI | Chỉ dùng khi cần cho nhiệm vụ; không đưa .env, khóa, token, mật khẩu, bản sao lưu hay tệp chứa bí mật vào bộ nhớ/index/context. Không chạy /learn-codebase trên dự án có dữ liệu thật mà chưa giới hạn nguồn. |

Không khẳng định tự chuyển model/chatbot khi công cụ không hỗ trợ. Nếu không thể chọn model, giữ phiên hiện có, giới hạn dữ liệu cần đọc và báo rõ giới hạn khi liên quan. Đây là quy định làm việc, không phải bảo đảm tiết kiệm token hoặc cơ chế chặn kỹ thuật mọi plugin.

Trước khi đổi JWT trên máy đang dùng, phải có xác nhận của người vận hành rằng đã thông báo lịch và mọi người đã đồng bộ hoặc xuất giữ bản nháp/tệp còn chờ. Không suy ra xác nhận đó từ việc API đang khỏe. So sánh khóa giữa các bản bằng script chỉ xuất boolean; không dùng `findstr JWT_SECRET`, không in hash/giá trị khóa vào chat/log/ảnh. Không sửa JWT của MVP-03/MVP-04.

Khi đổi khóa phải thực sự khởi động lại backend MVP-05, kể cả build không đổi. Kiểm tra quyền sở hữu tiến trình trước khi dừng; không dừng toàn bộ node/python/Docker. Đạt /health chưa đủ chứng minh đăng nhập hoặc đồng bộ đạt. Ghi riêng trạng thái chuẩn bị, đã đổi, đã restart, đã kiểm tra tài khoản và đã dọn bản sao lưu.
