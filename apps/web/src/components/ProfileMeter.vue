<script setup>
import { computed } from "vue";
import { PROFILE_LEVEL_LABELS, profileCompleteness } from "@acmp/shared";

// Profile completion for a candidate: a bar and a percentage, with what is missing in the tooltip.
const props = defineProps({
  candidate: { type: Object, required: true },
  // compact: for cards and table rows
  compact: { type: Boolean, default: false }
});

const result = computed(() => profileCompleteness(props.candidate));
const tooltip = computed(() =>
  result.value.missing.length ? `Missing: ${result.value.missing.map((item) => item.label.toLowerCase()).join(", ")}` : "Profile complete"
);
</script>

<template>
  <div class="profile-meter" :class="[`level-${result.level}`, { compact }]" :title="tooltip" data-test="profile-meter">
    <span class="profile-meter__label">Profile</span>
    <span
      class="profile-meter__bar"
      role="progressbar"
      aria-label="Profile completion"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="result.score"
    >
      <span class="profile-meter__fill" :style="{ width: `${result.score}%` }"></span>
    </span>
    <strong class="profile-meter__value" data-test="profile-score">{{ result.score }}%</strong>
    <span v-if="!compact" class="profile-meter__level">{{ PROFILE_LEVEL_LABELS[result.level] }}</span>
  </div>
</template>

<style scoped>
.profile-meter { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: #475569; }
.profile-meter__label { font-weight: 600; }
.profile-meter__bar { flex: 1; min-width: 3rem; height: 6px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
.profile-meter__fill { display: block; height: 100%; border-radius: 999px; background: #ef4444; transition: width 0.2s ease; }
.level-started .profile-meter__fill { background: #ef4444; }
.level-partial .profile-meter__fill { background: #f59e0b; }
.level-good .profile-meter__fill { background: var(--primary-500); }
.level-complete .profile-meter__fill { background: #10b981; }
.profile-meter__value { min-width: 2.4rem; text-align: right; color: #0f172a; }
.profile-meter__level { color: #64748b; }
.compact .profile-meter__label { display: none; }
</style>
