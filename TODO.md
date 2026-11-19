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
- [x] **Detect OAuth / Email Identity Collisions in `authService.ts`**
  - [x] Update `signUp({ email, password, displayName })`: Inspect Supabase response for identity collisions:
    - Check if `data.user && (!data.user.identities || data.user.identities.length === 0)` (Supabase indicates an existing identity).
    - Catch error messages matching `"User already registered"` or `"identity already exists"`.
  - [x] Return a structured collision indicator: `{ identityCollision: true, existingProvider: 'google' }` or throw a custom `AuthCollisionError`.
- [x] **Update Auth Store Handler in `src/store/authStore.ts`**
  - [x] Propagate collision status cleanly through `useAuthStore.signUp()` so the UI can branch without generic error popups.
- [x] **Build Account Collision Modal in `src/app/auth.tsx`**
  - [x] Design a dedicated monochrome collision dialog / modal:
    - Icon: `logo-google` or `alert-circle-outline` badge.
    - Title: **"Account Already Exists"**.
    - Body: *"This email is already linked to a Google sign-in. Please use 'Continue with Google' to access your account."*
    - Primary Button: **"Continue with Google"** (1-tap trigger for `handleGoogleSignIn()`).
    - Secondary Action: **"Cancel / Use Another Email"**.
- [x] **Verify Dynamic OAuth Redirects**
  - [x] Ensure `signInWithGoogle()` checks `Constants.appOwnership === 'expo' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient`.
  - [x] Verify `exp://` redirect in Expo Go development and `jstream://` in standalone release builds (`.apk` / `.aab`).

---

## Phase 2: Fix `expo-audio` Lock Screen & Background Playback

### Files Impacted
- `app.json`
- `src/services/audioService.ts`
- `src/app/_layout.tsx`

### Tasks
- [x] **Audit `app.json` Audio & Notification Permissions**
  - [x] Verify `["expo-audio", { "enableBackgroundPlayback": true }]` is active in `plugins`.
  - [x] Verify Android permissions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `WAKE_LOCK`, and `POST_NOTIFICATIONS`.
- [x] **Harden Lock Screen / Notification Service Binding in `audioService.ts`**
  - [x] Enhance Expo Go environment detection (`isExpoGo`) to prevent calling native background playback service APIs that are omitted from the Expo Go shell client.
  - [x] Wrap `playerInstance.setActiveForLockScreen(...)` and `playerInstance.updateLockScreenMetadata(...)` in comprehensive `try/catch` and attach `.catch(() => {})` to returned promises.
  - [x] Suppress native warning `[AudioService] Failed to activate lock screen controls` in development so RedBox / LogBox overlays never interrupt manual testing.
- [x] **Verify Audio Mode Initialization in `ensureAudioMode()`**
  - [x] Set `shouldPlayInBackground: !isExpoGo`.
  - [x] Safely wrap `requestNotificationPermissionsAsync()` on Android 13+.

---

## Phase 3: Declutter Library Header UI

### Files Impacted
- `src/app/(tabs)/index.tsx`
- `src/styles/index.styles.ts`

### Tasks
- [x] **Remove Redundant Offline Status Pill**
  - [x] Remove `<View style={styles.offlineBadge}>` from `renderTopBranding()` in `src/app/(tabs)/index.tsx`.
  - [x] Clean up unused styles in `src/styles/index.styles.ts` (`offlineBadge`, `offlineBadgeText`).
- [x] **Consolidate Top Controls with `+ Add Music` Trigger**
  - [x] Replace side-by-side bulky `Scan Music` and `Import Files` buttons with a compact, stylish **`+ Add Music`** trigger button.
  - [x] Align **`+ Add Music`** alongside `Last Download` sort selector and `Reorder` toggle in `renderSongsHeader()`.
