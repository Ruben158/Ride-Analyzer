/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#1C2535',
    tint: '#F57F4D',
    background: '#F6F1EA',
    foreground: '#1C2535',
    card: '#FBF8F3',
    cardForeground: '#1C2535',
    primary: '#F57F4D',
    primaryForeground: '#1C2535',
    secondary: '#CCD89D',
    secondaryForeground: '#1C2535',
    muted: '#E7E2D9',
    mutedForeground: '#687182',
    accent: '#CCD89D',
    accentForeground: '#1C2535',
    destructive: '#D93F3A',
    destructiveForeground: '#FFFFFF',
    border: '#DAD3C8',
    input: '#DAD3C8',
  },
  dark: {
    text: '#F6F1EA',
    tint: '#F57F4D',
    background: '#171D2A',
    foreground: '#F6F1EA',
    card: '#202734',
    cardForeground: '#F6F1EA',
    primary: '#F57F4D',
    primaryForeground: '#171D2A',
    secondary: '#AFC15B',
    secondaryForeground: '#171D2A',
    muted: '#30394A',
    mutedForeground: '#ADA89F',
    accent: '#AFC15B',
    accentForeground: '#171D2A',
    destructive: '#E4514B',
    destructiveForeground: '#FFFFFF',
    border: '#394252',
    input: '#394252',
  },
  radius: 16,
};

export default colors;
