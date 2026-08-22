---
name: Доска
description: Local board chrome as solid FigJam islands; packet bone on charcoal, independent of paper fill.
colors:
  packet-bg: "#242422"
  packet-panel: "#2e2e2b"
  packet-panel-2: "#383834"
  packet-border: "#454540"
  packet-border-soft: "#3a3a36"
  packet-text: "#eceae4"
  packet-text-dim: "#a8a59c"
  steel-accent: "#d4cfc4"
  steel-accent-strong: "#f0ebe3"
  steel-active-bg: "rgba(236, 234, 228, 0.12)"
  steel-active-ring: "rgba(240, 235, 227, 0.42)"
  success: "#6fae7a"
  warn: "#c9a84a"
  danger: "#c96a62"
  danger-bg: "#4a2826"
  danger-border: "#7a4038"
  archive-bg: "#2a2622"
  archive-accent: "#b8956a"
  studio-bg: "#d8d4cc"
  studio-panel: "#f4f1ea"
  studio-text: "#1c1c1a"
  studio-accent: "#5c5a54"
  ink-bg: "#0e0e0e"
  ink-accent: "#c8c8c4"
  paper-dark: "#1c1c1a"
  paper-black: "#121110"
  paper-graphite: "#2c2a26"
  paper-light: "#f4f4f5"
  paper-cream: "#fffdf5"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "normal"
rounded:
  control: "8px"
  card: "10px"
  island: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  sheet: "20px"
components:
  island:
    backgroundColor: "{colors.packet-panel}"
    textColor: "{colors.packet-text}"
    rounded: "{rounded.island}"
    padding: "6px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.packet-text-dim}"
    rounded: "{rounded.control}"
    padding: "0"
    width: "32px"
    height: "32px"
  button-icon-hover:
    backgroundColor: "{colors.packet-panel-2}"
    textColor: "{colors.packet-text}"
    rounded: "{rounded.control}"
    width: "32px"
    height: "32px"
  button-tool:
    backgroundColor: "transparent"
    textColor: "{colors.packet-text-dim}"
    rounded: "{rounded.pill}"
    padding: "0"
    width: "34px"
    height: "34px"
  button-tool-active:
    backgroundColor: "{colors.steel-active-bg}"
    textColor: "{colors.steel-accent-strong}"
    rounded: "{rounded.pill}"
    width: "34px"
    height: "34px"
  button-style:
    backgroundColor: "transparent"
    textColor: "{colors.packet-text-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "28px"
  button-style-active:
    backgroundColor: "{colors.steel-active-bg}"
    textColor: "{colors.steel-accent-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "28px"
  badge-status:
    backgroundColor: "{colors.packet-panel-2}"
    textColor: "{colors.packet-text-dim}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  sheet:
    backgroundColor: "{colors.packet-panel}"
    textColor: "{colors.packet-text}"
    rounded: "{rounded.island}"
    padding: "20px 20px 32px"
    width: "360px"
  input-select:
    backgroundColor: "{colors.packet-panel-2}"
    textColor: "{colors.packet-text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "28px"
  menu-item:
    backgroundColor: "transparent"
    textColor: "{colors.packet-text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
---

# Design System: Доска

## Overview

**Creative North Star: "Packet Islands"**

Доска is an editor, not a site. The canvas is the product; chrome is a set of solid floating islands in the FigJam / Figma UI3 grammar: file island top-left, status and settings top-right, grouped toolbelt bottom-center, style island above the belt when a tool or selection needs it. Islands are opaque panel fills with a 1px border and a single ambient drop shadow. They never span the viewport as a window frame, top bar, left tool rail, or status strip.

The default skin is Packet: warm charcoal panels, paper-warm type, one bone (hue-less parchment) accent taken from the skin. Three other chrome skins (Archive brass, Studio umber, Ink) swap the same token roles. Board paper is a separate choice. Copy ships in Russian, English, and Chinese; the product name stays Доска. There is no marketing surface, no logo lockup, and no violet or steel-blue SaaS accent.

**Key Characteristics:**
- Full-bleed board; chrome floats as discrete islands
- Solid panels, 12px outer radius, 1px hairline border
- One accent per chrome skin; Packet bone is the default
- Chrome theme and board paper never share a control
- Inter at editor density (11–16px), not display type

## Colors

