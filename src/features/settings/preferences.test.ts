import { afterEach, describe, expect, it } from "vitest";

import { appBackground, displayName, interfaceFont, lockBackground, lockBackgroundShuffle, lockBackgrounds, pageTransition, pageZoom, randomLockBackgrounds, sidebarCollapsed, surfaces, theme } from "./preferences";
import { themeScript } from "./theme-script";

const keys = ["wealth-lock-background", "wealth-display-name", "wealth-sidebar-collapsed", "wealth-theme", "wealth-font", "wealth-surfaces", "wealth-app-background", "wealth-zoom", "wealth-lock-shuffle", "wealth-page-transition"];

describe("device preferences", () => {
  afterEach(() => {
    keys.forEach((key) => window.localStorage.removeItem(key));
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.font;
    delete document.documentElement.dataset.surfaces;
    delete document.documentElement.dataset.ambient;
    document.documentElement.style.removeProperty("--ui-zoom");
  });

  it("keeps the page change a plain fade unless another is chosen, and ignores what it does not know", () => {
    expect(pageTransition.get()).toBe("fade");
    pageTransition.set("cinematic");
    expect(window.localStorage.getItem("wealth-page-transition")).toBe("cinematic");
    expect(pageTransition.get()).toBe("cinematic");
    window.localStorage.setItem("wealth-page-transition", "teleport");
    expect(pageTransition.get()).toBe("fade");
  });

  it("keeps the lock background shuffle apart from the choice, off unless chosen, drawing only real backgrounds", () => {
    expect(lockBackgroundShuffle.get()).toBe(false);
    lockBackground.set("sky");
    lockBackgroundShuffle.set(true);
    expect(window.localStorage.getItem("wealth-lock-shuffle")).toBe("on");
    // The choice underneath is kept for when the shuffle is turned off.
    expect(lockBackground.get()).toBe("sky");
    expect(lockBackgrounds).not.toContain("random");
    expect(randomLockBackgrounds).not.toContain("none");
  });

  it("keeps 100% zoom on a device that never chose, and applies Chrome's steps only, at once and before the first paint", () => {
    expect(pageZoom.get()).toBe(100);
    pageZoom.set(150);
    expect(document.documentElement.style.getPropertyValue("--ui-zoom")).toBe("1.5");
    expect(window.localStorage.getItem("wealth-zoom")).toBe("150");
    pageZoom.set(100);
    expect(document.documentElement.style.getPropertyValue("--ui-zoom")).toBe("");

    window.localStorage.setItem("wealth-zoom", "25");
    new Function(themeScript)();
    expect(document.documentElement.style.getPropertyValue("--ui-zoom")).toBe("0.25");
    document.documentElement.style.removeProperty("--ui-zoom");
    window.localStorage.setItem("wealth-zoom", "140");
    new Function(themeScript)();
    expect(document.documentElement.style.getPropertyValue("--ui-zoom")).toBe("");
    expect(pageZoom.get()).toBe(100);
  });

  it("keeps glass cards on a device that never chose, and applies opaque ones at once and before the first paint", () => {
    expect(surfaces.get()).toBe("glass");
    surfaces.set("opaque");
    expect(document.documentElement.dataset.surfaces).toBe("opaque");
    expect(window.localStorage.getItem("wealth-surfaces")).toBe("opaque");
    surfaces.set("glass");
    expect(document.documentElement.dataset.surfaces).toBeUndefined();

    window.localStorage.setItem("wealth-surfaces", "opaque");
    new Function(themeScript)();
    expect(document.documentElement.dataset.surfaces).toBe("opaque");
    delete document.documentElement.dataset.surfaces;
    window.localStorage.setItem("wealth-surfaces", "frosted");
    new Function(themeScript)();
    expect(document.documentElement.dataset.surfaces).toBeUndefined();
    expect(surfaces.get()).toBe("glass");
  });

  it("keeps the background moving on a device that never chose, and holds it still at once and before the first paint", () => {
    expect(appBackground.get()).toBe("animated");
    appBackground.set("still");
    expect(document.documentElement.dataset.ambient).toBe("still");
    expect(window.localStorage.getItem("wealth-app-background")).toBe("still");
    appBackground.set("animated");
    expect(document.documentElement.dataset.ambient).toBeUndefined();

    window.localStorage.setItem("wealth-app-background", "still");
    new Function(themeScript)();
    expect(document.documentElement.dataset.ambient).toBe("still");
    delete document.documentElement.dataset.ambient;
    window.localStorage.setItem("wealth-app-background", "paused");
    new Function(themeScript)();
    expect(document.documentElement.dataset.ambient).toBeUndefined();
    expect(appBackground.get()).toBe("animated");
  });

  it("keeps Geist on a device that never chose, and applies Poppins at once and before the first paint", () => {
    expect(interfaceFont.get()).toBe("geist");
    expect(document.documentElement.dataset.font).toBeUndefined();

    interfaceFont.set("poppins");
    expect(document.documentElement.dataset.font).toBe("poppins");
    expect(window.localStorage.getItem("wealth-font")).toBe("poppins");
    interfaceFont.set("geist");
    expect(document.documentElement.dataset.font).toBeUndefined();

    // Stored, it is on <html> before anything paints; anything else is Geist.
    window.localStorage.setItem("wealth-font", "poppins");
    new Function(themeScript)();
    expect(document.documentElement.dataset.font).toBe("poppins");
    delete document.documentElement.dataset.font;
    window.localStorage.setItem("wealth-font", "inter");
    new Function(themeScript)();
    expect(document.documentElement.dataset.font).toBeUndefined();
    expect(interfaceFont.get()).toBe("geist");
  });

  it("keeps the light theme on a device that never chose, and applies a chosen theme at once", () => {
    expect(theme.get()).toBe("light");
    theme.set("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("wealth-theme")).toBe("dark");
    theme.set("light");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("applies a stored dark theme before the first paint, and nothing else", () => {
    window.localStorage.setItem("wealth-theme", "dark");
    new Function(themeScript)();
    expect(document.documentElement.dataset.theme).toBe("dark");

    delete document.documentElement.dataset.theme;
    window.localStorage.setItem("wealth-theme", "sepia");
    new Function(themeScript)();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("reads explicit defaults on a device that never chose: today's behaviour", () => {
    // The aurora since 10 Oct 2026 (the Trading OS lock layout).
    expect(lockBackground.get()).toBe("aurora");
    // No built-in name: a device that never chose is greeted without one.
    expect(displayName.get()).toBe("");
    expect(sidebarCollapsed.get()).toBe(false);
  });

  it("reads unexpected stored values as the default", () => {
    window.localStorage.setItem("wealth-lock-background", "aurora");
    window.localStorage.setItem("wealth-sidebar-collapsed", "yes");
    expect(lockBackground.get()).toBe("aurora");
    expect(sidebarCollapsed.get()).toBe(false);
  });

  it("keeps the sidebar's existing stored values, so no device needs a migration", () => {
    window.localStorage.setItem("wealth-sidebar-collapsed", "1");
    expect(sidebarCollapsed.get()).toBe(true);
    sidebarCollapsed.set(false);
    expect(window.localStorage.getItem("wealth-sidebar-collapsed")).toBe("0");
  });

  it("stores each choice under its one key", () => {
    lockBackground.set("still-sky");
    expect(window.localStorage.getItem("wealth-lock-background")).toBe("still-sky");
    expect(lockBackground.get()).toBe("still-sky");
  });

  it("trims and bounds the name, and tells an empty name from no choice", () => {
    displayName.set("  Ada  ");
    expect(displayName.get()).toBe("Ada");
    displayName.set("x".repeat(80));
    expect(displayName.get()).toHaveLength(40);
    // Chosen empty: a greeting without a name, not the default name.
    displayName.set("   ");
    expect(window.localStorage.getItem("wealth-display-name")).toBe("");
    expect(displayName.get()).toBe("");
  });
});
