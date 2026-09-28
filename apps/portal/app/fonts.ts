import { IBM_Plex_Mono, Montserrat, Open_Sans } from "next/font/google";

// The public site's fonts, downloaded at build time and served with the portal, so static hosting
// needs no request to Google. Each sets the CSS variable that globals.css and Tailwind read.
const heading = Montserrat({ subsets: ["latin"], variable: "--font-heading", display: "swap" });
const sans = Open_Sans({ subsets: ["latin"], variable: "--font-sans", style: ["normal", "italic"], display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500", "600"], display: "swap" });

export const fontVariables = `${heading.variable} ${sans.variable} ${mono.variable}`;
