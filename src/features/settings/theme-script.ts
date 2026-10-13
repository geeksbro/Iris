/*
 * Shared by the root layout (a server component) and the theme preference:
 * kept out of the "use client" preferences module so the layout receives the
 * plain string, not a client reference.
 */

export const themeStorageKey = "wealth-theme";
/** The interface typeface (owner, 10 Oct 2026): Geist unless Poppins was chosen. */
export const fontStorageKey = "wealth-font";

/**
 * Runs in <head> before anything paints: the stored dark theme and the stored
 * typeface, applied at once, so neither flashes the default first.
 */
export const themeScript = `try{if(localStorage.getItem(${JSON.stringify(themeStorageKey)})==="dark")document.documentElement.dataset.theme="dark";if(localStorage.getItem(${JSON.stringify(fontStorageKey)})==="poppins")document.documentElement.dataset.font="poppins"}catch(e){}`;
