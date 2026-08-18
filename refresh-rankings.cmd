@echo off
REM ---------------------------------------------------------------------------
REM Refresh The Fantasy Footballers rankings snapshot (ffb-rankings.js).
REM
REM Double-click this file, wait for it to finish, then reload the tier board in
REM your browser. Your tiers and your ordering are NOT touched - only the FFB
REM ranking numbers, and any player who has newly climbed into your top N gets
REM added at the bottom of that position for you to place.
REM
REM Needed because the Footballers' site only allows its own domain to read those
REM pages, so the browser cannot fetch them itself.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on your PATH, so the rankings cannot be refreshed.
  echo Install Node from https://nodejs.org and run this again.
  echo Your existing rankings are unchanged.
  echo.
  pause
  exit /b 1
)

echo Refreshing The Fantasy Footballers rankings ^(full PPR^)...
echo This opens their pages in a background browser and takes about a minute.
echo.

node dev\fetch-ffb.js

if errorlevel 1 (
  echo.
  echo REFRESH FAILED - your previous rankings are still in place, unchanged.
  echo If their page layout changed, dev\fetch-ffb.js needs a look.
) else (
  echo.
  echo Done. Reload the tier board in your browser to pick up the new ranks.
)

echo.
pause