Chrome is a charcoal-to-paper set of skins. Packet is the default (`:root` and `data-chrome-theme="packet"`). Each skin remaps the same roles; the accent always comes from that skin.

### Primary
- **Packet Bone**: Tool active fill, focus outline, slider accent, swatch ring, locale/style selected text. Parchment on charcoal — a state, not a blue brand tint.
- **Packet Bone Strong**: Active tool glyph and selected style label; near-paper so glyphs read on the translucent active wash.

### Neutral
- **Packet Bg**: Page and canvas-wrap fallback behind the board; also the theme-color meta for Packet.
- **Packet Panel**: Island, sheet, context menu, and info card fill.
- **Packet Panel 2**: Hover wash, zoom chip hover, select field fill, badge fill.
- **Packet Border**: Island and sheet hairline.
- **Packet Border Soft**: In-island separators and select borders.
- **Packet Text**: Chrome copy and icons at rest after hover.
- **Packet Text Dim**: Icons at rest, hints, badges, secondary labels.

### Semantic
- **Success**: Online sync badge and saved-dot; crop-apply glyph.
- **Warn**: Unsaved / loading badge dot.
- **Danger**: Destructive menu rows; error island uses the danger fill and border pair.

### Chrome skins (same roles, different values)
- **Archive**: Warm brown panels; brass accent. Theme-color `{colors.archive-bg}`.
- **Studio**: Light paper chrome; umber accent; darker, softer shadow. Theme-color `{colors.studio-bg}`.
- **Ink**: Near-black panels; pale metal accent and white strong. Theme-color `{colors.ink-bg}`.

### Board paper (not chrome)
Paper fills the canvas through board settings, independent of `data-chrome-theme`: warm charcoal, near-black, stone, light, cream. Dark papers are olive-black, never navy.

**The Independent Skin Rule.** Chrome theme and board paper are two controls. Never fold them into one “skin,” and never tint island chrome from the paper fill.

**The One Accent From the Skin Rule.** Each chrome skin has one accent family. Do not add a second brand hue (including violet) to chrome.

## Typography

**Display Font:** none (this product has no display face)
**Body Font:** Inter (with ui-sans-serif, system-ui, sans-serif)
**Label/Mono Font:** Inter; tabular numerals on zoom, counts, and shortcuts

**Character:** One family at UI density. Weight does the hierarchy; size stays inside 11–16px so islands remain compact over the board.

### Hierarchy
- **Headline** (650, 16px, −0.02em): Settings sheet title only.
- **Title** (600, 14px, −0.01em): Product name in the file island; section headings at 13px / 600.
- **Body** (400, 13px, 1.4): App chrome default; sheet hints and checks.
- **Label** (500–600, 12px; 11px for badges, panel labels, hints): Style chips, menus, zoom, locale codes. No all-caps except the three locale codes (RU / EN / ZH).

### Named Rules
**The Editor Density Rule.** Chrome type stays in the 11–16px band. Do not introduce a marketing display size or a second family for UI.

## Layout

The spatial model is a full-bleed canvas with four chrome slots, not a page grid.

- **File island:** 12px from the top-left. Brand, undo/redo, zoom, fit.
- **Meta island:** 12px from the top-right. Sync, save, settings. Error chip can sit inside this island.
- **Toolbelt:** Bottom-center, 16px from the bottom. Navigation group, create group, then actions, separated by 1px soft dividers. Inner padding 6px; tool buttons 34px pills with 2px gaps.
- **Style island:** Centered above the belt (bottom 76px desktop). Appears only when the live tool or the selection needs style.
- **Settings sheet:** Inset from the top-right (12px), width `min(360px, 100% − 24px)`, not a full-screen takeover. Backdrop dim `rgba(8, 8, 8, 0.42)`. While open, file bar, toolbelt, and style island drop to 0.35 opacity and ignore pointer events.
- **Rhythm:** 4px base. Recurring steps: 4, 6, 8, 12, 16, 20, 28.
- **≤720px:** Hide brand subtitle and save badge. Toolbelt and style island stretch to 12px side insets and scroll horizontally.

**The Island Slot Rule.** New chrome occupies an existing island or a new floating island. Do not add a full-width top bar, left tool rail, or bottom status bar.

## Elevation & Depth

Depth is a single ambient island shadow plus a 1px border. Active tools use an inset ring, not a second drop shadow. No glass, no backdrop-filter, no stacked offset shadows.

