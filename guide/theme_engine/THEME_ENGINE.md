# Theme engine

**For:** anyone curious how TimeApp's looks work, admins choosing defaults, and hosts adding their own.
The short version is the [Appearance guide](../APPEARANCE.md). This one shows every option and explains how the pieces fit together.
Related: [Employee](../EMPLOYEE.md) · [Admin](../ADMIN.md) · [Quickstart](../QUICKSTART.md)

- [How a look is put together](#how-a-look-is-put-together)
- [Light or dark: the top-bar button](#light-or-dark-the-top-bar-button)
- [Styles](#styles)
- [Colors](#colors)
- [Backgrounds](#backgrounds)
- [Who gets which look](#who-gets-which-look)
- [Defaults and settings](#defaults-and-settings)
- [Tuning](#tuning)
- [Adding your own](#adding-your-own)

The pictures of styles and colors show an employee's **My Portal → Home** page on the **Glow** background. The background pictures use the **Clock** page, which leaves most of the screen open, in **Modern · Standard · Light**.

---

## How a look is put together
A look is four separate choices. Any combination works, because each one only touches its own part of the page:

| Part | Changes | Never changes | Set on `<html>` as |
|---|---|---|---|
| **Style** | Fonts, corners, borders, shadows, heading case, card patterns | Colors | `data-style` |
| **Color** | Every color: page, cards, text, borders, the accent | Shapes or fonts | `data-color` |
| **Light or dark** | Which of the color's two palettes is used | Anything else | `data-theme` (and `data-mode`) |
| **Background** | What's drawn behind the cards, tinted from the color's accent | The cards themselves, so text stays readable | `data-bg` |

The server writes those attributes in `views/partials/head.ejs`, so the right look is there before the page paints. There's no flash of the wrong theme. All of it lives in one stylesheet, `public/timeapp.css`:

| Section | What's there |
|---|---|
| 1. Configurable defaults | The style tokens (these are also the Modern style) and the background tuning knobs |
| 2. Themes | The Standard light and dark palettes, then a light and dark block for each color. The **Backgrounds** block follows. |
| 9. Styles | One block per style, overriding the section 1 tokens, plus that style's component rules |

Printed timesheets, saved PDFs and downloaded timesheet images ignore all of this. They're always plain black on white.

---

## Light or dark: the top-bar button
| Light (click for dark) | Dark (click for light) |
|---|---|
| ![The moon button, shown in light mode](images/toggle-light.webp) | ![The sun button, shown in dark mode](images/toggle-dark.webp) |

The button sits in the top bar, left of your name. It shows a **moon** while the page is light and a **sun** while it's dark. Click it and the page switches straight away.

- **Logged in:** your choice is saved to your account, so it follows you to other devices.
- **On the login page:** it's remembered in that browser with a cookie, if the admin allows it (see [Defaults and settings](#defaults-and-settings)).
- **Before you've ever clicked it**, you get the default. That can be **Match my device**, which follows your phone or computer's own light/dark setting and switches when it does. Clicking the button ends that: from then on it stays how you left it.

Every color has both versions, so the button works with any color. The [Colors](#colors) section shows each pair.

How it works: the button is a small form (`POST /theme-mode`) in `views/partials/nav.ejs`. `public/mode-toggle.js` flips `data-theme` on the page and saves in the background. Without JavaScript, the form submits normally and brings you back to the same page.

---

## Styles
A style changes shape and feel. It never sets a color, so every style works with every color and background. Each one overrides the **style tokens** from section 1 of the stylesheet: `--font-family`, `--font-heading`, `--heading-transform`, `--radius`, `--border-width`, `--edge`, `--shadow-pop`, `--shadow-big`, `--card-pattern`, and so on. Some also add a few rules of their own.

### Modern
![Modern style](images/style-modern.webp)

The default. Your device's standard font, rounded corners (`--radius: 10px`), soft shadows and thin borders. These are the section 1 values themselves.

### Minimal
![Minimal style](images/style-minimal.webp)

Pared back. The **Inter** font, small corners, no shadows, and hairline rules instead of borders. Cards and the top bar have no outlines, badges are plain, and buttons are outlined instead of filled.

### Boxworld
![Boxworld style](images/style-boxworld.webp)

Everything is a box. Square corners, 2px outlines in the text color (`--edge: var(--text)`), and no shadows or tinted fills. Tabs and tables are boxed, and main buttons are solid.

### Terminal
![Terminal style](images/style-terminal.webp)

A console. **JetBrains Mono** everywhere, square corners, and uppercase headings with a `>` prompt and a blinking cursor. Faint scanlines run over the page, and there's a soft glow on text in dark mode. The scanlines use `body::after`, which is why no background may use that layer.

### Blueprint
![Blueprint style](images/style-blueprint.webp)

A technical drawing. The **Space Grotesk** font, uppercase monospace labels, a faint grid on cards with marks at their corners (`--card-pattern`), and dashed input boxes. Borders take a tint of the accent color.

The fonts are served from npm packages (`@fontsource-variable/inter`, `jetbrains-mono`, `space-grotesk`). A font only downloads when the page uses it.

---

## Colors
Each color is a pair of palettes, one for light and one for dark. Each palette sets the page background (`--bg`), cards (`--surface`, `--surface-2`), text (`--text`, `--muted`), borders (`--border`), and the **accent** (`--accent`). The accent is the color of main buttons, the current tab, links, focus rings and progress bars, and it tints the background.

Status colors are shared by every color, so clocked in, on break and errors always look the same: green for **clocked in**, amber for **on break**, slate for **clocked out**, and red for **danger**.

### Standard
| Light | Dark |
|---|---|
| ![Standard, light](images/color-standard-light.webp) | ![Standard, dark](images/color-standard-dark.webp) |

Blue (`#2563eb`) on cool gray. The default.

### Ocean
| Light | Dark |
|---|---|
| ![Ocean, light](images/color-ocean-light.webp) | ![Ocean, dark](images/color-ocean-dark.webp) |

Teal (`#0e7490`) on a pale blue-green page, or deep blue-green in dark mode.

### Forest
| Light | Dark |
|---|---|
| ![Forest, light](images/color-forest-light.webp) | ![Forest, dark](images/color-forest-dark.webp) |

Green (`#2f7d45`) on a faint green page, or a very dark green one.

### Sunset
| Light | Dark |
|---|---|
| ![Sunset, light](images/color-sunset-light.webp) | ![Sunset, dark](images/color-sunset-dark.webp) |

Burnt orange (`#c2410c`) on a warm peach page, or dark brown.

### Grape
| Light | Dark |
|---|---|
| ![Grape, light](images/color-grape-light.webp) | ![Grape, dark](images/color-grape-dark.webp) |

Purple (`#6d28d9`, a little brighter at `#7c3aed` in dark mode) on lavender, or near-black violet.

### Fire
| Light | Dark |
|---|---|
| ![Fire, light](images/color-fire-light.webp) | ![Fire, dark](images/color-fire-dark.webp) |

Red (`#b91c1c`, brighter `#dc2626` in dark mode) with warm backgrounds and slightly warm cards.

### Beach
| Light | Dark |
|---|---|
| ![Beach, light](images/color-beach-light.webp) | ![Beach, dark](images/color-beach-dark.webp) |

Light sky blue (`#4fb3e0`) on cool sand. The accent is too pale for thin lines on a light page, so this color sets a darker `--accent-line` for focus rings and the current tab.

### Mountain
| Light | Dark |
|---|---|
| ![Mountain, light](images/color-mountain-light.webp) | ![Mountain, dark](images/color-mountain-dark.webp) |

Slate gray (`#5d646e`) on off-tone gray. In dark mode the accent flips to a soft white (`#dcdad4`), so buttons become light-on-dark.

### Plum
| Light | Dark |
|---|---|
| ![Plum, light](images/color-plum-light.webp) | ![Plum, dark](images/color-plum-dark.webp) |

Reddish purple (`#a3336e`, pinker `#d0679f` in dark mode) on cool, purplish backgrounds.

### Obsidian
| Light | Dark |
|---|---|
| ![Obsidian, light](images/color-obsidian-light.webp) | ![Obsidian, dark](images/color-obsidian-dark.webp) |

Dark purple (`#5a2ea6`) and black on crisp lavender, or purple (`#7c4ae8`) on near-black in dark mode.

---

## Backgrounds
Backgrounds are drawn on a fixed layer behind the page (`body::before`, plus `html::after` where a second layer is needed). They're tinted from the color's accent through `--bg-tint`, so every background works with every color and needs no per-color CSS. Cards stay solid on top. The moving ones animate only `transform` and `opacity`, stop when your device asks for **reduced motion**, and never print.

### None
![No background](images/bg-none.webp)

The plain page color.

### Glow
![Glow background](images/bg-glow.webp)

Soft, blurry blobs of the accent color in the corners. It's Aurora standing still, and the background in every other picture in this guide.

### Aurora (moves)
![Aurora background](images/bg-aurora.webp)

The Glow blobs, slowly drifting (`--aurora-duration`, 20s per drift).

### Dots
![Dots background](images/bg-dots.webp)

Dotted paper that fades out toward the bottom of the screen.

### Grain
![Grain background](images/bg-grain.webp)

A wash of the accent with a film-grain texture: a tiny SVG noise tile laid over the color.

### Waves (moves)
![Waves background](images/bg-waves.webp)

Rows of rolling waves along the bottom (`--waves-duration`, 40s per loop).

### Starfield (moves)
![Starfield background](images/bg-starfield.webp)

Small specks that slowly shimmer and drift. They sit on three odd-sized tiles, so no grid shows. It shows up best in dark mode.

### Cityscape
![Cityscape background](images/bg-cityscape.webp)

A skyline along the bottom, with lit windows.

### Farm (the windmill turns)
![Farm background](images/bg-farm.webp)

A farm along the bottom: barn, silo, farmhouse, fence, trees and a windmill. The windmill's blades are the second layer (`html::after`) and turn once every `--farm-blades-duration` (24s).

### Cornershot (moves)
![Cornershot background](images/bg-cornershot.webp)

The app name bouncing around the screen like an old DVD logo, changing color each time it hits a wall, and never quite hitting a corner. With reduced motion it waits just short of the bottom-right corner. It's set up in `config.js` (see [Tuning](#tuning)).

---

## Who gets which look
For each of the four parts, TimeApp uses the first of these that applies:

| Part | 1. The person's own choice | 2. The app default |
|---|---|---|
| Style, color, background | Saved in **Settings → Appearance** | **Admin → Settings** (or `config.js` until an admin saves) |
| Light or dark | The top-bar button: on the account when logged in, or the browser cookie on the login page | **Default light or dark**, which may be **Match my device** |

- **Use the app default** in Settings → Appearance clears all four choices, light/dark included.
- If an admin turns the top-bar button off, everyone gets the default light or dark. What people picked earlier is kept, and comes back if the button is turned on again.
- A saved value the app no longer knows, for example a removed color, quietly falls back to the default.

This all happens in `themeFor()` in `themes.js`.

---

## Defaults and settings
**Admin → Settings → Appearance and logins:**

| Setting | What it does |
|---|---|
| **Default style**, **Default color theme**, **Default background** | For the login page and anyone who hasn't picked their own |
| **Default light or dark** | **Match my device**, **Light** or **Dark**, for the login page and anyone who hasn't used the button |
| **Show the light/dark button in the top bar** | Off = no button, and everyone gets the default |
| **Let people switch light/dark on the login page too** | On = the button also appears when logged out, remembered in that browser (a cookie called `timeapp_mode`) |

The same settings start life in `config.js` under `ui_config`, and those values are used until an admin saves **Admin → Settings**:

```js
export const ui_config = {
  defaultStyle: "modern",
  defaultColor: "standard",
  defaultTheme: "system",   // "system", "light" or "dark"
  showModeToggle: true,     // the top-bar light/dark button
  rememberGuestMode: true,  // the button on the login page, remembered in a cookie
  defaultBackground: "aurora",
};
```

---

## Tuning
In section 1 of `public/timeapp.css`:

| Variable | Default | What it does |
|---|---|---|
| `--bg-glow-strength` | `16%` | How strongly every background is tinted with the accent |
| `--bg-glow-dark-boost` | `1.375` | How much stronger backgrounds are in dark mode (16% becomes 22%) |
| `--aurora-duration` | `20s` | One drift of Aurora; bigger is slower |
| `--waves-duration` | `40s` | One loop of Waves |
| `--starfield-duration` | `8s` | One shimmer of Starfield |
| `--farm-blades-duration` | `24s` | One turn of Farm's windmill |
| `--standard-accent` | `#2563eb` | The Standard color's accent |
| `--status-in`, `--status-break`, `--status-out`, `--danger` | green, amber, slate, red | The status colors every palette shares |

Cornershot is set in `config.js` under `cornershot_config`, and needs a server restart:

| Key | What it does |
|---|---|
| `text` | The logo text, up to 40 characters; empty uses the app name |
| `size` | Width in pixels; the height is half that |
| `xSeconds`, `ySeconds` | Seconds to cross the screen side to side and top to bottom (whole numbers) |
| `nearMissSeconds` | How far out of step the two directions run. Keep it off multiples of the largest number dividing both durations, so it can never hit a corner exactly; the server warns and corrects it if not |
| `colorShift` | Change color on each hit |
| `opacity` | How visible it is, 0 to 1 |

---

## Adding your own
None of these need a database change: people's choices are stored as plain names. After changing the live site, remember the stylesheet cache note in the [Quickstart](../QUICKSTART.md#behind-nginx-and-cloudflare).

**A color**
1. In section 2 of `public/timeapp.css`, add a `[data-color="yours"]` block (light) and a `[data-color="yours"][data-theme="dark"]` block. Set `--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--border` and `--accent`.
2. Set `--accent-contrast` to a color that reads on your accent; it's the text on main buttons.
3. If the accent is too pale to see as a thin line (like Beach), set a darker `--accent-line` in the light block, and reset it to `var(--accent)` in the dark block if dark mode doesn't need it.
4. Add the name to `THEME_COLORS` and `THEME_COLOR_LABELS` in `themes.js`. It appears in Settings and Admin → Settings straight away.

**A style**
1. In section 9, add a `[data-style="yours"]` block overriding the style tokens, plus any rules for particular components. Don't set colors: use the palette variables (`--accent`, `--edge`, `--text`…) so every color keeps working.
2. Add the name to `THEME_STYLES` and `THEME_STYLE_LABELS` in `themes.js`.
3. If it needs a font, serve an `@fontsource-variable/*` package from `server.js` (under `/vendor/fonts/<name>`) and link it in `views/partials/head.ejs`. Don't link Open Props' `fonts.min.css`: it redefines `--font-mono`.
4. The Settings preview cards use the same tokens, so your style previews itself.

**A background**
1. Add a `[data-bg="yours"] body::before` rule to the "Backgrounds" block after section 2. Tint it with `--bg-tint`.
2. For a second layer, use `html::after` (as Farm does). `body::after` belongs to the Terminal style.
3. Size scenes in `--bg-u-w` / `--bg-u-h` units: they mean the screen on the page and the preview box in Settings, so one set of rules draws both. Give it a matching `.bg-swatch` rule for the preview.
4. If it moves, animate only `transform`, `translate` or `opacity`, and add a `prefers-reduced-motion` rule that stops it.
5. Add the name to `THEME_BACKGROUNDS` and `THEME_BACKGROUND_LABELS` in `themes.js`.
