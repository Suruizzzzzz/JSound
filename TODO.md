# JStream Roadmap & Implementation Tasks (TODO.md)

This document outlines the detailed architectural analysis and implementation plan for the upcoming enhancements across Authentication, Background Audio, Library UI, and Playlists Sync & Sharing.

---

## Phase 1: Auth Collision & Redirect Polish

### Files Impacted
- `src/services/authService.ts`
- `src/store/authStore.ts`
- `src/app/auth.tsx`
- `src/styles/auth.styles.ts`

### Tasks
- [ ] **Detect OAuth / Email Identity Collisions in `authService.ts`**
  - [ ] Update `signUp({ email, password, displayName })`: Inspect Supabase response for identity collisions:
    - Check if `data.user && (!data.user.identities || data.user.identities.length === 0)` (Supabase indicates an existing identity).
    - Catch error messages matching `"User already registered"` or `"identity already exists"`.
  - [ ] Return a structured collision indicator: `{ identityCollision: true, existingProvider: 'google' }` or throw a custom `AuthCollisionError`.
- [ ] **Update Auth Store Handler in `src/store/authStore.ts`**
  - [ ] Propagate collision status cleanly through `useAuthStore.signUp()` so the UI can branch without generic error popups.
- [ ] **Build Account Collision Modal in `src/app/auth.tsx`**
  - [ ] Design a dedicated monochrome collision dialog / modal:
    - Icon: `logo-google` or `alert-circle-outline` badge.
    - Title: **"Account Already Exists"**.
    - Body: *"This email is already linked to a Google sign-in. Please use 'Continue with Google' to access your account."*
    - Primary Button: **"Continue with Google"** (1-tap trigger for `handleGoogleSignIn()`).
    - Secondary Action: **"Cancel / Use Another Email"**.
- [ ] **Verify Dynamic OAuth Redirects**
  - [ ] Ensure `signInWithGoogle()` checks `Constants.appOwnership === 'expo' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient`.
  - [ ] Verify `exp://` redirect in Expo Go development and `jstream://` in standalone release builds (`.apk` / `.aab`).

---

## Phase 2: Fix `expo-audio` Lock Screen & Background Playback

### Files Impacted
- `app.json`
- `src/services/audioService.ts`
- `src/app/_layout.tsx`

### Tasks
- [ ] **Audit `app.json` Audio & Notification Permissions**
  - [ ] Verify `["expo-audio", { "enableBackgroundPlayback": true }]` is active in `plugins`.
  - [ ] Verify Android permissions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `WAKE_LOCK`, and `POST_NOTIFICATIONS`.
- [ ] **Harden Lock Screen / Notification Service Binding in `audioService.ts`**
  - [ ] Enhance Expo Go environment detection (`isExpoGo`) to prevent calling native background playback service APIs that are omitted from the Expo Go shell client.
  - [ ] Wrap `playerInstance.setActiveForLockScreen(...)` and `playerInstance.updateLockScreenMetadata(...)` in comprehensive `try/catch` and attach `.catch(() => {})` to returned promises.
  - [ ] Suppress native warning `[AudioService] Failed to activate lock screen controls` in development so RedBox / LogBox overlays never interrupt manual testing.
- [ ] **Verify Audio Mode Initialization in `ensureAudioMode()`**
  - [ ] Set `shouldPlayInBackground: !isExpoGo`.
  - [ ] Safely wrap `requestNotificationPermissionsAsync()` on Android 13+.

---

## Phase 3: Declutter Library Header UI

### Files Impacted
- `src/app/(tabs)/index.tsx`
- `src/styles/index.styles.ts`

### Tasks
- [ ] **Remove Redundant Offline Status Pill**
  - [ ] Remove `<View style={styles.offlineBadge}>` from `renderTopBranding()` in `src/app/(tabs)/index.tsx`.
  - [ ] Clean up unused styles in `src/styles/index.styles.ts` (`offlineBadge`, `offlineBadgeText`).
- [ ] **Consolidate Top Controls with `+ Add Music` Trigger**
  - [ ] Replace side-by-side bulky `Scan Music` and `Import Files` buttons with a compact, stylish **`+ Add Music`** trigger button.
  - [ ] Align **`+ Add Music`** alongside `Last Download` sort selector and `Reorder` toggle in `renderSongsHeader()`.
