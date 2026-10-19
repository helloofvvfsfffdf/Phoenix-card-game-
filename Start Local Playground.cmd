@echo off
cd /d "%~dp0"
echo PHOENIX Local Card Playground
echo Open http://127.0.0.1:4318/tests/local-play.html in your browser.
echo Keep this window open while testing. Press Ctrl+C to stop.
node tests/start-local-play.js
pause
