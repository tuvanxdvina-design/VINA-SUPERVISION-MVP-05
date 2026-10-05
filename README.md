# VINA-SUPERVISION MVP-05 - ban cai tien chay doc lap

MVP-05 duoc tao ngay 05/10/2026 tu MVP-04 de tiep tuc kiem tra va hoan thien loi con ton tai. Day la **ban cai tien chay doc lap**, khong ghi de MVP-03 hoac MVP-04.

## Dia chi

- Giao dien phu: `http://localhost:8083/`
- Giao dien/API chinh: `http://localhost:3004/`
- Health: `http://localhost:3004/health`
- PostgreSQL Docker: cong may `5435`
- Database: `vina_supervision_mvp05`

| Ban | Giao dien | API | PostgreSQL | Database |
|---|---:|---:|---:|---|
| MVP-03 | 8081 | 3002 | 5433 | `vina_supervision` |
| MVP-04 | 8082 | 3003 | 5434 | `vina_supervision_mvp04` |
| MVP-05 | 8083 | 3004 | 5435 | `vina_supervision_mvp05` |

## Cai dat

1. Cai Docker Desktop, Node.js va Python.
2. Mo PowerShell tai thu muc `VINA-SUPERVISION-MVP-05`.
3. Cai thu vien backend:

```powershell
cd backend
npm ci
cd ..
```

4. Tao `backend\.env` tu `backend\.env.example`.
5. Doi `DB_PASSWORD` va `JWT_SECRET` thanh chuoi rieng.
6. Chay:

```powershell
.\run.bat
```

## Kiem tra

Mo:

```text
http://localhost:3004/health
```

Ket qua can co:

- `status: OK`
- `database: connected`
- `migrations_pending: []`

## Su dung

Mo ung dung tai:

```text
http://localhost:3004/
```

Hoac duong giao dien phu:

```text
http://localhost:8083/
```

Nen dung `http://localhost:3004/` khi kiem thu vi duong nay lay truc tiep ma nguon moi nhat.

## Kiem thu nhanh

```powershell
backend\scripts\run-regression.cmd
backend\scripts\run-ui-tests.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File .\backup-db.ps1 -Label manual
```

## Chay tren nhieu thiet bi

MVP-05 hien chi chay local. Neu can mo qua Tailscale, dung:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\enable-tailnet.ps1
```

Phai dang ky dia chi rieng cho MVP-05, khong dung chung dia chi cua MVP-03 hoac MVP-04.

## Ghi chu

- MVP-05 la ban cai tien doc lap.
- Khong dung chung database voi MVP-03/MVP-04.
- Khong dung chung cong voi MVP-03/MVP-04.
- Cac tai lieu cu trong repo chi de tham khao lich su; huong dan chinh cua MVP-05 la file README nay.
