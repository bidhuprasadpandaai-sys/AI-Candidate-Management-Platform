<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  candidates: {
    type: Array,
    default: () => []
  },
  open: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["close", "create"]);

const search = ref("");
const type = ref("individual");
const selectedIds = ref([]);
const groupTitle = ref("");

const filteredCandidates = computed(() => {
  const term = search.value.trim().toLowerCase();
  return props.candidates.filter((candidate) => {
    if (!term) {
      return true;
    }

    return [candidate.name, candidate.role, candidate.email]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(term);
  });
});

const computedTitle = computed(() => {
  if (type.value !== "group") {
    const candidate = props.candidates.find((item) => item.id === selectedIds.value[0]);
    return candidate?.name || "";
  }

  if (groupTitle.value.trim()) {
    return groupTitle.value.trim();
  }

  const selectedNames = props.candidates
    .filter((candidate) => selectedIds.value.includes(candidate.id))
    .map((candidate) => candidate.name.split(/\s+/)[0]);

  return selectedNames.length > 0 ? `${selectedNames.join(", ")} group` : "";
});

function resetForm() {
  search.value = "";
  type.value = "individual";
  selectedIds.value = [];
  groupTitle.value = "";
}

function toggleCandidate(candidateId) {
  if (type.value === "individual") {
    selectedIds.value = [candidateId];
    return;
  }

  if (selectedIds.value.includes(candidateId)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== candidateId);
    return;
  }

  selectedIds.value = [...selectedIds.value, candidateId];
}

function handleCreate() {
  if (selectedIds.value.length === 0) {
    return;
  }

  emit("create", {
    candidateIds: selectedIds.value,
    type: type.value,
    title: computedTitle.value
  });
  resetForm();
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      resetForm();
    }
  }
);

watch(type, (nextType) => {
  if (nextType === "individual" && selectedIds.value.length > 1) {
    selectedIds.value = selectedIds.value.slice(0, 1);
  }
});
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card">
      <div class="modal-card__header">
        <div>
          <p class="modal-card__eyebrow">Start chat</p>
          <h3>New conversation</h3>
        </div>
        <button type="button" class="modal-card__close" @click="emit('close')">
          Close
        </button>
      </div>

      <div class="modal-card__toggle">
        <button
          type="button"
          :class="{ active: type === 'individual' }"
          @click="type = 'individual'"
        >
          Individual
        </button>
        <button
          type="button"
          :class="{ active: type === 'group' }"
          @click="type = 'group'"
        >
          Group
        </button>
      </div>

      <label class="modal-card__field">
        <span>Search candidates</span>
        <input v-model="search" type="search" placeholder="Search by name, role, or email" />
      </label>

      <label v-if="type === 'group'" class="modal-card__field">
        <span>Group title</span>
        <input
          v-model="groupTitle"
          type="text"
          :placeholder="computedTitle || 'Frontend shortlist sync'"
        />
      </label>

      <div class="candidate-picker">
        <label
          v-for="candidate in filteredCandidates"
          :key="candidate.id"
          class="candidate-picker__row"
        >
          <input
            :checked="selectedIds.includes(candidate.id)"
            type="checkbox"
            @change="toggleCandidate(candidate.id)"
          />
          <div>
            <strong>{{ candidate.name }}</strong>
            <p>{{ candidate.role }} · {{ candidate.email }}</p>
          </div>
        </label>
      </div>

      <div class="modal-card__footer">
        <p>{{ selectedIds.length }} candidate{{ selectedIds.length === 1 ? "" : "s" }} selected</p>
        <button
          type="button"
          class="modal-card__create"
          :disabled="selectedIds.length === 0 || !computedTitle"
          @click="handleCreate"
        >
          Create chat
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: rgba(15, 23, 42, 0.45);
  z-index: 30;
}

.modal-card {
  width: min(42rem, 100%);
  max-height: min(42rem, 100vh - 3rem);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow: hidden;
  background: #fff;
  border-radius: 1.5rem;
  padding: 1.4rem;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
}

.modal-card__header,
.modal-card__footer,
.modal-card__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.modal-card__eyebrow {
  margin: 0 0 0.2rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b7280;
}

.modal-card__header h3 {
  margin: 0;
}

.modal-card__close,
.modal-card__toggle button,
.modal-card__create {
  border: none;
  border-radius: 999px;
  padding: 0.7rem 1rem;
  font-weight: 600;
  cursor: pointer;
}

.modal-card__close {
  background: #e2e8f0;
  color: #0f172a;
}

.modal-card__toggle {
  justify-content: flex-start;
}

.modal-card__toggle button {
  background: #e2e8f0;
  color: #475569;
}

.modal-card__toggle button.active {
  background: #0f766e;
  color: #fff;
}

.modal-card__field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.modal-card__field span {
  font-size: 0.9rem;
  font-weight: 600;
}

.modal-card__field input {
  border: 1px solid #cbd5e1;
  border-radius: 0.9rem;
  padding: 0.8rem 0.95rem;
  font: inherit;
}

.candidate-picker {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.candidate-picker__row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.8rem;
  align-items: start;
  border: 1px solid #e2e8f0;
  border-radius: 1rem;
  padding: 0.9rem 1rem;
}

.candidate-picker__row p {
  margin: 0.25rem 0 0;
  color: #64748b;
  font-size: 0.9rem;
}

.modal-card__footer p {
  margin: 0;
  color: #475569;
}

.modal-card__create {
  background: #0f766e;
  color: #fff;
}

.modal-card__create:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
