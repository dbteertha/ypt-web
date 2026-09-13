# YPT Web (unofficial)

A browser client for a user's own Yeolpumta (YPT) account. It uses Google OAuth in the browser, exchanges the resulting Google credential with YPT's undocumented social-login endpoint, stores the YPT JWT only in an HttpOnly cookie, and proxies supported YPT calls through the Node server.

> Not affiliated with YPT/Pallo. YPT does not publish a supported public API, so this project can break if their backend changes. Use only with accounts you own and review YPT's terms before public deployment.

## Features
- Continue with Google for Google-created YPT accounts
- YPT profile reload
- Subject list
- Study timer start/stop
- Joined groups
- Daily study log endpoint
- Group member status endpoint
- Category ranking endpoint
- Server-side proxy; no YPT JWT in browser JavaScript

## Local setup
1. Create a Google OAuth 2.0 **Web application** client in Google Cloud Console.
2. Add `http://localhost:3000` and your production Render origin under **Authorized JavaScript origins**.
3. Set `GOOGLE_CLIENT_ID`.

PowerShell:
```powershell
$env:GOOGLE_CLIENT_ID="YOUR_CLIENT_ID.apps.googleusercontent.com"
npm install
npm run build
npm start
```
Open http://localhost:3000

## Render
- Runtime: Node
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Environment variable: `GOOGLE_CLIENT_ID`
- Recommended region: Singapore for South Asia

## Interoperability reference
The YPT social exchange shape was cross-checked against the MIT-licensed `deveworld/ypt_client` project. Google browser OAuth itself uses Google's normal OAuth 2.0 web flow; do not reuse mobile-app secrets or ask users for Google passwords.
