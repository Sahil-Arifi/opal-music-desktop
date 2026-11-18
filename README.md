# Opal Music Desktop (unofficial)

An independent, experimental macOS desktop interface for YouTube Music. Not affiliated with, endorsed by, or produced by Google or YouTube. YouTube and YouTube Music are trademarks of their respective owners.

This is a clean source snapshot, not the original private repository or its history. Demo artwork and icons are original placeholders; the preview uses fictional recordings. No account session, credentials, private playback reports, or listening-history exports are bundled. No project-wide open-source license has been selected, so public availability does not grant additional redistribution rights. Dependencies retain their own licenses.

Supported build target: Apple Silicon macOS. No Windows release is provided. Builds are locally signed and **not Apple-notarized**. This snapshot has not been live-tested on macOS; see PUBLICATION.md for the actual validation scope. Playback, sign-in and catalog availability depend on the first-party service. The app does not bypass ads, memberships, regional restrictions or authentication checks.

A personal Electron music app with an opal glass interface, artwork color flow, Home, playlists, liked songs, discovery radio, history, and a floating player.

## Sign in and listen

Click **Sign in with Google** for the in-app password flow. Google handles your password and any verification on its own page. The app allows Google's required account-to-YouTube cookie hand-off. No developer OAuth JSON is required.

For a saved passkey, choose **Sign in with passkey**. This opens a normal Google Chrome window in a temporary profile created only for this app. Complete Google's authentication and wait until YouTube Music is signed in. Return to the music app and click **Finish sign-in**. The app closes that temporary browser, transfers only the YouTube-scoped session into its dedicated partition, and verifies the actual signed-in service before opening your library. Existing Chrome profiles, their cookies, and saved passwords are not read or changed.

Passkeys use Chrome because this locally signed Electron app cannot access Google's saved platform passkeys directly. Chrome must be installed for that option. Password sign-in remains available inside the app. Cancel or quit cleans up the temporary sign-in profile.

Choose a playlist from the left sidebar or open **Liked Songs**, then play a track. Playback runs through YouTube Music's own first-party player in an isolated session inside the app. The artwork player controls that same session. The account window is available from Account → **Open account player**.

Google's sign-in checks, ads, availability and membership restrictions apply. If Google rejects authentication, the app reports that result and stays signed out. Advertisements use a first-party playback pane inside the existing app window, then return to the artwork interface.

## Library and playback

- Sign-in automatically loads the profile name and image, playlists, liked songs, saved songs, followed artists, and recent listening. Each first page appears while larger collections continue loading. Returning launches display the matching account’s cached metadata immediately while the session verifies and refreshes in the background.
- Library displays playlists. The top toolbar searches the account and catalog. Inside a playlist or Liked Songs it becomes **Search playlist**, with instant title, artist, and album filtering. Sorting can use YouTube Music's original/date-added order or local title, artist, and duration order.
- Drag playlist rows or use their keyboard reorder controls to save a custom order in this app. Playing from a playlist follows the selected order through Next, Previous, and the queue; a custom order does not modify the playlist on other devices.
- Shuffle and Repeat appear in the bottom, expanded, immersive, and mini players. Repeat cycles through Off, All, and One. Native queues use YouTube Music’s confirmed settings. Custom playlist queues shuffle remaining occurrences locally and restore surviving original order when shuffle turns off; Repeat All wraps that playlist, while Repeat One keeps its queue intact. Explicit Play next additions retain priority. Disliked recordings remain excluded from automatic repeat cycles.
- Playing a playlist preserves its YouTube Music queue context. Liked Songs uses the account's Liked Music queue.
- The bottom player, mini player, menu bar, and macOS media commands control the active session. Only confirmed playback updates listening history.
- Three-dot song menus provide Play next, queueing, likes, playlist additions, radio, artist/album discovery and copied share links. The queue supports dragging, keyboard reordering, removals and YouTube Music's available recommendation categories.
- Song and Video are explicit choices in Now Playing. A permitted music video plays inside the artwork pane; normal listening keeps the custom cover and avoids recommending its music-video counterpart as the next song.
- The Library and playlist settings offer playlist creation, name/description/privacy editing, custom images, saved membership, and sharing through YouTube Music's own forms. Cached cards open immediately; initial track pages display while large playlists continue loading. Playlist covers and exact counts hydrate in the background. YouTube-derived totals are labelled as videos until the complete Music collection supplies its track count.
- Home discovery uses the service's real shelves, with compact two-row layouts, three-page navigation, source refresh and personalized artist shelves. Sidebar categories scroll to the relevant Home section. Search records recent selections in the app's private account-scoped store.
- Listening Stats ranks songs, artists and albums across available account history and confirmed app plays. History continues syncing in the background. Measured listening time counts actual playback, excluding buffering and seeks, rather than guessing it from song duration.
- Likes and dislikes act through YouTube Music's own rating controls and also steer the local radio selection.
- Local audio import remains available. File imports reference your original files in place.
- **Import listening history** supports Google Takeout watch-history JSON or HTML. Only entries identifiable as YouTube Music populate music history. Reimporting the same entries does not create duplicates.

The integration follows the first-party site's rendered controls and collection cards, which can change when YouTube updates its web app. Home and playback errors report the actual connection or account state.

## Appearance

The desktop icon is an original equalizer tile with a transparent surround, not a service logo. The interface uses Inter typography, dark navigation, square sleeves, a clear artwork-tinted glass field, Motion for React for shared transitions, Paper Shaders for the brief launch lens, and native macOS glass support where available. Audio response updates only the active player surface, and the background has no continuous rendering loop.

