@echo off
REM Chay kiem thu hoi quy tren CSDL thu rieng, ghi ket qua ra backend\tests\last-regression.txt
REM Cach dung: backend\scripts\run-regression.cmd [ten_csdl_thu] [keep]
REM   keep = giu lai CSDL thu sau khi chay (de kiem tra giao dien tren cong 3102)
setlocal
set DB=%1
if "%DB%"=="" set DB=vina_regr_%RANDOM%
REM CHOT AN TOAN: bo kiem thu XOA va TAO LAI CSDL duoc dat ten o day.
REM Chi cho phep ten bat dau bang "vina_reg" (hoac "vina_ui") de mot lan go nham
REM (vi du vina_supervision) khong the pha CSDL that.
echo %DB% | findstr /B /I "vina_reg vina_ui" >nul
if errorlevel 1 (
  echo TU CHOI: ten CSDL thu phai bat dau bang "vina_reg" vi bo kiem thu se XOA va TAO LAI CSDL nay. Nhan duoc: %DB%
  echo TU CHOI: ten CSDL thu phai bat dau bang "vina_reg". Nhan duoc: %DB%> "%~dp0..\tests\last-regression.txt"
  endlocal
  exit /b 2
)
set TEST_DB_URL=postgres://postgres:postgres@127.0.0.1:5435/%DB%
for /f "delims=" %%I in ('docker compose -f "%~dp0..\..\docker-compose.yml" ps -q postgres') do set DB_CONTAINER=%%I
if "%DB_CONTAINER%"=="" exit /b 3
cd /d %~dp0..
set OUT=%~dp0..\tests\last-regression.txt
echo RUNNING %DATE% %TIME% db=%DB%> "%OUT%"
node --test tests/regression.test.js >> "%OUT%" 2>&1
echo EXIT %ERRORLEVEL%>> "%OUT%"
if /I not "%2"=="keep" docker exec %DB_CONTAINER% psql -U postgres -d postgres -qc "drop database if exists %DB%" >nul 2>&1
echo DONE>> "%OUT%"
endlocal
