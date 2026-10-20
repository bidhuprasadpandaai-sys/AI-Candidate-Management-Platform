import { defineStore } from "pinia";
import api from "../services/api";
import { PLATFORM, applyThemeVars, buildThemeVars } from "../config/brand";

const platformBranding = () => ({
  companyId: null,
  name: "",
  displayName: PLATFORM.name,
  tagline: PLATFORM.tagline,
  website: "",
  supportEmail: "",
  phone: "",
  address: "",
  primaryColor: PLATFORM.primaryColor,
  accentColor: PLATFORM.accentColor,
  logo: null
});

// The signed-in company's white-label branding (name, details, logo, colours), applied as CSS variables.
export const useBrandingStore = defineStore("branding", {
  state: () => ({ branding: platformBranding(), loaded: false }),
  getters: {
    // Companies without a display name of their own show the platform name
    title: (state) => state.branding.displayName || PLATFORM.name,
    platformName: () => PLATFORM.name
  },
  actions: {
    apply(branding) {
      this.branding = { ...platformBranding(), ...branding };
      applyThemeVars(buildThemeVars(this.branding.primaryColor, this.branding.accentColor));
      if (typeof document !== "undefined") document.title = this.title;
    },
    async load(companyId) {
      try {
        const { data } = await api.get("/branding", companyId ? { params: { companyId } } : {});
        this.apply(data.branding);
      } catch {
        this.apply(platformBranding());
      } finally {
        this.loaded = true;
      }
    },
    reset() {
      this.apply(platformBranding());
      this.loaded = false;
    }
  }
});
