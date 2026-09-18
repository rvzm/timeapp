// Themes: a color theme plus light or dark mode. Every color has a light and a dark
// version (the palettes are in section 2 of public/timeapp.css). Each person picks theirs
// in Settings (the menu under their name); anyone who hasn't gets the default from Admin → Settings.
// To add a color: add its light and dark palette blocks to the CSS and its name here.
// A background style sits behind the page (the "Backgrounds" block in the CSS, keyed by
// data-bg on <html>); it's tinted from the theme's accent color, so it works with every color.
// All of them draw on one fixed layer, body::before (body::after belongs to the Terminal style).
// A style changes shape and feel: fonts, corners, borders, shadows (data-style on <html>;
// section 9 of the CSS overrides the style tokens from section 1). It never sets colors.

export const THEME_COLORS = ["standard", "ocean", "forest", "sunset", "grape", "fire", "beach", "mountain", "plum", "obsidian"];

export const THEME_COLOR_LABELS = {
  standard: "Standard",
  ocean: "Ocean",
  forest: "Forest",
  sunset: "Sunset",
  grape: "Grape",
  fire: "Fire",
  beach: "Beach",
  mountain: "Mountain",
  plum: "Plum",
  obsidian: "Obsidian",
};

export const THEME_MODES = ["system", "light", "dark"];

export const THEME_MODE_LABELS = {
  system: "Match my device",
  light: "Light",
  dark: "Dark",
};

export const THEME_BACKGROUNDS = ["none", "glow", "aurora", "dots", "grain", "waves", "starfield", "cityscape", "farm", "cornershot"];

export const THEME_BACKGROUND_LABELS = {
  none: "None",
  glow: "Glow",
  aurora: "Aurora",
  dots: "Dots",
  grain: "Grain",
  waves: "Waves",
  starfield: "Starfield",
  cityscape: "Cityscape",
  farm: "Farm",
  cornershot: "Cornershot",
};

export const THEME_STYLES = ["modern", "minimal", "boxworld", "terminal", "blueprint"];

export const THEME_STYLE_LABELS = {
  modern: "Modern",
  minimal: "Minimal",
  boxworld: "Boxworld",
  terminal: "Terminal",
  blueprint: "Blueprint",
};

// Light or dark from the top-bar button: saved on the account, or for someone logged out in
// this cookie (when the rememberGuestMode setting allows). Only ever "light" or "dark".
export const MODE_COOKIE = "timeapp_mode";
export const PICKABLE_MODES = ["light", "dark"];

// The theme a page should use: { style, color, mode, background }. The user's own choice where
// they've made one (and it's still a known value), otherwise the app default. `user` may be null;
// `guestMode` is the MODE_COOKIE value, used only when logged out. With the showModeToggle
// setting off, everyone gets the default mode.
export function themeFor(user, settings, guestMode = null) {
  const pickedMode = !settings.showModeToggle ? null
    : user ? user.theme_mode
    : settings.rememberGuestMode ? guestMode
    : null;
  return {
    style: THEME_STYLES.includes(user?.theme_style) ? user.theme_style : settings.defaultStyle,
    color: THEME_COLORS.includes(user?.theme_color) ? user.theme_color : settings.defaultColor,
    mode: THEME_MODES.includes(pickedMode) ? pickedMode : settings.defaultTheme,
    background: THEME_BACKGROUNDS.includes(user?.theme_background) ? user.theme_background : settings.defaultBackground,
  };
}

// Validates the Settings → Appearance form. Returns { values: { style, color, background } } or
// { error }. Light/dark isn't on it: that's the top-bar button (POST /theme-mode).
export function readThemeForm(body) {
  const style = String(body.style ?? "");
  const color = String(body.color ?? "");
  const background = String(body.background ?? "");
  if (!THEME_STYLES.includes(style)) return { error: "Pick a style." };
  if (!THEME_COLORS.includes(color)) return { error: "Pick a color theme." };
  if (!THEME_BACKGROUNDS.includes(background)) return { error: "Pick a background." };
  return { values: { style, color, background } };
}

// ===================================================================
// ===== Cornershot =====
// ===================================================================

const CORNERSHOT_DEFAULTS = { text: "", size: 140, xSeconds: 15, ySeconds: 9, nearMissSeconds: 0.5, colorShift: true, opacity: 0.4 };

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// The Cornershot background's settings from config.js, as CSS custom properties for a
// <style> in the page head (the rules are in public/timeapp.css). Bad values are replaced
// with the defaults, with a warning in the server log.
export function cornershotStyle(config = {}, appName = "TimeApp") {
  const pick = (key, isValid) => {
    if (config[key] === undefined) return CORNERSHOT_DEFAULTS[key];
    if (isValid(config[key])) return config[key];
    console.warn(`cornershot_config.${key} (${JSON.stringify(config[key])}) isn't valid; using ${JSON.stringify(CORNERSHOT_DEFAULTS[key])}.`);
    return CORNERSHOT_DEFAULTS[key];
  };
  const isNumber = (min, max) => (n) => typeof n === "number" && n >= min && n <= max;
  const isWholeSeconds = (n) => Number.isInteger(n) && n >= 1 && n <= 600;

  const text = pick("text", (v) => typeof v === "string" && v.length <= 40) || appName;
  const size = pick("size", isNumber(20, 1000));
  const xSeconds = pick("xSeconds", isWholeSeconds);
  const ySeconds = pick("ySeconds", isWholeSeconds);
  const colorShift = pick("colorShift", (v) => typeof v === "boolean");
  const opacity = pick("opacity", isNumber(0, 1));
  let nearMiss = pick("nearMissSeconds", isNumber(0.05, 600));

  // Wall hits land on multiples of gcd(xSeconds, ySeconds). If the vertical bounce is delayed
  // by a multiple of that too, the two can line up and it would hit a corner exactly.
  const step = gcd(xSeconds, ySeconds);
  if (Math.abs(nearMiss / step - Math.round(nearMiss / step)) < 1e-9) {
    console.warn(`cornershot_config.nearMissSeconds (${nearMiss}) is a multiple of ${step}s, so it could hit a corner; using ${step / 2}.`);
    nearMiss = step / 2;
  }

  // Escaped for a double-quoted CSS string; "<" too, so it can't close the <style> element.
  const cssText = `"${text.replace(/[\\"]/g, "\\$&").replace(/</g, "\\3c ").replace(/[\r\n]+/g, " ")}"`;
  const start = Math.max(1, Math.round(xSeconds * 0.3)); // begin partway across, not in a corner
  return `:root{--cs-text:${cssText};--cs-w:${size}px;--cs-h:${size / 2}px;--cs-x:${xSeconds}s;--cs-y:${ySeconds}s;` +
    `--cs-start:${start}s;--cs-miss:${nearMiss}s;--cs-shift:${colorShift ? 1 : 0};--cs-opacity:${opacity}}`;
}
