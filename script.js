    import init, {
			CompleteBot,
			CompleteMap,
			PlaybackHead,
			setup_graphics
		} from "./botPlayer/strafesnet_roblox_bot_player_wasm_module.js";

		const statusEl = document.getElementById("status");
		const canvas = document.getElementById("viewport");
		const downloadLink = document.getElementById("download");

        const bitsPerSecond = 10000000;
        const framerate = 60;

		let mediaRecorder;
		let recordedChunks = [];
		let recordingStream;
		let recordingVideoTrack;
		let recordingUrl;
		let recordingMimeType = "video/webm";
		let stopFallbackTimer;
		let recordingFinalized = false;
		let isRecording = false;
		let frameId;
        let replayDurationSeconds = 0;
		let isDisposed = false;
		let autoRecordEnabled = true;
		let autoRecordStarted = false;

		function setDownloadDisabled(disabled) {
			downloadLink.setAttribute("aria-disabled", disabled ? "true" : "false");
		}

		function getSupportedMimeType() {
			if (typeof MediaRecorder === "undefined") {
				return undefined;
			}

			const candidates = [
				"video/webm;codecs=vp8",
				"video/webm",
			];

			for (const type of candidates) {
				if (MediaRecorder.isTypeSupported(type)) {
					return type;
				}
			}

			return undefined;
		}

		function stopRecordingTracks() {
			if (!recordingStream) {
				return;
			}

			for (const track of recordingStream.getTracks()) {
				track.stop();
			}

			recordingStream = undefined;
		}

		async function finalizeRecording() {
			if (recordingFinalized) {
				return;
			}

			recordingFinalized = true;
			isRecording = false;

			if (typeof stopFallbackTimer === "number") {
				clearTimeout(stopFallbackTimer);
				stopFallbackTimer = undefined;
			}

			stopRecordingTracks();

			if (recordedChunks.length === 0) {
				setDownloadDisabled(true);
				statusEl.textContent = "no recording data :()";
				return;
			}
            
			const blob = new Blob(recordedChunks, { type: recordingMimeType || "video/webm" });
			recordingUrl = URL.createObjectURL(blob);
			downloadLink.href = recordingUrl;
			downloadLink.download = `playback.webm`;
			setDownloadDisabled(false);
			statusEl.textContent = "Recording complete. Click Download recording.";
		}

		async function startRecording() {
			if (isRecording) {
				return;
			}

			try {
				if (typeof MediaRecorder === "undefined") {
					throw new Error("MediaRecorder is not supported in this browser.");
				}

				recordedChunks = [];
				recordingFinalized = false;
				isRecording = true;

				if (recordingUrl) {
					URL.revokeObjectURL(recordingUrl);
					recordingUrl = undefined;
				}

				await new Promise(resolve => requestAnimationFrame(resolve));

				recordingStream = canvas.captureStream(framerate);
				recordingVideoTrack = recordingStream.getVideoTracks()[0];
				
				if (recordingVideoTrack?.readyState === "ended") {
					throw new Error("Video track failed to initialize");
				}
				
				const mimeType = getSupportedMimeType();
				recordingMimeType = mimeType || "video/webm";
				
				const mediaRecorderOptions = {
					videoBitsPerSecond: bitsPerSecond
				};
				if (mimeType) {
					mediaRecorderOptions.mimeType = mimeType;
				}
				
				mediaRecorder = new MediaRecorder(recordingStream, mediaRecorderOptions);

				mediaRecorder.ondataavailable = (event) => {
					if (event.data && event.data.size > 0) {
						recordedChunks.push(event.data);
					}
				};

				mediaRecorder.onstop = () => {
					finalizeRecording();
				};

				mediaRecorder.onerror = (event) => {
					statusEl.textContent = "Recording error.";
				};

				mediaRecorder.start(1000);
				
				autoRecordStarted = true;
				setDownloadDisabled(true);
				statusEl.textContent = "Recording...";
			} catch (error) {
                console.error("Failed to start recording:", error);
				statusEl.textContent = "Failed to start recording.";
				isRecording = false;
			}
		}

		function stopRecording() {
			isRecording = false;
			
			if (mediaRecorder && mediaRecorder.state !== "inactive") {
				try {
					mediaRecorder.requestData();
				} catch (e) {
				}

				if (typeof stopFallbackTimer === "number") {
					clearTimeout(stopFallbackTimer);
				}

				stopFallbackTimer = setTimeout(() => {
					if (!recordingFinalized) {
						finalizeRecording();
					}
				}, 2000);

				statusEl.textContent = "Stopping recording…";
				try {
					mediaRecorder.stop();
				} catch (error) {
					finalizeRecording();
				}
			}
		}

	
		setDownloadDisabled(true);

		try {
			await init();

			const [botResponse, mapResponse] = await Promise.all([
				fetch("./bot.bin"),
				fetch("./map.bin")
			]);

			if (!botResponse.ok || !mapResponse.ok) {
				throw new Error(
					"Missing data files. Add bot data as ./bot.bin and map data as ./map.bin"
				);
			}

			const botData = new Uint8Array(await botResponse.arrayBuffer());
			const mapData = new Uint8Array(await mapResponse.arrayBuffer());

			const bot = new CompleteBot(botData);
			const map = new CompleteMap(mapData);
			const head = new PlaybackHead(bot, 0);
			const graphics = await setup_graphics(canvas);
			replayDurationSeconds = bot.duration();

			graphics.change_map(map);
			const screenWidth = canvas.width * window.devicePixelRatio;
			const screenHeight = canvas.height * window.devicePixelRatio;
			const fov_y = head.get_fov_slope_y();
			const fov_x = (fov_y * screenWidth) / screenHeight;
			graphics.resize(screenWidth, screenHeight, fov_x, fov_y);

			const startTime = performance.now() / 1000;

			function frame(nowMs) {
				if (isDisposed) {
					return;
				}

				const nowSeconds = nowMs / 1000;
				const elapsed = nowSeconds - startTime;

				try {
					head.advance_time(bot, elapsed);
					graphics.render(bot, head, elapsed);
					

					if (autoRecordEnabled && !autoRecordStarted && elapsed >= 0) {
						void startRecording();
					}

					if (replayDurationSeconds > 0 && elapsed >= replayDurationSeconds
					) {
						stopRecording();
					}
				} catch (error) {
                    console.error("Error during frame rendering:", error);
					statusEl.textContent = "Render error :()";
					return;
				}

				frameId = requestAnimationFrame(frame);
			}

			frameId = requestAnimationFrame(frame);
			statusEl.textContent = "Playback loaded.";

			window.addEventListener("beforeunload", () => {
				isDisposed = true;

				if (typeof frameId === "number") {
					cancelAnimationFrame(frameId);
				}

				if (mediaRecorder && mediaRecorder.state !== "inactive") {
					mediaRecorder.stop();
				}

				stopRecordingTracks();

				if (recordingUrl) {
					URL.revokeObjectURL(recordingUrl);
				}

				graphics.free();
				head.free();
				map.free();
				bot.free();
			});
		} catch (error) {
            console.error("Initialization error:", error);
			statusEl.textContent = "Failed to initialize :()";
		}