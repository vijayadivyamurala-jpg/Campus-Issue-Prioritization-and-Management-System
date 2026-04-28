@echo off
cd /d "%~dp0"
if not exist server.pid (
    echo No saved server PID found.
    exit /b 0
)

set /p SERVER_PID=<server.pid
echo Stopping project server with PID %SERVER_PID%...
taskkill /PID %SERVER_PID% /F
del server.pid