- [x] **Create Clean "Add Music" Action Modal / Bottom Sheet**
  - [x] Add modal state `showAddMusicModal: boolean`.
  - [x] Design sleek monochrome options:
    - **Scan Device Storage**: Triggers `handleScanMusic()` to auto-discover device audio.
    - **Import Audio Files**: Triggers `handleImportAudio()` using system document/file picker.
    - **Cancel Button**: Dismisses modal.
- [x] **Layout Polish & Spacing**
  - [x] Optimize header height so the songs list gains vertical screen real estate.
  - [x] Ensure smooth haptics on trigger interactions.

---

## Phase 4: Full User Playlists + Cloud Sync, Auto-Download Sync & Playlist Sharing

### Files Impacted
- `supabase/schema.sql`
- `src/lib/database.ts`
- `src/types/music.ts`
- `src/services/playlistSyncService.ts` *(new)*
- `src/store/authStore.ts`
- `src/app/(tabs)/index.tsx`
- `src/app/(tabs)/profile.tsx`
- `src/styles/index.styles.ts`
- `src/styles/profile.styles.ts`

### Tasks
- [x] **Schema & Database Alignment**
  - [x] In `supabase/schema.sql`:
    - Ensure `user_playlists.id` is `text primary key` to match SQLite IDs (`pl_...`).
    - Add `share_code text unique` to `user_playlists` with index.
    - Add public RLS policies allowing anyone to view playlists and playlist tracks that have a non-null `share_code`.
  - [x] In `src/lib/database.ts`:
    - Add `share_code TEXT`, `sync_status TEXT DEFAULT 'synced'`, and `sync_version INTEGER DEFAULT 1` columns to SQLite `playlists` table.
    - Implement `updatePlaylistName(playlistId, name)`.
    - Implement `setPlaylistShareCode(playlistId, shareCode)`.
- [x] **Full Playlist CRUD in UI (`src/app/(tabs)/index.tsx`)**
  - [x] **Create Playlist**: Modal with playlist name and cover image picker.
  - [x] **View Playlist Details**: Song list, cover artwork, total duration, and Play All button.
  - [x] **Edit Playlist**: Edit playlist title and change/remove cover image.
  - [x] **Delete Playlist**: Confirmation modal via `ConfirmModal`.
  - [x] **Add/Remove Tracks**: Tap bookmark icon on any `TrackItem` to open the multi-select "Add to Playlist" sheet.
- [x] **Two-Way Supabase Cloud Sync & Auto-Download (`src/services/playlistSyncService.ts`)**
  - [x] When signed in (`user.is_logged_in`):
    - Sync local tracks metadata (`user_tracks`).
    - Push local playlists & playlist tracks (`user_playlists`, `user_playlist_tracks`).
    - Pull remote playlists, playlist tracks, and missing track metadata into local SQLite database.
  - [x] Sequential background **Auto-Download Sync** for synced tracks missing local audio files on current device.
  - [x] Add `Auto-Download Synced Tracks` switch toggle in Profile → Account & Cloud.
  - [x] Update `syncPlaylistsToCloud()` in `src/store/authStore.ts` to execute real bidirectional sync instead of a simulation timer.
  - [x] Show reactive sync feedback in Profile screen (`Synced` / `Sync pending` / `Syncing...`).
- [x] **Playlist Sharing Feature**
  - [x] **Generate Share Code / Link**:
    - Add "Share Playlist" action button in the Playlist detail view.
    - Generates a unique 6-character code (e.g. `JST-8K2A`).
    - Syncs playlist snapshot to Supabase with the generated `share_code`.
    - Copies code and deep link (`jstream://playlist/CODE`) to clipboard; shows success notification.
  - [x] **Import Shared Playlist**:
    - Add "Import with Code" button on the Playlists tab header.
    - Modal with 6-character code input.
    - Fetches shared playlist metadata and track list from Supabase.
    - Preview modal showing playlist name, track count, and tracks.
    - 1-tap "Save to My Playlists" button importing it directly into local SQLite.

---

## Phase 5: Verification & Quality Assurance

