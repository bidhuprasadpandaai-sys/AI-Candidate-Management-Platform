# UI Styling Guide

How the app looks and how to keep it consistent. Read this before changing any screen. The values live in two places only: `apps/web/src/config/brand.js` (platform defaults and the colour builder) and `apps/web/src/styles.css` (tokens and shared classes). Do not copy them into components.

## 1. Principles

- **Clean and calm.** White cards on a light grey page, one dark sidebar, one brand colour. No decoration that does not help.
- **White label first.** Every brand colour comes from the signed-in company's branding, so never hardcode `#3b82f6` or any other colour for brand use.
- **Plain words.** Labels and messages are short and say what will happen.
- **Accessible.** Text meets contrast on its background, every control has a visible focus ring, icons never carry meaning alone.

## 2. Company branding (the one central place)

Each company has its own branding, edited by a platform admin in **Admin → Companies → Branding** and stored on the company record:

| Field | Used for |
|-------|----------|
| Display name | Sidebar title, page header chip, browser tab title |
| Tagline | Shown in the branding preview and available to pages |
| Logo (PNG, JPEG or WebP, ≤ 256 KB) | Sidebar mark, header chip |
| Primary colour | Buttons, links, active states, focus ring, metric accents |
| Accent colour | Active nav marker, gradient end, highlights |
| Website, support email, phone, address | Company details for pages and emails to read from `GET /branding` |

- API: `GET /api/branding` returns the signed-in user's company branding (admins may pass `?companyId=`); users without a company get the platform default. `PATCH /api/companies/:id` with `{ branding: {...} }` saves details and colours; `PUT` and `DELETE /api/companies/:id/logo` manage the logo (bytes decide the type; SVG is refused).
- Web: `stores/branding.js` loads it after sign-in and applies the colours as CSS variables; `config/brand.js` holds the platform defaults (name TalentOS, indigo `#4f46e5`, sky `#0ea5e9`) used on sign-in pages and for companies that set nothing.
- To add a new company-specific value, add it to the company's `branding` object (model, `services/branding.js` validation, the Branding dialog) rather than to a component.

## 3. Colour

Set at runtime from the two brand colours (`buildThemeVars`). Use the variables, never the hex values.

| Variable | Meaning |
|----------|---------|
| `--primary-color`, `--primary-500` | Brand colour |
| `--primary-50` … `--primary-900` | Tints (50 to 400) and shades (600 to 900) of the brand colour |
| `--primary-color-text` | Text on the brand colour (white or dark, chosen for contrast) |
| `--accent-color`, `--accent-soft` | Accent and its light tint |
| `--brand-gradient` | Primary to accent, for marks and thin accents only |

Fixed neutrals and status colours (not branded): `--surface-page`, `--surface-card`, `--surface-muted`, `--border-color`, `--border-strong`, `--text-primary`, `--text-secondary`, `--text-muted`, `--success`, `--warning`, `--danger`, `--info`. Use status colours only for status (never for decoration) and pair them with text or an icon.

Use `color-mix(in srgb, var(--primary-color) 20%, transparent)` for translucent brand colours, not `rgba()`.

## 4. Typography

- Font: Inter, then the system sans-serif stack (no external font downloads).
- Base text 15 px / 1.5. Page title 1.5 rem bold; panel title 1.1 rem bold; table headers 0.76 rem uppercase; helper text 0.82 to 0.85 rem in `--text-muted`.
- One bold weight (700) for titles, 600 for labels and buttons, 400 to 500 for body.

## 5. Spacing, shape and depth

- Spacing scale: `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 24, `--space-6` 32 px. Use these, not arbitrary values.
- Radius: controls `--radius-sm` (8), cards and dialogs `--radius-md` / `--radius-lg` (12 / 16). Pills are fully round.
- Depth: cards use `--shadow-card`; hover and floating panels use `--shadow-lift`. Do not stack shadows.
- Focus: `:focus-visible` outline plus `--ring` on inputs and buttons. Never remove it.

## 6. Layout

- App shell: 272 px dark sidebar (brand, navigation with icons, profile menu) and a content column with 24 to 32 px padding. Below 1150 px the sidebar stacks on top.
- Every module starts with the page header card (`hero-card`: title, one-line description, company chip), then messages, then content in `panel-card` blocks separated by `--space-5`.
- Grids: `.metrics-grid` for stat cards, `.filter-row` for filters above tables.

## 7. Components

Use PrimeVue 3 components and the shared classes; style variations go in `styles.css`, not per screen.

| Element | Rule |
|---------|------|
| Primary button | One per view area (the main action). Filled brand colour. |
| Secondary | Outlined or text button. Destructive actions use `severity="danger"` and ask for confirmation. |
| Inputs | PrimeVue `InputText`, `Dropdown`, `MultiSelect`, `InputNumber`; every input has a visible label or `aria-label`. |
| Tables | `DataTable` with an empty message; uppercase muted headers; row hover tint. |
| Dialogs | Modal, title says what and for whom ("Branding: Acme"), Cancel on the left, the save action on the right. Errors show once, inside the dialog. |
| Status | `Tag` or chip with text (Open, Full, Expired); colour only reinforces. |
| Messages | PrimeVue `Message` for page-level information; success, info, warn, error map to the status colours. |
| Icons | PrimeIcons (`pi pi-…`); decorative icons get `aria-hidden="true"`. |

PrimeVue 3 themes hardcode their blue, so the brand colour is applied to PrimeVue controls in the "PrimeVue 3 themes hardcode their blue" block of `styles.css`. If a new PrimeVue component shows the wrong blue, add it there.

### Forms and dialogs

Long forms are grouped into cards (icon, title, one line of help) inside one dialog; labels sit above fields in small bold text, related numbers are shown as "minimum to maximum" pairs, and a short live summary chip can sit in the card header. Never open a dialog on top of a dialog: expand an inline panel instead (stacked PrimeVue overlays hide each other's dropdown lists).

### Overlays (drawers)

A drawer shows one topic at a time: header (who it is, one key number), a tab bar with counts, then white cards. Do not stack more than about five topics in one scroll; add a tab instead. Use a red tab badge only for things needing attention (for example an expired document). Confirmation questions go in a small modal dialog, not inside the drawer.

## 8. Do and don't

- Do take every colour from a variable; do test a screen with a very light and a very dark brand colour.
- Do keep copy short and consistent with `docs/FunctionalSpecification.md`.
- Don't add a second font, a second accent colour, or a new shadow style.
- Don't put company-specific text, colours or images in a component; read them from the branding store.
- Don't use colour alone to show state.

## 9. Checklist for a new screen

1. Page header card and `panel-card` blocks, spacing from the scale.
2. Colours from variables only; no hex values.
3. Labels on every input; focus ring visible; keyboard reachable.
4. Looks right at 1280, 768 and 375 px widths.
5. Try it with another company's branding.

## Change log

| Date | Change |
|------|--------|
| 2026-10-15 | First version with the redesigned shell, tokens and company branding |
