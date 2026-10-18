/*
 * Shared by the root layout (a server component) and the theme preference:
 * kept out of the "use client" preferences module so the layout receives the
 * plain string, not a client reference.
 */

export const themeStorageKey = "wealth-theme";
/** The interface typeface (owner, 10 Oct 2026): Geist unless Poppins was chosen. */
export const fontStorageKey = "wealth-font";
/** Card surfaces (owner, 17 Oct 2026): glass unless "opaque" was chosen. */
export const surfacesStorageKey = "wealth-surfaces";
/** The app's ambient background (owner, 17 Oct 2026): animated unless "still" was chosen. */
export const appBackgroundStorageKey = "wealth-app-background";
/** The page zoom (owner, 18 Oct 2026): Chrome's steps, 100 unless chosen. */
export const zoomStorageKey = "wealth-zoom";
export const zoomLevels = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const;

/**
 * Runs in <head> before anything paints: the stored dark theme, typeface,
 * surfaces and app background, applied at once, so none flashes the default
 * first.
 */
export const themeScript = `try{if(localStorage.getItem(${JSON.stringify(themeStorageKey)})==="dark")document.documentElement.dataset.theme="dark";if(localStorage.getItem(${JSON.stringify(fontStorageKey)})==="poppins")document.documentElement.dataset.font="poppins";if(localStorage.getItem(${JSON.stringify(surfacesStorageKey)})==="opaque")document.documentElement.dataset.surfaces="opaque";if(localStorage.getItem(${JSON.stringify(appBackgroundStorageKey)})==="still")document.documentElement.dataset.ambient="still";var z=Number(localStorage.getItem(${JSON.stringify(zoomStorageKey)}));if(${JSON.stringify(zoomLevels)}.indexOf(z)>-1&&z!==100)document.documentElement.style.setProperty("--ui-zoom",String(z/100))}catch(e){}`;
