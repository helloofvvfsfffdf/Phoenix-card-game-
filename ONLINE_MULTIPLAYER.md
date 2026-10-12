# PHOENIX — Real multiplayer (public/private lobbies)

This version adds a **real WebSocket multiplayer server** with public and private
lobbies, host controls, and an owner admin dashboard. It keeps the updated main
menu, the approved animal portraits, single-player mode and the local multiplayer
tester.

## Run it

1. Install **Node.js 20 or newer** from nodejs.org.
2. Extract the ZIP, open a terminal **inside the extracted folder**.
3. Run `npm install` (once, while connected to the internet).
4. Set the owner password **in the terminal** (do not put it in the website files):
   - **Windows PowerShell:** `$env:PHOENIX_OWNER_PASSWORD = "your-long-private-password"`
   - **Windows Command Prompt:** `set PHOENIX_OWNER_PASSWORD=your-long-private-password`
   - **Linux/macOS:** `export PHOENIX_OWNER_PASSWORD="your-long-private-password"`
   - Use a unique password of **at least 24 characters**. Keep it private. You must set it again in each new terminal session.
5. Run `npm start`.
6. Open **http://localhost:3000** in a browser (do not open `index.html` directly).
7. Choose **MULTIPLAYER**, type a name, pick **PUBLIC or PRIVATE**, and press **CREATE LOBBY**.
   - A public lobby appears in the lobby browser for everyone.
   - A private lobby is hidden; share its six-character invite code only with people you want to join.
8. Other players open the same server URL and either pick a room from the **public lobby list** or join by invite code.
9. Once five players are connected, the host presses **START MATCH**.

To play with people on your local Wi-Fi, they can open `http://YOUR-COMPUTER-LAN-IP:3000`. Your firewall may ask to allow Node.js on your private network. For friends outside your home network, deploy this Node server to a trusted HTTPS host that supports WebSockets; send them its HTTPS URL. **An invite code alone cannot connect devices without a reachable server.**

## Lobbies

- Any visitor can create a lobby — no owner password needed to play.
- **Public** lobbies are broadcast to every connected client in the lobby browser (host name, player count, phase only — no private data).
- **Private** lobbies are invisible to everyone who does not have the invite code.
- A maximum of **5 active lobbies** is enforced across public and private together (`PHOENIX_MAX_ROOMS` to override). When the limit is reached, new creations are refused with a clear message.
- Empty lobbies are cleaned up when everyone leaves; abandoned started rooms are closed after a grace period.

## Host controls (server-enforced)

- The host (first player in the room) can **kick any specific player** by seat, and can **close their own lobby**, which disconnects everyone with a notice.
- Both are validated by the server: a non-host guest that tries `kick` or `close_room` is refused with an error and the room is untouched.
- The host cannot kick themselves.

## Owner admin dashboard

The owner password (`PHOENIX_OWNER_PASSWORD`) is only needed by the operator, to open the **admin dashboard** from the SERVER screen:

- See **all public and private rooms** regardless of visibility, with their invite codes.
- **Shut down any one room** while others keep running.
- **Shut down all multiplayer**: closes every room and refuses all new creations AND joins until reopened.
- **Reopen multiplayer** after a global shutdown.
- **Lock / unlock lobby creation**: locks only creation; existing lobbies keep running and can still be joined.
- Both `multiplayerOpen` and `creationLocked` are saved to a local state file (`.phoenix-server-state.json`, git-ignored) and survive a server restart.
- Admin authentication is required before any admin command is accepted. A wrong password is rejected; repeated failures from one IP are temporarily locked out (3 failures within 15 minutes → 30-minute lockout).

## Rules and features

- Exactly five real people per match, one per device/browser.
- Everyone chooses an ally independently; duplicate allies are allowed (the game's rules — the five dice order — resolve picks).
- Server controls the deck, deals hands privately, validates legal moves and resolves effects using the existing PHOENIX rules engine.
- Players see only their own hand and their own legal move choices; other players' card counts and scores are public.
- Steal a Turn / Alvin forced decisions are handled by the server.
- Existing single-player and local tester are unchanged.

## Testing

`npm test` runs the full suite:

- 523+ unit tests for the rules engine and UI helpers,
- live network tests for create/join/start/play plus reconnection handling,
- **29 multiplayer/admin integration tests** covering public/private lobbies, host kick/close permission spoofing, owner shutdowns, lockdown persistence across restarts, and a complete five-player match.

## Security notes

- The owner password is never included in the ZIP or sent to browsers; it is read from the environment at startup.
- The server refuses to start with an owner password shorter than 24 characters.
- Room snapshot messages carry only lobby metadata (code, host, player count, phase) — never hands, passwords or private data.
- This is still not comprehensive internet-facing abuse prevention: put the server behind a trusted HTTPS/WSS host with its own network rate limiting, especially if it uses a reverse proxy. Use HTTPS/WSS when hosting online so passwords are not transmitted in plaintext.

## Strong owner password

Generate a unique 32-byte random password locally in PowerShell (never share it):

```powershell
$env:PHOENIX_OWNER_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

This creates a 64-character random password for the current terminal session. Copy it to a secure password manager if you need to reuse it later; otherwise a new one will be generated each time. Never add it to HTML, JavaScript, screenshots or a public repository.

**Important:** On a reverse-proxy deployment, the Node server might see every visitor as the proxy's IP, causing shared lockouts. Configure rate limiting at the trusted proxy or hosting provider before publishing. For remote access, HTTPS/WSS is mandatory so passwords are not transmitted in plaintext.