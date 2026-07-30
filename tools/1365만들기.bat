@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem ===================================================================
rem  1365 자원봉사활동 인증신청서 만들기
rem
rem  ★ 아래 두 줄만 한 번 채우면 됩니다 (worker/README.md 참고)
rem ===================================================================
set CLASS_API=
set ADMIN_KEY=

if "%CLASS_API%"=="" (
  echo.
  echo  [설정 필요] 이 파일을 메모장으로 열어 CLASS_API 와 ADMIN_KEY 를 채워 주세요.
  echo.
  pause
  exit /b
)

rem 처음 한 번만 — 엑셀을 다루는 도구를 설치합니다
python -c "import openpyxl" 2>nul || (
  echo  엑셀 도구를 설치합니다. 잠시만 기다려 주세요...
  python -m pip install --quiet openpyxl
)

rem 달을 안 적으면 이번 달로 만듭니다.  예) 1365만들기.bat 2026-07
python make_1365.py %1

echo.
pause