- [x] Run `npx tsc --noEmit` and confirm 0 TypeScript compiler errors.
- [x] Run `npx expo lint` and confirm 0 ESLint problems.
- [x] Test on Android/iOS simulators and Expo Go to ensure zero crashes or regressions.

---

## Phase 6: Interactive Coach-Mark Walkthrough / App Guide

- [x] **Store & Measurement Registry (`src/store/guideStore.ts`)**:
  - `measureInWindow` native coordinate measurement with fallback coordinates.
  - Active step state, `openGuide()`, `closeGuide()`, `nextStep()`, `prevStep()`, `checkAndTriggerGuide()`.
  - Permanent SQLite `app_settings` persistence (`has_seen_onboarding_guide = 'true'`), never reset on sign-out.
- [x] **Spotlight Overlay Component (`src/components/NewcomerGuideModal.tsx` & `src/styles/NewcomerGuideModal.styles.ts`)**:
  - Full-screen `react-native-svg` `<Svg>` with `<Defs><Mask>` overlay (`rgba(0, 0, 0, 0.82)`) punching an anti-aliased rounded-rectangle hole with uniform `6px` breathing padding and target-matched border radius.
  - Crisp `1.5px` focus ring (`rgba(255, 255, 255, 0.92)`) with subtle breathing pulse animation (`opacity: 0.55 ↔ 1.0`).
  - Transparent touch pass-through (`pointerEvents="none"` on SVG & ring, `pointerEvents="box-none"` on container) so target controls are 100% tappable.
  - Clean floating tooltip card with directional arrow, unnumbered titles, minimal `X / 7` step counter on top-left, and `Skip` button on top-right.
  - Android edge-to-edge Y-coordinate alignment offset (`insets.top` / `StatusBar.currentHeight`).
  - Zero-jump transition smoothing: hides overlay immediately (`fadeAnim = 0`) on step/tab changes, measures native target after interactions and a 100ms settle check, and smoothly fades in the spotlight ring and card (`160ms` ease-out).
  - Accurate `first_track_item` fallback bounds (`y: 280`, `height: 68`) aligned with the library track list row.
  - Temporarily pauses and hides whenever full-screen `NowPlayingModal` is open.
- [x] **Hands-On Action-Driven 7-Step Tutorial with Conditional Branching**:
  - Step 1 (`1 / 7`): `add_music_button` (`Library` tab) — "Add Your Music" (tapping real button opens Add Music modal & advances to Step 2).
  - Step 2 (`2 / 7`): `scan_storage_button` (Inside Add Music modal) — "Scan Your Storage" (tapping real option triggers scan, then branches: Branch A -> Step 3 if tracks > 0, Branch B -> Step 4 if tracks === 0).
  - Step 3 (`3 / 7`): `first_track_item` (`Library` tab, Branch A only) — "Play Instantly" (tapping first track starts playback, expands full-screen player, pauses tour until player is dismissed, then advances to Step 4).
  - Step 4 (`4 / 7`): `search_tab_icon` (Bottom Nav Bar) — "Discover Online" (tooltip card sits cleanly above bottom bar; tapping tab navigates to Search & advances to Step 5).
  - Step 5 (`5 / 7`): `search_input_bar` (`Search` tab) — "Search a Song" (spotlights search bar; automatically advances to Step 6 when search results load).
  - Step 6 (`6 / 7`): `first_search_download_btn` (`Search` tab) — "Download Offline" (spotlights first download button with tooltip positioned below the row; on download completion, automatically sorts library by Last Download, navigates to Library, and advances to Step 7).
  - Step 7 (`7 / 7`): `first_track_item` (`Library` tab) — "Saved to Your Library!" (spotlights newly downloaded track; primary "Finish Tour" button saves `has_seen_onboarding_guide = 'true'` permanently in SQLite).
- [x] **Replay Option in Settings (`src/app/settings.tsx`)**:
  - "App Walkthrough" option under Help & Tour to replay the spotlight tour anytime.
