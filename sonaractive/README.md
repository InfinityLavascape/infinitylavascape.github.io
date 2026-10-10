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

The Worker allows browser requests from `https://qtulip.io`, the site's configured custom domain. If the page is accessed from a different origin, update `SITE_ORIGIN` in `wrangler.toml` to that origin and redeploy.

## Roblox server request

Enable **Allow HTTP Requests** in the Roblox experience's security settings. From a server Script, send the Roblox player's username and an asset filename (not a URL or filesystem path):

```lua
local HttpService = game:GetService("HttpService")

local API_URL = "https://sonaractive-api.YOUR-ACCOUNT.workers.dev"
local API_TOKEN = "YOUR_API_TOKEN"

local function playForPlayer(player, assetName)
    local response = HttpService:RequestAsync({
        Url = API_URL .. "/api/sonar/play",
        Method = "POST",
        Headers = {
            ["Content-Type"] = "application/json",
            ["Authorization"] = "Bearer " .. API_TOKEN
        },
        Body = HttpService:JSONEncode({
            username = player.Name,
            asset = assetName
        })
    })

    if not response.Success then
        warn("Sonaractive API request failed:", response.StatusCode, response.Body)
    end
end

-- Call playForPlayer(player, "act3.intro.ogg") when the game should play the sound.
```

Store the token only in server-side code. Never place it in a LocalScript or the website.

The sound file must be committed under `sonaractive/assets/` and use an `.ogg` filename. Add its filename to `sonaractive/assets/manifest.json` so the browser can preload it when listening starts. After the player enters their username, the page polls the Worker and plays matching queued assets from that folder.

The browser drains the queue sequentially and waits for each sound file to become playable before starting it. Polling and HTTP round-trip time still add latency, so this is near-real-time rather than sample-accurate synchronization. If the Roblox server starts multiple `RequestAsync` calls concurrently, their arrival order can differ from the order the game triggered them; serialize those calls in the server script when event order matters.
