const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Expo Config Plugin to ensure native lock-screen Next / Previous controls are enabled
 * on AudioPlayer for Android and iOS builds.
 */
module.exports = function withExpoAudioLockScreen(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      try {
        const patchScript = path.join(cfg.modRequest.projectRoot, 'scripts', 'patch-expo-audio.js');
        if (fs.existsSync(patchScript)) {
          require(patchScript);
        }
      } catch (err) {
        console.warn('[withExpoAudioLockScreen] Error applying lock-screen patch:', err);
      }
      return cfg;
    },
  ]);
};
