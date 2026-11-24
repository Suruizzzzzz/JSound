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

// 5. Patch AudioControlsService.kt
const audioControlsServiceKtPath = path.join(
  projectRoot,
  'node_modules/expo-audio/android/src/main/java/expo/modules/audio/service/AudioControlsService.kt'
);

safeWrite(audioControlsServiceKtPath, (content) => {
  // 5a. Bug 1: ForwardingPlayer unconditionally declares Next/Previous available commands and overrides seekToNext/Previous
  if (!content.includes('override fun seekToNext()')) {
    const target = `      override fun seekBack() {
        seekTo((currentPosition - backwardMs).coerceAtLeast(0))
      }

      override fun getAvailableCommands(): Player.Commands {
        val commands = super.getAvailableCommands().buildUpon()
        if (isLive) {
          commands.remove(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
        }
        return commands.build()
      }`;

    const replacement = `      override fun seekBack() {
        seekTo((currentPosition - backwardMs).coerceAtLeast(0))
      }

      override fun seekToNext() {
        playable.nextTrack()
      }

      override fun seekToNextMediaItem() {
        playable.nextTrack()
      }

      override fun hasNextMediaItem(): Boolean = true

      override fun seekToPrevious() {
        playable.previousTrack()
      }

      override fun seekToPreviousMediaItem() {
        playable.previousTrack()
      }

      override fun hasPreviousMediaItem(): Boolean = true

      override fun getAvailableCommands(): Player.Commands {
        val commands = super.getAvailableCommands().buildUpon()
        if (isLive) {
          commands.remove(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
        }
        commands.add(Player.COMMAND_SEEK_TO_NEXT)
        commands.add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
        commands.add(Player.COMMAND_SEEK_TO_PREVIOUS)
        commands.add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
        return commands.build()
      }`;

    if (content.includes(target)) {
      content = content.replace(target, replacement);
    }
  }

  // 5b. Bug 2: setPlayableOptions preserves existing MediaSession when playable == currentPlayable && mediaSession != null
  if (!content.includes('if (playable == currentPlayable && mediaSession != null)')) {
    const target = `  fun setPlayableOptions(
    playable: LockScreenPlayable,
    metadata: Metadata?,
    options: AudioLockScreenOptions?
  ) {
    if (playable == currentPlayable) {
      currentMetadata = metadata
      currentOptions = options
      updateArtwork(metadata, postUpdate = false)

      mediaSession?.release()
      sessionMetadataPlayer = null
      appContext?.mainQueue?.launch {
        val context = appContext?.reactContext ?: return@launch
        val sessionPlayer = MetadataInjectingPlayer(resolveSessionPlayer(playable, options)).apply {
          updateMetadata(metadata)
        }
        val session = MediaSession.Builder(context, sessionPlayer)
          .setId("ExpoAudioLockScreenSession_\${playable.player.hashCode()}")
          .setCallback(AudioMediaSessionCallback(this@AudioControlsService))
          .build()

        playable.mediaSession.release()
        playable.mediaSession = session

        addSession(session)
        mediaSession = session
        sessionMetadataPlayer = sessionPlayer

        updateSessionCustomLayout(playable.player.isPlaying)
        postOrStartForegroundNotification(startInForeground = false)
      }
    } else {
      setActivePlayableInternal(playable, metadata, options)
    }
  }`;

    const replacement = `  fun setPlayableOptions(
    playable: LockScreenPlayable,
    metadata: Metadata?,
    options: AudioLockScreenOptions?
  ) {
    val effectiveOptions = options ?: currentOptions
    if (playable == currentPlayable && mediaSession != null) {
      currentMetadata = metadata
      currentOptions = effectiveOptions
      sessionMetadataPlayer?.updateMetadata(metadata)
      updateArtwork(metadata, postUpdate = false)
      updateSessionCustomLayout(playable.player.isPlaying)
      postOrStartForegroundNotification(startInForeground = false)
    } else {
      setActivePlayableInternal(playable, metadata, effectiveOptions)
    }
  }`;

    if (content.includes(target)) {
      content = content.replace(target, replacement);
    }
  }

  // 5c. Bug 3: buildNotification adds deleteIntent to notify service on notification dismissal/swipe
  if (!content.includes('.setDeleteIntent(buildActionPendingIntent(ACTION_DISMISS))')) {
    const target = `      .setContentIntent(buildContentIntent())
      .setAutoCancel(false)`;
    const replacement = `      .setContentIntent(buildContentIntent())
      .setDeleteIntent(buildActionPendingIntent(ACTION_DISMISS))
      .setAutoCancel(false)`;
    if (content.includes(target)) {
      content = content.replace(target, replacement);
    }
  }

  // 5d. Bug 3: onStartCommand handles ACTION_DISMISS
  if (!content.includes('if (intent.action == ACTION_DISMISS)')) {
    const target = `    context.mainQueue.launch {
      when (intent?.action) {
        ACTION_PLAY -> {`;

    const replacement = `    if (intent.action == ACTION_DISMISS) {
      context.mainQueue.launch {
        currentPlayer.pause()
        hideNotification()
        stopForeground(STOP_FOREGROUND_REMOVE)
      }
      return super.onStartCommand(intent, flags, startId)
    }

    context.mainQueue.launch {
      when (intent?.action) {
        ACTION_PLAY -> {`;

    if (content.includes(target)) {
      content = content.replace(target, replacement);
    }
  }

  // 5e. Bug 3: Declare ACTION_DISMISS in companion object
  if (!content.includes('ACTION_DISMISS = "expo.modules.audio.action.DISMISS"')) {
    const target = `    const val ACTION_PREVIOUS_TRACK = "expo.modules.audio.action.PREVIOUS_TRACK"`;
    const replacement = `    const val ACTION_PREVIOUS_TRACK = "expo.modules.audio.action.PREVIOUS_TRACK"
    const val ACTION_DISMISS = "expo.modules.audio.action.DISMISS"`;
    if (content.includes(target)) {
      content = content.replace(target, replacement);
    }
  }

  // 5f. Bug 3: onTaskRemoved cleans up service when app task is swiped away while paused
  if (!content.includes('override fun onTaskRemoved(')) {
    const target = `  override fun onDestroy() {
    super.onDestroy()`;
    const replacement = `  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
    if (currentPlayable?.player?.isPlaying != true) {
      hideNotification()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
    }
  }

  override fun onDestroy() {
    super.onDestroy()`;
    if (content.includes(target)) {
      content = content.replace(target, replacement);
    }
  }

  // 5g. updateSessionCustomLayout: Ensure Previous / Next buttons always appear (even on 1-song queue)
  if (!content.includes('val showPrev = currentOptions?.showPreviousTrack != false')) {
    const prevPattern1 = `    val showPrev = currentOptions?.showPreviousTrack ?: (playable?.supportsPreviousTrack == true)
    if (showPrev && playable?.supportsPreviousTrack == true) {`;
    const prevPattern2 = `    if (currentOptions?.showPreviousTrack == true && playable?.supportsPreviousTrack == true) {`;
    const prevReplacement = `    val showPrev = currentOptions?.showPreviousTrack != false
    if (showPrev) {`;
    if (content.includes(prevPattern1)) {
      content = content.replace(prevPattern1, prevReplacement);
    } else if (content.includes(prevPattern2)) {
      content = content.replace(prevPattern2, prevReplacement);
    }
  }

  if (!content.includes('val showNext = currentOptions?.showNextTrack != false')) {
    const nextPattern1 = `    val showNext = currentOptions?.showNextTrack ?: (playable?.supportsNextTrack == true)
    if (showNext && playable?.supportsNextTrack == true) {`;
    const nextPattern2 = `    if (currentOptions?.showNextTrack == true && playable?.supportsNextTrack == true) {`;
    const nextReplacement = `    val showNext = currentOptions?.showNextTrack != false
    if (showNext) {`;
    if (content.includes(nextPattern1)) {
      content = content.replace(nextPattern1, nextReplacement);
    } else if (content.includes(nextPattern2)) {
      content = content.replace(nextPattern2, nextReplacement);
    }
  }

  // 5h. Add onTimelineChanged & onMediaItemTransition to player listener for live lock-screen duration
  if (!content.includes('override fun onTimelineChanged')) {
    const listenerTarget = `      override fun onPlaybackStateChanged(playbackState: Int) {
        postOrStartForegroundNotification(startInForeground = false)
      }`;
    const listenerReplacement = `      override fun onPlaybackStateChanged(playbackState: Int) {
        postOrStartForegroundNotification(startInForeground = false)
      }

      override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) {
        postOrStartForegroundNotification(startInForeground = false)
      }

      override fun onMediaItemTransition(mediaItem: androidx.media3.common.MediaItem?, reason: Int) {
        postOrStartForegroundNotification(startInForeground = false)
      }`;
    if (content.includes(listenerTarget)) {
      content = content.replace(listenerTarget, listenerReplacement);
    }
  }

  // 5i. buildNotification: Ensure Previous & Next actions appear on notifications
  if (content.includes('if (currentOptions?.showPreviousTrack == true && currentPlayable?.supportsPreviousTrack == true) {')) {
    content = content.replace(
      'if (currentOptions?.showPreviousTrack == true && currentPlayable?.supportsPreviousTrack == true) {',
      'if (currentOptions?.showPreviousTrack != false) {'
    );
  }
  if (content.includes('if (currentOptions?.showNextTrack == true && currentPlayable?.supportsNextTrack == true) {')) {
    content = content.replace(
      'if (currentOptions?.showNextTrack == true && currentPlayable?.supportsNextTrack == true) {',
      'if (currentOptions?.showNextTrack != false) {'
    );
  }

  // 5j. supportsNextTrack and supportsPreviousTrack always return true for continuous playback / radio
  if (!content.includes('fun supportsNextTrack(): Boolean = true')) {
    const target = `  fun nextTrack() {
    currentPlayable?.takeIf { it.supportsNextTrack }?.nextTrack()
  }

  fun previousTrack() {
    currentPlayable?.takeIf { it.supportsPreviousTrack }?.previousTrack()
  }

  fun supportsNextTrack(): Boolean {
    return currentPlayable?.supportsNextTrack == true
  }

  fun supportsPreviousTrack(): Boolean {
    return currentPlayable?.supportsPreviousTrack == true
  }`;

    const replacement = `  fun nextTrack() {
    currentPlayable?.nextTrack()
  }

  fun previousTrack() {
    currentPlayable?.previousTrack()
  }

  fun supportsNextTrack(): Boolean = true

  fun supportsPreviousTrack(): Boolean = true`;

    if (content.includes(target)) {
      content = content.replace(target, replacement);
    }
  }

  return content;
});

// 6. Patch MetadataInjectingPlayer.kt (dispatch timeline and transition events so duration & seekbar update)
const metadataInjectingPlayerKtPath = path.join(
  projectRoot,
  'node_modules/expo-audio/android/src/main/java/expo/modules/audio/service/MetadataInjectingPlayer.kt'
);

safeWrite(metadataInjectingPlayerKtPath, (content) => {
  if (content.includes('Player.EVENT_TIMELINE_CHANGED')) return content;
  const target = `    val events = Player.Events(
      FlagSet.Builder()
        .add(Player.EVENT_MEDIA_METADATA_CHANGED)
        .build()
    )`;
  const addition = `    val events = Player.Events(
      FlagSet.Builder()
        .add(Player.EVENT_MEDIA_METADATA_CHANGED)
        .add(Player.EVENT_TIMELINE_CHANGED)
        .add(Player.EVENT_MEDIA_ITEM_TRANSITION)
        .add(Player.EVENT_PLAYBACK_STATE_CHANGED)
        .build()
    )`;
  return content.includes(target) ? content.replace(target, addition) : content;
});
