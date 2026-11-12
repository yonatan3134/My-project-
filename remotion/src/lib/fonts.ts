import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/**
 * Heebo (Hebrew + Latin, weights 100-900) from local files in public/fonts,
 * so renders never depend on a font server being reachable.
 * To use another typeface: drop its .woff2 into public/fonts and load it here.
 */
export const FONT_FAMILY = "Heebo";

await Promise.all([
  loadFont({
    family: FONT_FAMILY,
    url: staticFile("fonts/heebo-hebrew-wght-normal.woff2"),
    weight: "100 900",
    unicodeRange:
      "U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F",
  }),
  loadFont({
    family: FONT_FAMILY,
    url: staticFile("fonts/heebo-latin-wght-normal.woff2"),
    weight: "100 900",
    unicodeRange:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  }),
]);
