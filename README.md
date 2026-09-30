# SOVEREIGN v5 — shared online world

This folder is a complete website. Put it on Netlify (free, no card) and SOVEREIGN runs online:
the world keeps moving at 1× even when nobody is playing, and you and your friends each lead a
country in it.

## What you need
- A free GitHub account (github.com)
- A free Netlify account (netlify.com). Sign up with your GitHub account.

## Part 1: Put the files on GitHub

**The important part:** when you upload, GitHub must keep the folders. If it doesn't, Netlify
can't find `netlify/functions` or `server`, and the deploy fails with "Deploy directory does not exist".
The safest way is GitHub Desktop.

### The reliable way — GitHub Desktop (about 5 minutes)
1. Download **GitHub Desktop** from desktop.github.com. Install it and sign in with your GitHub account.
2. On github.com, click **+** (top right) → **New repository**. Name it `sovereign`, choose **Private**, and click **Create repository**.
3. On the empty repository page, click **Set up in Desktop**. GitHub Desktop opens and asks where to save the folder. Choose a place and click **Clone**.
4. Open that new `sovereign` folder in your file manager. **Copy every file and folder from the unzipped `sovereign-online` folder into it.** The `sovereign` folder should end up with `index.html`, `netlify.toml`, `package.json`, `package-lock.json`, `devserver.mjs`, `README.md`, and the two subfolders `netlify` and `server`.
5. Back in GitHub Desktop, you'll see a list of files ready to commit on the left. Type a short message like `first commit`, click **Commit to main**, then **Push origin**.

Check on github.com that your repository shows the two subfolders `netlify` and `server` (not just loose files).

### The web-only way (only if you can't install GitHub Desktop)
GitHub's browser drag-and-drop sometimes flattens folders — that's what broke the last try. Do it one folder at a time instead:
1. New repository as above. On the empty repository, click **Add file** → **Upload files**.
2. In your file manager, open the unzipped `sovereign-online` folder. Select `index.html`, `netlify.toml`, `package.json`, `package-lock.json`, `devserver.mjs`, `README.md` (only the loose files, not the subfolders). Drag them in. Click **Commit changes**.
3. Now the subfolders, one at a time. Click **Add file** → **Create new file**. In the filename box, type `netlify/functions/placeholder.txt` and click **Commit changes**. This creates the folder.
4. Click into `netlify/functions`. Click **Add file** → **Upload files**, drag `api.mjs` and `tick.mjs` in, and commit.
5. Delete the placeholder: click it, then the trash-can icon, then **Commit changes**.
6. Repeat 3–5 for `server`: create `server/placeholder.txt`, upload `core.mjs` and `engine.mjs` into it, then delete the placeholder.

## Part 2: Put it on Netlify

If your first attempt failed, **delete the failed Netlify site first**: in Netlify, open the project → **Project configuration** → **General** → scroll down → **Delete project**. Then start these steps fresh.

1. On netlify.com, sign up with **GitHub** (or log in).
2. Click **Add new project** → **Import an existing project** → **GitHub**, and allow access (you can allow only the `sovereign` repository).
3. Pick `sovereign`. Leave the settings as they are and click **Deploy**.
4. Wait a minute or two until it says **Published**. Your address looks like `something-123.netlify.app`. You can rename it under **Project configuration → Change project name**.

## Part 3: Start the world
1. Open your address. Choose **Create the world**: enter your name, a PIN you will remember, and an invite code for your friend. Then pick your country.
2. Send your friend the address and the invite code. They open it and click **Join as a new player**.
3. Next time, just open the address. Your browser remembers your login. On a new device, log in with your PIN.

## How it works
- The world runs at 1× (4 days per real minute, about 16 game years per real day). It never pauses.
- The first browser to open the game runs the world. The others follow it live. If that player leaves, another player's browser takes over by itself.
- When nobody has the game open, the server moves the world forward every 30 minutes.
- While you are away, your country keeps its policies. Decisions you miss take their default answer.
- Up to 4 players. Only one world per site. The player who created it can delete it (Menu → Delete this world).
- Backups: Menu → **Download backup**. A backup can also be played offline on its own.

## Staying inside the free plan
Netlify's free plan gives 300 credits a month. Rough use:
- About 45 credits a month for the half-hourly timer
- 15 credits each time the site is deployed (including the first time)
- About 1.5 credits per hour while two players are online, about 0.4 per hour for one

If the credits run out, the site pauses until the next month. The world is kept. You can see your usage in Netlify under your team's **Usage & billing** page.

## Updating the game later
Replace the files in your GitHub repository with the new ones (GitHub Desktop makes this easy: drop the new files into the same local folder, then commit and push). Netlify redeploys automatically. The world is kept.

## If something goes wrong
- **The deploy fails with "Deploy directory does not exist" or "targets a non-existing directory: netlify/functions":** the folders didn't get uploaded, only the files. Delete the failed Netlify site (Part 2 has how), delete the repository on GitHub, and redo Part 1 with GitHub Desktop or the web-only way above.
- **You see the normal offline start screen, not the online one:** the server part isn't running. In Netlify, open your project's **Functions** page (under **Logs**) and check that `api` and `tick` are listed. If not, check the deploy log for errors.
- **Stuck on "Joining…":** the other player's game may be in a background tab. Wait a minute, or ask them to switch to it.
- **"Please log in again":** the world was deleted or reset.
- Play in one tab at a time. Chrome, Edge or Firefox on a computer work best. Other browsers may need to re-sync now and then; this happens automatically.

## Testing on your own computer (optional)
With Node.js 20 or newer installed: `npm install`, then `node devserver.mjs 8888`, then open http://localhost:8888.
