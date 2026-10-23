@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3 and try again.
  pause
  exit /b 1
)

python -c "import fastapi, uvicorn, requests, bs4" >nul 2>nul
if errorlevel 1 (
  echo CricFreeX dependencies are missing.
  echo Run: python -m pip install -r requirements.txt
  pause
  exit /b 1
)

echo Starting CricFreeX at http://127.0.0.1:8765
echo Keep this window open while using the site.
python -m uvicorn main:app --host 127.0.0.1 --port 8765
if errorlevel 1 (
  echo CricFreeX stopped. Check whether port 8765 is already in use.
  pause
)
