const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function safeWrite(filePath, updateFn) {
  if (!fs.existsSync(filePath)) return;
  try {
    fs.chmodSync(filePath, 0o666);
  } catch {}
  let content = fs.readFileSync(filePath, 'utf8');
  const updated = updateFn(content);
  if (updated && updated !== content) {
    try {
      fs.writeFileSync(filePath, updated, 'utf8');
      console.log('✓ Patched ' + path.basename(filePath));
    } catch (e) {
      console.warn('Note: Could not write ' + path.basename(filePath) + ': ' + e.message);
    }
  }
}

// 1. Patch AudioPlayer.kt
const audioPlayerKtPath = path.join(
  projectRoot,
  'node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioPlayer.kt'
);

safeWrite(audioPlayerKtPath, (content) => {
  if (content.includes('override val supportsNextTrack = true')) return content;
  const target = 'override val serviceConnection = AudioPlaybackServiceConnection(WeakReference(this), appContext)';
  const addition = `${target}

  override val supportsNextTrack = true
  override val supportsPreviousTrack = true

  override fun nextTrack() {
    emit("nextTrack", emptyMap<String, Any>())
  }

  override fun previousTrack() {
    emit("previousTrack", emptyMap<String, Any>())
  }`;
  return content.includes(target) ? content.replace(target, addition) : content;
});

// 2. Patch AudioMediaSessionCallback.kt
const audioMediaSessionCallbackPath = path.join(
  projectRoot,
  'node_modules/expo-audio/android/src/main/java/expo/modules/audio/service/AudioMediaSessionCallback.kt'
);

safeWrite(audioMediaSessionCallbackPath, (content) => {
  if (content.includes('override fun onPlayerCommandRequest')) return content;
  const target = 'override fun onCustomCommand(';
  const addition = `override fun onPlayerCommandRequest(
    session: MediaSession,
    controller: MediaSession.ControllerInfo,
    playerCommand: Int
  ): Int {
    when (playerCommand) {
      Player.COMMAND_SEEK_TO_NEXT,
      Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> {
        service.nextTrack()
        return SessionResult.RESULT_SUCCESS
      }
      Player.COMMAND_SEEK_TO_PREVIOUS,
      Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> {
        service.previousTrack()
        return SessionResult.RESULT_SUCCESS
      }
    }
    return super.onPlayerCommandRequest(session, controller, playerCommand)
  }

  override fun onCustomCommand(`;
  return content.includes(target) ? content.replace(target, addition) : content;
});

// 3. Patch AudioPlayer.swift
const audioPlayerSwiftPath = path.join(
  projectRoot,
  'node_modules/expo-audio/ios/AudioPlayer.swift'
);

safeWrite(audioPlayerSwiftPath, (content) => {
  if (content.includes('var supportsNextTrack: Bool')) return content;
  const target = 'var lockScreenPlayer: AVPlayer {\n    ref\n  }';
  const addition = `var lockScreenPlayer: AVPlayer {
    ref
  }

  var supportsNextTrack: Bool {
    true
  }

  var supportsPreviousTrack: Bool {
    true
  }

  func nextTrack() {
    self.emit(event: "nextTrack", payload: [:])
  }

  func previousTrack() {
    self.emit(event: "previousTrack", payload: [:])
  }`;
  return content.includes(target) ? content.replace(target, addition) : content;
});

// 4. Patch AudioModule.types.d.ts
const audioModuleTypesDtsPath = path.join(
  projectRoot,
  'node_modules/expo-audio/build/AudioModule.types.d.ts'
);

safeWrite(audioModuleTypesDtsPath, (content) => {
  if (content.includes('nextTrack?(): void;')) return content;
  const target = 'audioSampleUpdate(data: AudioSample): void;';
  const addition = `audioSampleUpdate(data: AudioSample): void;
    nextTrack?(): void;
    previousTrack?(): void;`;
  return content.includes(target) ? content.replace(target, addition) : content;
});
