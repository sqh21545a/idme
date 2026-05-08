@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  npm install
)
node src\idme.js --url https://api.id.me/en/session/new --headed --proxy http://wXYSygNq:rIj4WNT75PF12hPb@us.proxy302.com:2222
pause
