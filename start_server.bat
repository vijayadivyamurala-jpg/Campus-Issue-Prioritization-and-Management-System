@echo off
cd /d "%~dp0"
echo Starting Campus Issue Management backend...
echo Open: http://127.0.0.1:5000/index.html
start "" "http://127.0.0.1:5000/index.html"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Start-Process python -ArgumentList 'app.py' -WorkingDirectory '%~dp0' -PassThru; " ^
  "$p.Id | Set-Content '%~dp0server.pid'; " ^
  "Wait-Process -Id $p.Id"
