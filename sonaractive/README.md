# Sonaractive API

This free-tier Cloudflare Worker relays sound requests from a Roblox server to a browser listening on this site's GitHub Pages frontend. It uses a Durable Object queue so API requests are not dependent on a particular Worker instance.

## Deploy the API

1. Create a free Cloudflare account and enable the `workers.dev` subdomain in **Workers & Pages**. No custom domain is needed.
2. Install Node.js, open a terminal in this folder, and authenticate Wrangler:

   ```powershell
   npx wrangler login
   ```

3. Deploy the Worker:

   ```powershell
   npx wrangler deploy
   ```

4. Set a long random token for the deployed Worker when Wrangler prompts. Keep it private; do not commit it or put it in browser code:

   ```powershell
   npx wrangler secret put API_TOKEN
   ```

5. Wrangler prints the API URL during deploy, usually `https://sonaractive-api.<your-account>.workers.dev`.

6. In `sonaractive.html`, replace `YOUR-ACCOUNT` in `apiBase` with the exact account subdomain Wrangler printed. Commit and push the page change to GitHub Pages.

The Worker allows browser connections from `https://infinitylavascape.github.io`, the site's GitHub Pages origin. If the page is accessed from a different origin, update `SITE_ORIGIN` in `wrangler.toml` to that origin and redeploy.

## Roblox commands

Enable **Allow HTTP Requests** in the Roblox experience's security settings. The included `demo.luau` is a server Script for `ServerScriptService`; it listens to the `ReplicatedStorage.Sonaractive` RemoteEvent. Set `API_TOKEN` in that server-only script. Never put the token in a LocalScript or share it with clients.

```lua
-- In a LocalScript, after requiring the RemoteEvent:
Sonaractive:FireServer("play", {
    playbackId = "intro",
    sound = "act3.intro.ogg",
    volume = 1,
})
Sonaractive:FireServer("pause", { playbackId = "intro" })
Sonaractive:FireServer("resume", { playbackId = "intro" })
Sonaractive:FireServer("volume", {
    playbackId = "intro",
    value = 0.25,
    mode = "tween",
    duration = 1,
})
Sonaractive:FireServer("stop", { playbackId = "intro" })
```

The server forwards each command as an authenticated `POST /api/sonar/command` JSON request. Every play must use a unique or reusable `playbackId`; pause, resume, volume, and stop target that ID. Filenames are names of `.ogg` files in the site's asset folder. Volume values must be from `0` to `1`; volume mode is `set` or `tween`, and tween duration is limited to 60 seconds.

The original `Sonaractive:FireServer("act3.intro.ogg")` event format remains supported and starts a play with an auto-generated ID; send the new command table format when you need to control the same playback later.

The sound file must be committed under `sonaractive/assets/` and use an `.ogg` filename. Add its filename to `sonaractive/assets/manifest.json` so the browser can fetch and decode it when listening starts. The page caches decoded audio buffers and applies play, pause, resume, stop, and volume commands to active browser audio instances. WebSockets push those commands to the page; network and browser scheduling still mean this is not sample-accurate synchronization.

The included demo accepts client RemoteEvent commands; Roblox clients can invoke these freely, so add your own server-side permission checks before letting untrusted players trigger sounds or controls.
