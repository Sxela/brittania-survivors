@echo off
cd /d "%~dp0"
if not exist game\assets\mobile-locations\manifest.json node tools\build-mobile.mjs
node tools\start-mobile.mjs
pause
