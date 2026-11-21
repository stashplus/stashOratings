# Stash+ O Ratings

Stash+ O Ratings is a companion plugin for [Stash](https://github.com/stashapp/stash) and [Stash+](https://github.com/stashplus/stashplus). It lets you rate and comment on every individual O, not just on the scene as a whole.

It works on its own, but the ratings and comments it saves are also used by Stash+ for its O Ratings tab, the O rating achievements and the day view in the Monthly Breakdown.

## Features

- After you press the O button on a scene, a small popup asks for a rating (0–10) and an optional comment. You can skip it.
- The scene's **History** tab shows each O's rating and comment next to it, and lets you edit them.
- O ratings are independent of the scene rating. By default, nothing happens to a scene's first O.
- **Settings → Plugins** has a button, *Set first O ratings from scene ratings*, that does a one-time copy of each scene's current rating onto its first O. It is a snapshot, not a link: later changes to the scene rating do not change it, and existing first-O ratings are never overwritten.
- Ratings and comments are stored in this plugin's configuration in Stash. Nothing leaves your instance.

## Installation

### From the plugin source (recommended)

1. In Stash, go to **Settings → Plugins → Available Plugins**.
2. Click **Add Source** and fill in:
   - **Name:** `Stash+ O Ratings`
   - **Source URL:** `https://stashplus.github.io/stashoratings/index.yml`
   - **Local Path:** `stashoratings`
3. Expand the new source, tick **Stash+ O Ratings** and click **Install**.
4. Hard-refresh the page (Ctrl+F5).

Stash will offer updates here when a new version is released.

### Manual

Copy the `stashOratings` folder from this repo into the `plugins` folder of your Stash configuration directory (next to `config.yml`), then go to **Settings → Plugins**, click **Reload Plugins** and hard-refresh the page.

## Notes

- The plugin's ID is `stashOratings`. Your saved ratings live under that ID, so do not rename the folder or the `.yml` file.
- The settings button is placed under the plugin's heading on the Plugins page. If it does not appear, the same action is available from the browser console: `await window.stashORatings.fillFirstORatings()`.
- Other plugins can read the data through `window.stashORatings.getAll()` (ratings) and `window.stashORatings.getComments()` (comments), both keyed by `sceneId|timestampInMs`.
