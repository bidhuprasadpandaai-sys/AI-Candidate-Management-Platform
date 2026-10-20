<script setup>
import { computed } from "vue";
import { useCandidateStore } from "../stores/candidates";
import { useBrandingStore } from "../stores/branding";
import { initialsOf } from "../config/brand";

const store = useCandidateStore();
const brand = useBrandingStore();

const activeModule = computed(() => {
  return (
    store.modules.find((module) => module.id === store.activeModule) ||
    store.modules[0]
  );
});

// Shown only for a company's users; the platform default has no company.
const hasCompany = computed(() => Boolean(brand.branding.companyId));
</script>

<template>
  <header class="hero-card">
    <div>
      <h1>{{ activeModule?.name || "Overview" }}</h1>
      <p v-if="activeModule?.description" class="page-sub">{{ activeModule.description }}</p>
    </div>
    <span v-if="hasCompany" class="company-chip" data-testid="company-chip">
      <img v-if="brand.branding.logo" :src="brand.branding.logo" :alt="`${brand.title} logo`" />
      <span v-else class="chip-mark">{{ initialsOf(brand.title) }}</span>
      {{ brand.title }}
    </span>
  </header>
</template>
