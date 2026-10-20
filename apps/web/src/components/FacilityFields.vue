<script setup>
import { computed } from "vue";
import InputText from "primevue/inputtext";

// The four details of a facility (work site): name, location, address and pin code.
// Location suggests the places this company's other facilities already use, so it can be searched or typed.
const props = defineProps({
  modelValue: { type: Object, required: true },
  suggestions: { type: Array, default: () => [] },
  idPrefix: { type: String, default: "facility" }
});

const listId = computed(() => `${props.idPrefix}-locations`);
const unique = computed(() => [...new Set(props.suggestions.filter(Boolean))].sort((a, b) => a.localeCompare(b)));
</script>

<template>
  <div class="facility-fields">
    <label class="ff-field ff-wide"><span>Facility name *</span>
      <InputText v-model="modelValue.name" maxlength="80" placeholder="e.g. Main Hospital" aria-label="Facility name" />
    </label>
    <label class="ff-field"><span>Location</span>
      <InputText v-model="modelValue.location" maxlength="80" :list="listId" placeholder="Search or type a city or area" aria-label="Facility location" autocomplete="off" />
      <datalist :id="listId"><option v-for="place in unique" :key="place" :value="place" /></datalist>
    </label>
    <label class="ff-field"><span>Pin code</span>
      <InputText v-model="modelValue.pinCode" maxlength="12" placeholder="e.g. 560001" aria-label="Facility pin code" />
    </label>
    <label class="ff-field ff-wide"><span>Address</span>
      <InputText v-model="modelValue.address" maxlength="200" placeholder="Street, building, landmark" aria-label="Facility address" />
    </label>
  </div>
</template>

<style scoped>
.facility-fields { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; width: 100%; }
.ff-field { display: grid; gap: 4px; min-width: 0; }
.ff-field > span { font-weight: 600; font-size: 0.78rem; color: var(--text-secondary); }
.ff-wide { grid-column: 1 / -1; }
.facility-fields :deep(.p-inputtext) { width: 100%; }
@media (max-width: 600px) { .facility-fields { grid-template-columns: 1fr; } }
</style>