Click the bottom player’s artwork, title, or empty background to slide it up within the same app. Starting a song leaves playback in the bottom bar. The far-right immersive control expands the cover to the left and credits to the right inside the existing window. Controls fade after inactivity and return on pointer or keyboard input. Up Next appears during the last fifteen seconds when the next track is known. The microphone control reveals centered, vertically following lyrics beside the sleeve. The volume bar spans the cover width, and a luminance-bounded artwork wash keeps white text readable even for pale covers; the queue control shows manual additions followed by YouTube Music's actual Up Next list. Collapse or press Escape to return to the library. Artwork colors flow through the canvas and tint the player glass.

Lyrics use verified recording matches from [AMLL TTML Database](https://github.com/amll-dev/amll-ttml-db) and [LRCLIB](https://lrclib.net/docs). Source word timestamps drive smooth karaoke highlighting; independently timed backing parts appear when their own cues are active. Enhanced LRC timestamps are retained. Recordings with only line timestamps use smooth line following without invented word timing. Clicking a cue seeks even while paused. Untimed lyrics stay a transcript. Panel and page motion draws on [Transitions.dev](https://transitions.dev/).

Musixmatch’s [official developer workspace](https://www.postman.com/musixmatch-dev) requires an authorized application key for its word-timing API. No key is included. The inspected first-party desktop lyrics panel supplied plain text without timestamps; the app does not invent karaoke timing when a recording lacks it.

Appearance offers **Full effects** or **Follow macOS**. Full effects is the per-app default. Follow macOS honors Reduce Motion and Reduce Transparency.

Subtle surface lighting follows the mouse across glass controls without drawing rectangular hover outlines. The active player’s glass responds to measured bass, midrange and treble from this app’s own audio. macOS may request system-audio permission; Account → Music-reactive glass retries permission or analysis setup. Audio is never recorded to disk and the native tap excludes other apps. A single pointer-transparent lighting plane updates per animation frame while the hit target stays stationary.

Artist, album, and song pages use the first-party catalog’s own audience and play-count labels where supplied. Artist pages include top songs, releases, and follow controls. Account shows followed artists. Home shows recent artists with genuine artist portraits, then recent songs and explicitly played albums/playlists, six per page across up to three pages.

Disliked recordings are excluded from automatic playback, including alternative uploads matched to the same recording. Likes, playlist changes and queue actions show confirmations after success. Account writes wait for service confirmation; a changed provider UI can still make an action fail visibly.

Keyboard shortcuts: Space plays/pauses; ⌘K focuses search; ⌘←/→ skips tracks; Option←/→ seeks ten seconds; ⌘↑/↓ adjusts volume; ⌘ShiftL opens lyrics; ⌘ShiftM toggles the mini player. Text fields retain normal typing behavior. Escape leaves the immersive view first, then collapses the expanded player.

Stats offers **Past week** (seven local calendar dates) and **Past month** (the prior calendar-month anniversary through today). Rankings count the history entries the service actually provides and plays recorded in this app. YouTube Music can omit repeat listens, so these are labeled as available-history rankings rather than complete account play counts. Each period shows its date range and coverage; entries with unknown dates cannot be assigned to a specific week or month, and imported history has no measured listening duration. Measured time counts actual playback in this app. Historical full recording lengths contribute only to a clearly marked estimate, with a separate breakdown. The available account-entry count is visible. Missing older activity or omitted repeat plays cannot be reconstructed from these cards.

## Responsive data and controls

Catalog results show actual artist portraits, albums, songs, and playlists with their type labels. Recent results, playlist tracks, catalog pages, artwork, and lyrics persist in private app caches. Cached content appears immediately and refreshes independently. New remote searches reuse YouTube Music’s loaded search page. Track changes reuse the loaded first-party watch route when it is ready, checking the selected media and playlist before accepting its events. An initial watch or failed in-page route uses a normal navigation fallback. Playback ticks use a small progress event instead of repeatedly serializing the library.

Like/dislike feedback fills immediately and animates. A queued write reconciles with the source, coalesces rapid clicks, and rolls back visibly on failure. Artist follows use the same immediate-feedback approach. Menus and pickers temporarily hide the native video surface so it cannot cover app controls. Song artwork shows play on hover, an equalizer while active, and pause on hover; paused equalizers stop.

## Design preview

Run `npm run preview:design` for a separately labeled, isolated design preview containing original abstract artwork and fictional recording metadata. Its timeline is simulated for visual review. It does not access an account or play recordings. Normal first launch contains no sample library.

## Development

Requires Node 24, npm, Xcode Command Line Tools and a macOS 26+ SDK for the native glass adapter.

- `npm ci`
- `npm start`
- `npm test`
- `npm run test:live` (real online playback in a disposable signed-out Mac profile)
- `npm run test:player` (rendered contrast and lyrics/volume geometry at two Mac window sizes)
- `npm run preview:design`
- `npm run package:mac`

Packaging produces `release/Opal-Music-Desktop-mac-arm64.zip` and `release/mac-arm64/Opal Music Desktop.app`. The archive is signed locally, without an Apple Developer distribution identity or notarization.

Collections and settings live in the app's Application Support folder. The first-party website session is in its `Partitions/youtube-music` subfolder. **Sign out** clears that dedicated session and account-specific data without touching other browsers.

Returning playback keeps the last recording and starts it at the beginning on the first Play press. Pause and resume within the same session retain the current position. One speaker button beside the volume slider toggles mute and restores the previous audible level. Artist and release rankings in Stats open their catalog pages. Explicit source Single and EP labels survive search, detail pages, and recent listening.

Playlist playback uses the selected visible snapshot while confirmed membership updates merge in the background. Likes update an open Liked Songs list, and confirmed playlist additions/removals update visible rows before source reconciliation. Private historical performance reports are intentionally not part of this public snapshot.