- [ ] **Create Clean "Add Music" Action Modal / Bottom Sheet**
  - [ ] Add modal state `showAddMusicModal: boolean`.
  - [ ] Design sleek monochrome options:
    - **Scan Device Storage**: Triggers `handleScanMusic()` to auto-discover device audio.
    - **Import Audio Files**: Triggers `handleImportAudio()` using system document/file picker.
    - **Cancel Button**: Dismisses modal.
- [ ] **Layout Polish & Spacing**
  - [ ] Optimize header height so the songs list gains vertical screen real estate.
  - [ ] Ensure smooth haptics on trigger interactions.

---

## Phase 4: Full User Playlists + Cloud Sync & Playlist Sharing

### Files Impacted
- `supabase/schema.sql`
- `src/lib/database.ts`
- `src/types/music.ts`
- `src/services/playlistSyncService.ts` *(new)*
- `src/store/authStore.ts`
- `src/app/(tabs)/index.tsx`
- `src/styles/index.styles.ts`

### Tasks
- [ ] **Schema & Database Alignment**
  - [ ] In `supabase/schema.sql`:
    - Ensure `user_playlists.id` is `text primary key` to match SQLite IDs (`pl_...`).
    - Add `share_code text unique` to `user_playlists` with index.
    - Add public RLS policies allowing anyone to view playlists and playlist tracks that have a non-null `share_code`.
  - [ ] In `src/lib/database.ts`:
    - Add `share_code TEXT` and `sync_version INTEGER DEFAULT 1` columns to SQLite `playlists` table.
    - Implement `updatePlaylistName(playlistId, name)`.
    - Implement `setPlaylistShareCode(playlistId, shareCode)`.
- [ ] **Full Playlist CRUD in UI (`src/app/(tabs)/index.tsx`)**
  - [ ] **Create Playlist**: Modal with playlist name and cover image picker.
  - [ ] **View Playlist Details**: Song list, cover artwork, total duration, and Play All button.
  - [ ] **Edit Playlist**: Edit playlist title and change/remove cover image.
  - [ ] **Delete Playlist**: Confirmation modal via `ConfirmModal`.
  - [ ] **Add/Remove Tracks**: Tap bookmark icon on any `TrackItem` to open the multi-select "Add to Playlist" sheet.
- [ ] **Two-Way Supabase Cloud Sync (`src/services/playlistSyncService.ts`)**
  - [ ] When signed in (`user.is_logged_in`):
    - Sync local tracks metadata (`user_tracks`).
    - Push local playlists & playlist tracks (`user_playlists`, `user_playlist_tracks`).
    - Pull remote playlists & playlist tracks, merging into local SQLite database.
  - [ ] Update `syncPlaylistsToCloud()` in `src/store/authStore.ts` to execute real bidirectional sync instead of a simulation timer.
  - [ ] Show reactive sync feedback in Profile screen (`Synced` / `Sync pending` / `Syncing...`).
- [ ] **Playlist Sharing Feature**
  - [ ] **Generate Share Code / Link**:
    - Add "Share Playlist" action button in the Playlist detail view.
    - Generates a unique 6-character code (e.g. `JST-8K2A`).
    - Syncs playlist snapshot to Supabase with the generated `share_code`.
    - Copies code and deep link (`jstream://playlist/CODE`) to clipboard; shows success notification.
  - [ ] **Import Shared Playlist**:
    - Add "Import with Code" button on the Playlists tab header.
    - Modal with 6-character code input.
    - Fetches shared playlist metadata and track list from Supabase.
    - Preview modal showing playlist name, track count, and tracks.
    - 1-tap "Save to My Playlists" button importing it directly into local SQLite.

---

## Phase 5: Verification & Quality Assurance

- [ ] Run `npx tsc --noEmit` and confirm 0 TypeScript compiler errors.
- [ ] Run `npx expo lint` and confirm 0 ESLint problems.
- [ ] Test on Android/iOS simulators and Expo Go to ensure zero crashes or regressions.
