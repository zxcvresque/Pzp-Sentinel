@echo off
REM PzP Sentinel — dev start (Windows)

echo.
echo   PzP Sentinel
echo   Platform: Windows
echo   Starting Next.js + Telegram Bot...
echo.

npx concurrently --names "next,bot" --prefix-colors "green,magenta" --kill-others "npm run dev" "npm run bot:dev"
