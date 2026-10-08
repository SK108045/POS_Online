# Windows package handoff — built

Final package: dist/windows/OraforgePOS-Windows-x64.zip (39.3 MiB).
Build ID: dcd46532891a57ee. Targets Windows 10/11 x64.

Extract the entire ZIP and open OraforgePOS.exe. The Node runtime and POS files
are bundled; no separate Node or Python installation is required.
Edge is preferred, Chrome is the fallback on first setup, and the choice is saved.
Persistent browser data, configuration and backups: %LOCALAPPDATA%\OraforgePOS.
Fixed local address: http://localhost:3000/pos.

Verified: official runtime SHA256, ZIP checksum and archive integrity, Windows
x64 PE binaries, syntax/diff checks, and eight tests including the actual packaged
server's readiness, port collision, external data paths, assets and stop endpoint.

The earlier path-separator concern was tool-display escaping; source is correct.

Remaining: run the actual EXE on Windows and check login, cash sale, receipt
printer, eTIMS popup/login/download, backup restore and PC restart.
Wine is unavailable here. Linux checks do not verify Windows execution.

Source edits remain uncommitted. Dist/cache are ignored by Git.
Rebuild: python3 windows/build.py. See START-HERE.txt for client instructions.
