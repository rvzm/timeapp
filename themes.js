// Themes: a color theme plus light or dark mode. Every color has a light and a dark
// version (the palettes are in section 2 of public/timeapp.css). Each person picks theirs
// in Settings (the menu under their name); anyone who hasn't gets the default from Admin → Settings.
// To add a color: add its light and dark palette blocks to the CSS and its name here.
// A background style sits behind the page (the "Backgrounds" block in the CSS, keyed by
// data-bg on <html>); it's tinted from the theme's accent color, so it works with every color.
// All of them draw on one fixed layer, body::before (body::after belongs to the Terminal style).
// A style changes shape and feel: fonts, corners, borders, shadows (data-style on <html>;
// section 9 of the CSS overrides the style tokens from section 1). It never sets colors.

export const THEME_COLORS = ["standard", "ocean", "forest", "sunset", "grape", "fire"];

export const THEME_COLOR_LABELS = {
  standard: "Standard",
  ocean: "Ocean",
  forest: "Forest",
  sunset: "Sunset",
  grape: "Grape",
  fire: "Fire",
};

export const THEME_MODES = ["system", "light", "dark"];

export const THEME_MODE_LABELS = {
  system: "Match my device",
  light: "Light",
  dark: "Dark",
};

export const THEME_BACKGROUNDS = ["none", "glow", "aurora", "dots", "grain", "waves", "starfield", "cityscape"];

export const THEME_BACKGROUND_LABELS = {
  none: "None",
  glow: "Glow",
  aurora: "Aurora",
  dots: "Dots",
  grain: "Grain",
  waves: "Waves",
  starfield: "Starfield",
  cityscape: "Cityscape",
};

export const THEME_STYLES = ["modern", "minimal", "terminal", "blueprint"];

export const THEME_STYLE_LABELS = {
  modern: "Modern",
  minimal: "Minimal",
  terminal: "Terminal",
  blueprint: "Blueprint",
};

// The theme a page should use: { style, color, mode, background }. The user's own choice where
// they've made one (and it's still a known value), otherwise the app default. `user` may be null.
export function themeFor(user, settings) {
  return {
    style: THEME_STYLES.includes(user?.theme_style) ? user.theme_style : settings.defaultStyle,
    color: THEME_COLORS.includes(user?.theme_color) ? user.theme_color : settings.defaultColor,
    mode: THEME_MODES.includes(user?.theme_mode) ? user.theme_mode : settings.defaultTheme,
    background: THEME_BACKGROUNDS.includes(user?.theme_background) ? user.theme_background : settings.defaultBackground,
  };
}

// Validates the Settings → Appearance form. Returns { values: { style, color, mode, background } } or { error }.
export function readThemeForm(body) {
  const style = String(body.style ?? "");
  const color = String(body.color ?? "");
  const mode = String(body.mode ?? "");
  const background = String(body.background ?? "");
  if (!THEME_STYLES.includes(style)) return { error: "Pick a style." };
  if (!THEME_COLORS.includes(color)) return { error: "Pick a color theme." };
  if (!THEME_MODES.includes(mode)) return { error: "Pick light, dark, or match my device." };
  if (!THEME_BACKGROUNDS.includes(background)) return { error: "Pick a background." };
  return { values: { style, color, mode, background } };
}
