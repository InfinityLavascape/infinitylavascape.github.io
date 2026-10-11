local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")

local SonaractiveEvent = ReplicatedStorage:WaitForChild("Sonaractive")

local API_URL = "https://sonaractive.jacksonsteven212.workers.dev"
local API_TOKEN = "" -- Set this in server-only code. Never put the token in a LocalScript.

local VALID_COMMANDS = {
	play = true,
	pause = true,
	resume = true,
	stop = true,
	volume = true,
}
local MAX_PENDING_COMMANDS = 100
local commandQueues = {}
local processingPlayers = {}

local function sendCommand(player, command, options)
	if not VALID_COMMANDS[command] then
		warn("Sonaractive command rejected:", command)
		return
	end

	options = options or {}
	local payload = {
		username = player.Name,
		command = command,
		playbackId = options.playbackId,
	}

	if command == "play" then
		payload.playbackId = payload.playbackId or HttpService:GenerateGUID(false)
		payload.sound = options.sound
		payload.volume = options.volume
	elseif command == "volume" then
		payload.value = options.value
		payload.mode = options.mode or "set"
		payload.duration = options.duration
	end

	local startedAt = os.clock()
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = API_URL .. "/api/sonar/command",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Authorization"] = "Bearer " .. API_TOKEN,
			},
			Body = HttpService:JSONEncode(payload),
		})
	end)

	warn(("Sonaractive request: %dms"):format(math.floor((os.clock() - startedAt) * 1000)))
	if not ok then
		warn("Sonaractive HTTP request failed:", response)
	elseif not response.Success then
		warn("Sonaractive API request failed:", response.StatusCode, response.Body)
	else
		warn("Sonaractive API accepted command:", response.Body)
	end
end

local function enqueueCommand(player, command, options)
	local userId = player.UserId
	local queue = commandQueues[userId]
	if not queue then
		queue = {}
		commandQueues[userId] = queue
	end

	if #queue >= MAX_PENDING_COMMANDS then
		warn("Sonaractive command queue full for player:", player.Name)
		return
	end
	table.insert(queue, { command = command, options = options })
	if processingPlayers[userId] then
		return
	end

	processingPlayers[userId] = true
	task.spawn(function()
		while #queue > 0 do
			local item = table.remove(queue, 1)
			sendCommand(player, item.command, item.options)
		end

		commandQueues[userId] = nil
		processingPlayers[userId] = nil
	end)
end

SonaractiveEvent.OnServerEvent:Connect(function(player, command, options)
	-- Keep compatibility with the original RemoteEvent:FireServer("act3.intro.ogg").
	if typeof(command) == "string" and options == nil then
		enqueueCommand(player, "play", {
			sound = command,
			playbackId = HttpService:GenerateGUID(false),
		})
		return
	end

	if typeof(command) ~= "string" or typeof(options) ~= "table" then
		warn("Sonaractive event requires a command and options table")
		return
	end

	enqueueCommand(player, command, options)
end)

-- Example client calls:
-- Sonaractive:FireServer("play", { playbackId = "intro", sound = "act3.intro.ogg", volume = 1 })
-- Sonaractive:FireServer("pause", { playbackId = "intro" })
-- Sonaractive:FireServer("resume", { playbackId = "intro" })
-- Sonaractive:FireServer("volume", { playbackId = "intro", value = 0.25, mode = "tween", duration = 1 })
-- Sonaractive:FireServer("stop", { playbackId = "intro" })
