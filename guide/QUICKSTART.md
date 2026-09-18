# Quickstart

**For:** whoever installs and runs TimeApp, and the first admin who sets it up.
Using the app day to day is in the role guides: [Employee](EMPLOYEE.md) · [Manager](MANAGER.md) · [Admin](ADMIN.md) · [Appearance](APPEARANCE.md).

- [Part 1: Hosting](#part-1-hosting)
  - [Requirements](#requirements)
  - [Install and create the first admin](#install-and-create-the-first-admin)
  - [Configure config.js](#configure-configjs)
  - [Run it](#run-it)
  - [Behind nginx and Cloudflare](#behind-nginx-and-cloudflare)
  - [Updating](#updating)
  - [Backups](#backups)
- [Part 2: Your first 10 minutes as admin](#part-2-your-first-10-minutes-as-admin)

---

## Part 1: Hosting

### Requirements
- **Node.js 22 or newer.** Older versions are missing JavaScript features TimeApp uses.
- **Build tools, just in case.** `npm` normally downloads a prebuilt `better-sqlite3`. If none exists for your platform, it compiles one, which needs a C/C++ toolchain and Python (on Debian/Ubuntu: `build-essential` and `python3`).
- **Nothing else.** The database is one SQLite file in `data/`, created the first time the server starts.

### Install and create the first admin
```sh
npm install
npm run seed -- admin
```
`npm run seed -- <username> [password]` creates an **admin** account. If you leave out the password, a random one is printed once, so write it down. You can run it again later to add more admins. To make an employee or manager instead, use `npm run seed -- user <username> [password] --role employee` (or `--role manager`); `npm run seed -- --help` lists every option.

### Configure config.js
Open `config.js`. Restart the server after every change.

| Setting | What to set |
|---|---|
| `session_config.secret` | **Required.** A long random string; it signs login cookies. The server prints a warning while it's still `"changeme"`. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `session_config.secure` | `true` when people reach the site over HTTPS (behind nginx, Cloudflare, etc.), so login cookies are only ever sent over HTTPS. |
| `server_config.port` / `host` | Defaults to `localhost:3000`. Keep `localhost` behind a reverse proxy. Use `"0.0.0.0"` only if other machines need to reach the app directly. |
| `time_config.timezone` | The timezone every time is shown and entered in, as an IANA name like `"America/Chicago"`. Empty means the server's own timezone. |
| `time_config.locale` | How dates and times are written (default `"en-US"`). |
| `account_config.minPasswordLength` | Shortest allowed password (default 8). |

Settings marked `[setting]` in the file are only **starting defaults**: timezone, clock format, week start, appearance, login length, failed-login locking, grace minutes, edit requests and break rules. Once an admin saves **Admin → Settings** or **Manage → Break rules**, the saved values win, and changing `config.js` no longer affects them.

### Run it
| Command | What it does |
|---|---|
| `npm start` | Starts the server in the background and gives your terminal back once it's answering. Output goes to `data/timeapp.log`. |
| `npm stop` | Stops it. Requests in progress finish and the database closes cleanly. |
| `npm run restart` | Stop, then start. Use it after editing `config.js` or updating. |
| `npm run status` | Shows whether it's running. |
| `npm run serve` | Runs in the foreground; Ctrl+C stops it. |
| `npm run dev` | Foreground, restarting whenever a file changes (for development). |

**Under systemd, Docker, or another process manager, use `npm run serve`** (or `node server.js`). Those tools expect the process to stay in the foreground, and `npm start` exits as soon as the server is up. A minimal systemd unit:

```ini
[Unit]
Description=TimeApp
After=network.target

[Service]
WorkingDirectory=/srv/timeapp
ExecStart=/usr/bin/npm run serve
Restart=on-failure
User=timeapp

[Install]
WantedBy=multi-user.target
```

### Behind nginx and Cloudflare
Keep `server_config.host` as `localhost` and forward requests to the app:

```nginx
server {
    listen 443 ssl;
    server_name timeapp.example.com;
    # ssl_certificate / ssl_certificate_key, or let Cloudflare handle TLS

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then set `session_config.secure: true` in `config.js` and restart.

Behind a proxy, the **Address** column on **Admin → Logins** shows the proxy's address for everyone, because the app records the address it is connected from and doesn't trust forwarded headers (anyone can send those). The rest of the page — who's signed in, when, and on what — works the same.

> **Styles look old after an update?** Pages are never cached, but the stylesheet can be. Cloudflare's default browser cache keeps files like `/timeapp.css` for 4 hours, so people can get new pages with old styles for a while (for example, new backgrounds that don't show). A hard reload (**Ctrl+Shift+R**, or **Cmd+Shift+R** on a Mac) fixes it for one browser. **Caching → Purge Cache** in Cloudflare fixes it for everyone.

### Updating
```sh
npm run backup     # copies the database and config.js into backup/
npm stop
# update the files: git pull, or upload the new version (don't upload over data/ or backup/)
npm install        # new versions can add packages
npm run migrate    # shows what it will do, asks, then restores and upgrades
npm start
```

`npm run migrate` does two things:
- **Settings:** every setting in `backup/config.js` that differs from the new `config.js` (your secret, port, timezone, and so on) is written into the new `config.js`. Only the values change; the comments and any new settings are kept. Settings the new version no longer has are listed and skipped, and a few renamed values are updated for you (e.g. the old "Vanilla" color becomes "Plum").
- **Database:** `backup/timeapp.sqlite` is put in `data/` and upgraded to the new version. You'll see a `Database migrated to version N.` line for each change, then a check that everything is intact.

It shows the full list first and asks before changing anything. Answer **c** to pick settings one at a time. `npm run migrate -- --dry-run` only shows the list, and `--yes` skips the question. Nothing is lost:
- the database it replaces is kept as `data/timeapp.sqlite.before-migrate-<date>`
- the new `config.js` as it was is kept as `config.js.before-migrate`
- if the upgrade fails, the earlier database is put back

It won't run while the server is up, and it refuses a backup from a *newer* version of TimeApp. An older version of TimeApp still runs on an upgraded database, so rolling back the code is safe.

If you'd rather not use the commands, the manual way still works: stop the server, keep your `data/` folder and `config.js`, update the other files, run `npm install`, copy your changed settings into the new `config.js`, and start. The database upgrades itself at startup.

### Backups
Run `npm run backup` any time, even while the server is running. It saves a consistent copy of the database and your `config.js` into `backup/`, and moves the previous backup into `backup/previous/`.

**Keep `backup/` private.** It holds your session secret and everyone's data (it's in `.gitignore`). Copy it somewhere off the server for safekeeping.

To restore, stop the server and run `npm run migrate`. You can point it at another folder with `npm run migrate -- /path/to/backup`; the folder needs a `config.js` (or `config.js-bak`) and/or a `.sqlite` file.

---

## Part 2: Your first 10 minutes as admin

1. **Log in** with the account you created with `npm run seed`. Admins land on **Admin**.
2. **Check Admin → Settings.** In particular:
   - **Timezone**: every time in the app uses it.
   - **Weeks start on**: affects weekly views and exports.
   - **Mode** under **Punch edit requests**: whether employees can ask for punch fixes, and whether a manager has to approve them.
   - **Failed logins**: how many wrong passwords in a row lock an account, and for how long. Locked accounts are unlocked under **Admin → Logins**, which also shows who's signed in.

   Every field is explained in the [Admin guide](ADMIN.md#settings).
3. **Set break rules** under **Manage → Break rules**: how many breaks per shift, and how long each can be before it's flagged. Leave a field blank for no limit.
4. **Add accounts** with **Add account** on the **Admin** page:
   - **Employee**: Clock and their own Portal.
   - **Manager**: also the Manage pages, for employee accounts.
   - **Admin**: everything, including accounts and settings.
5. **Hand out logins.** Give each person their username and starting password. They can change the password under **Settings** (the menu under their name) and set their **Availability** under **Profile**. Point them to the [Employee](EMPLOYEE.md) or [Manager](MANAGER.md) guide.
6. **Change your own password** under **Settings**, especially if the seed command generated it.
