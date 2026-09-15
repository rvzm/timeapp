# Appearance guide

**For:** everyone who wants to change how TimeApp looks for them, and admins choosing the default look.
Related: [Employee](EMPLOYEE.md) · [Manager](MANAGER.md) · [Admin](ADMIN.md) · [Quickstart](QUICKSTART.md)

- [Change your look](#change-your-look)
- [Style](#style)
- [Color](#color)
- [Light or dark](#light-or-dark)
- [Background](#background)
- [Good to know](#good-to-know)
- [Defaults for everyone (admins)](#defaults-for-everyone-admins)
- [Tuning and adding looks (hosts)](#tuning-and-adding-looks-hosts)

---

## Change your look
1. Click your name in the top right, then **Settings**.
2. In **Appearance**, pick a **Style**, a **Color**, **Light or dark**, and a **Background**. Each option has a small preview.
3. Click **Save theme**.

Your choice is saved to your account, so it follows you to any device you log in on.

![The Appearance settings](images/settings-appearance.png)

Until you save a choice, you get the app's default look, and the page says "You're using the app's default theme." To go back to the defaults later, click **Use the app default**.

---

## Style
A style changes fonts, corners, borders and shadows, but never colors, so every style works with every color.

| Style | Look |
|---|---|
| **Modern** | Rounded cards, soft shadows, your device's standard font. The default. |
| **Minimal** | Flat and quiet: the Inter font, no shadows, gentle corners, outlined buttons and badges. |
| **Terminal** | Monospace text and square boxes, uppercase headings with a `>` prompt and a blinking cursor, faint scanlines, and a soft glow in dark mode. |
| **Blueprint** | Like a technical drawing: the Space Grotesk font, uppercase monospace labels, a faint grid on cards with corner marks, and dashed input boxes. |

| Modern | Minimal |
|---|---|
| ![Modern style](images/style-modern.png) | ![Minimal style](images/style-minimal.png) |
| **Terminal** | **Blueprint** |
| ![Terminal style](images/style-terminal.png) | ![Blueprint style](images/style-blueprint.png) |

---

## Color
**Standard** (blue), **Ocean** (blue and teal), **Forest** (green), **Sunset** (orange and coral), **Grape** (purple) or **Fire** (red, with warm backgrounds). Each color has a light and a dark version; the two swatches show both.

## Light or dark
- **Match my device**: follows your phone or computer's light/dark setting, and switches when it does.
- **Light** or **Dark**: always that.

## Background
Backgrounds are drawn behind the page in your color. Cards stay solid, so text is just as readable.

| Background | Look | Moves? |
|---|---|---|
| **None** | Plain | |
| **Glow** | Soft, blurry blobs of color | |
| **Aurora** | The Glow blobs, slowly drifting | Yes |
| **Dots** | Dotted paper that fades out toward the bottom | |
| **Grain** | A wash of color with a film-grain texture | |
| **Waves** | Rows of rolling waves along the bottom | Yes |
| **Starfield** | Small specks that slowly shimmer and drift | Yes |
| **Cityscape** | A skyline along the bottom, with lit windows | |

The moving backgrounds hold still if your device's **reduce motion** accessibility setting is on.

---

## Good to know
- **Any combination works.** Style, color, light/dark and background are all independent.
- **Timesheets are never themed.** Printed timesheets, saved PDFs and downloaded images are always plain black on white.
- **Looks unchanged or broken after the app was updated?** Your browser may still have the old styles. Do a hard reload: **Ctrl+Shift+R**, or **Cmd+Shift+R** on a Mac.

---

## Defaults for everyone (admins)
Under **Admin → Settings**, set **Default style**, **Default color theme**, **Default light or dark** and **Default background**. They apply to the login page and to everyone who hasn't saved a look of their own. People who have chosen keep their choice. See the [Admin guide](ADMIN.md#settings).

---

## Tuning and adding looks (hosts)
- **Starting defaults** are in `config.js`, under `ui_config` (`defaultStyle`, `defaultColor`, `defaultTheme`, `defaultBackground`). They're used until an admin saves **Admin → Settings**.
- **Fine-tuning** happens at the top of `public/timeapp.css`, in section 1:
  - `--bg-glow-strength`: how strongly every background is tinted with the theme color.
  - `--bg-glow-dark-boost`: how much stronger backgrounds are in dark mode.
  - `--aurora-duration`, `--waves-duration`, `--starfield-duration`: animation speeds. Bigger is slower.
- **Adding a color:** add a light and a dark palette block to section 2 of `public/timeapp.css`, then add the name to `THEME_COLORS` and `THEME_COLOR_LABELS` in `themes.js`.
- **Adding a style:** add a block overriding the style variables (and any component rules) to section 9 of `public/timeapp.css`, then add the name to `THEME_STYLES` and `THEME_STYLE_LABELS` in `themes.js`. If it needs a font, serve an `@fontsource` package from `server.js` and link it in `views/partials/head.ejs`.
- **Adding a background:** add a rule to the "Backgrounds" block of `public/timeapp.css`. It draws on `body::before`, with a matching `.bg-swatch` preview; animate only `transform` or `opacity`, and add a reduce-motion rule. Then add the name to `THEME_BACKGROUNDS` and `THEME_BACKGROUND_LABELS` in `themes.js`.
- None of these need a database change. After updating the live site, remember the stylesheet cache note in the [Quickstart](QUICKSTART.md#behind-nginx-and-cloudflare).
