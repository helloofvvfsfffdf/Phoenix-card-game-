# PHOENIX — Real multiplayer (first playable version)

This version adds a **real WebSocket multiplayer server**, not fake bots or pass-and-play. It keeps the updated main menu, the six approved animal portraits, single-player mode and the local multiplayer tester.

## Run it

1. Install **Node.js 20 or newer** from nodejs.org.
2. Extract the ZIP, open a terminal **inside the extracted folder**.
3. Run `npm install` (once, while connected to the internet).
4. Set your private owner password **in the terminal** (do not put it in the website files):
   - **Windows PowerShell:** `$env:PHOENIX_OWNER_PASSWORD = "your-long-private-password"`
   - **Windows Command Prompt:** `set PHOENIX_OWNER_PASSWORD=your-long-private-password`
   - **Linux/macOS:** `export PHOENIX_OWNER_PASSWORD="your-long-private-password"`
   - Use a unique password of **at least 24 characters**. Keep it private. You must set it again in each new terminal session.
5. Run `npm start`.
6. Open **http://localhost:3000** in a browser (do not open `index.html` directly).
7. Choose **MULTIPLAYER**, select an animal ally, type your name and owner password, and create a room.
8. Other players open the same server URL, choose their own ally, and join using the six-character room code.
9. Once five players are connected, the host presses **START MATCH**.

To play with people on your local Wi-Fi, they can open `http://YOUR-COMPUTER-LAN-IP:3000`. Your firewall may ask to allow Node.js on your private network. For friends outside your home network, deploy this Node server to a trusted HTTPS host that supports WebSockets; send them its HTTPS URL. **An invite code alone cannot connect devices without a reachable server.**

## Rules and features

- Exactly five real people per match, one per device/browser.
- Host-created private invite-code rooms; no registration or external accounts.
- Everyone chooses an ally independently; duplicate allies are allowed.
- Server controls the deck, deals hands privately, validates legal moves and resolves effects using the existing PHOENIX rules engine.
- Players see only their own hand and their own legal move choices; other players' card counts and scores are public.
- Steal a Turn / Alvin forced decisions are handled by the server.
- Existing single-player and local tester are unchanged.

## Limitations of this first version

- **No reconnect yet.** If someone disconnects during a match, it pauses until the server restarts; create a new room to play again.
- Rooms are in memory; restarting the server clears them.
- No spectators, matchmaking, accounts, chat or moderation.
- This is a prototype, not a hardened public internet service. Use it with friends on a trusted network or behind a reputable hosting provider with HTTPS/WSS. Do not expose your home network by forwarding router ports without adult assistance.
- The package depends on the open-source `ws` module. This environment could not fetch it for an end-to-end multiplayer test. The original 246 engine tests pass, and JavaScript syntax checks pass, but a live five-browser match still needs testing.

## Owner-only room creation

Only requests that provide the server-side `PHOENIX_OWNER_PASSWORD` can create a room. Players joining with a room code do not need the owner password. The password is not included in the ZIP or served to browsers. The server refuses to start without a password of at least 24 characters. Failed owner-password attempts are tracked by connecting IP address across WebSocket reconnects. After 3 failures within 15 minutes, that IP is locked out for 30 minutes. A maximum of 30 active rooms is enforced. This is still not comprehensive internet-facing abuse prevention: put the server behind a trusted HTTPS/WSS host with its own network rate limiting, especially if it uses a reverse proxy. Use HTTPS/WSS when hosting online so the password is encrypted in transit. Anyone who knows your password can create rooms; change it if it is exposed.


## Strong owner password

Generate a unique 32-byte random password locally in PowerShell (never share it):

```powershell
$env:PHOENIX_OWNER_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

This creates a 64-character random password for the current terminal session. Copy it to a secure password manager if you need to reuse it later; otherwise a new one will be generated each time. Never add it to HTML, JavaScript, screenshots or a public repository.

**Important:** On a reverse-proxy deployment, the Node server might see every visitor as the proxy's IP, causing shared lockouts. Configure rate limiting at the trusted proxy or hosting provider before publishing. For remote access, HTTPS/WSS is mandatory so passwords are not transmitted in plaintext.
