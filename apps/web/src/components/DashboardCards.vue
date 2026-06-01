<script setup>
import { computed } from "vue";
import { useCandidateStore } from "../stores/candidates";

const store = useCandidateStore();

const metrics = computed(() => [
  { label: "Total candidates", value: store.dashboard.totalCandidates },
  { label: "Shortlisted", value: store.dashboard.shortlisted },
  { label: "Hired", value: store.dashboard.hired },
  { label: "Average score", value: `${store.dashboard.averageScore}%` }
]);
</script>

<template>
  <section class="metrics-grid">
    <article v-for="metric in metrics" :key="metric.label" class="metric-card">
      <span class="label">{{ metric.label }}</span>
      <span class="value">{{ metric.value }}</span>
    </article>
  </section>
</template>
