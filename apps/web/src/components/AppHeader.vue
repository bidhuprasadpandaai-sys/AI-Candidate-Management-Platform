<script setup>
import { computed } from "vue";
import { useCandidateStore } from "../stores/candidates";

const store = useCandidateStore();

const activeModule = computed(() => {
  return (
    store.modules.find((module) => module.id === store.activeModule) ||
    store.modules[0]
  );
});
</script>

<template>
  <header class="hero-card">
    <h1>{{ activeModule?.name || "Overview" }}</h1>
  </header>
</template>