### Shadow Vocabulary
- **Island** (`box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32)`): File, meta, toolbelt, style, sheet, context menu, info. Packet, Archive, Ink.
- **Island on Studio** (`box-shadow: 0 8px 28px rgba(28, 28, 26, 0.14)`): Same silhouette, lower opacity on light chrome.
- **Active tool ring** (`box-shadow: inset 0 0 0 1.5px` using the skin’s active-ring token): Selected tool only.
- **Theme selected** (`box-shadow: inset 0 0 0 2px` using accent-strong): Selected chrome-skin card.

### Named Rules
**The One Shadow Rule.** Floating chrome uses the island shadow. Hover does not lift. Active state is a wash plus an inset ring.

## Shapes

Outer chrome is a 12px rounded rectangle (island, sheet, menu, info). Inner hits are tighter: 8px on icon buttons, style chips, menu rows, selects, error chips; 10px on theme and paper preview cards; 999px pills on tool buttons and status badges. Swatches are 18px circles. Separators are 1px × stretch, 6px vertical inset.

Focus-visible is a 2px accent outline with 1px offset on buttons, selects, theme cards, and menu rows.

## Components

### Buttons
- **Icon (file/meta):** 32×32, 8px corners, transparent, dim glyph. Hover: panel-2 wash and full text color. Disabled: 0.35 opacity.
- **Tool (belt):** 34×34 pill. Active: accent wash, strong accent glyph, inset ring. Same hover as icon when idle.
- **Style chip:** 28px tall, 8px corners, 12px type, 10px horizontal padding. Active: accent wash and strong accent text (no inset ring).
- **Focus:** 2px accent outline, 1px offset, 140ms ease on background and color.
- **Motion:** `cubic-bezier(0.22, 1, 0.36, 1)`. Island enter 180ms; sheet 220ms from 16px; backdrop 160ms. Honor `prefers-reduced-motion`.

### Chips
- **Status badges:** Pill, panel-2 fill, 11px dim type, 6px status dot. Online/saved dots use success; loading uses warn.
- **Locale chips:** Reuse style chips (RU / EN / ZH).

### Cards / Containers
- **Island:** Panel fill, 1px border, 12px radius, island shadow, 6px padding, 4px item gap, min-height 44px on file/meta.
- **Settings sheet:** Same material as islands; 20px padding (32px bottom); 2-column 8px grids for theme and paper cards (64px and 48px tall, 10px radius).
- **Context menu / info:** Island material; menu items 8px / 12px type with 8px radius hover wash. Danger items use the danger color, not a filled button.

### Inputs / Fields
- **Size select:** Panel-2 fill, soft border, 8px radius, 28px tall, 12px type.
- **Range:** Native slider with `accent-color` set to the skin accent.
- **Checkboxes:** Same accent.
- **Text overlay (on-board):** Transparent field, Inter, line-height 1.3, caret in the skin accent. Not a chrome island.

### Navigation
Toolbelt is the primary nav. Groups: select / lasso / pan, then drawing tools, then edit actions. Stroke icons at 18px, 2px stroke, currentColor. Settings lives in the meta island, not in the belt.

### Signature: Style island
A second island that appears only when needed, 8–10px padding, 8px gaps, enter animation 6px up. Holds swatches, style chips, and size controls for the live tool or the selection. Do not pin a permanent inspector rail.

## Do's and Don'ts

### Do:
- **Do** keep chrome as solid 12px islands with the island shadow and a 1px border.
- **Do** take the accent from the active chrome skin (Packet bone by default). Do not reintroduce steel-blue `#8aa4b8` on chrome or navy `#161922` / `#2b3040` on board paper.
- **Do** keep board paper and chrome theme as separate settings.
- **Do** set copy and `lang` from `ru` / `en` / `zh`; keep the visible name Доска.
- **Do** put new controls in the file island, meta island, toolbelt, style island, or settings sheet.

### Don't:
- **Don't** wrap the app in a 2015 window frame, full-width top bar, left tool rail, or status bar.
- **Don't** introduce a violet or second-hue SaaS accent on chrome.
- **Don't** frost islands (no backdrop-filter, no glass).
- **Don't** treat the GitHub name ReView as on-screen identity.
- **Don't** build a marketing landing inside this system; chrome exists only to serve the board.
