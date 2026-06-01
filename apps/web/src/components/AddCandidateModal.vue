<script setup>
import { ref, computed } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Dropdown from "primevue/dropdown";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import { useCandidateStore } from "../stores/candidates";

const props = defineProps({
  visible: {
    type: Boolean,
    required: true
  }
});

const emit = defineEmits(["update:visible"]);

const store = useCandidateStore();

const showModal = computed({
  get: () => props.visible,
  set: (val) => emit("update:visible", val)
});

// Form state
const name = ref("");
const email = ref("");
const role = ref("");
const status = ref("screening");
const score = ref(80);
const stage = ref("New application");
const location = ref("");
const experienceYears = ref(3);
const skillsRaw = ref("");
const summary = ref("");
const submitError = ref("");
const submitting = ref(false);

const statusOptions = [
  { label: "Screening", value: "screening" },
  { label: "Interview", value: "interview" },
  { label: "Offer", value: "offer" },
  { label: "Hired", value: "hired" },
  { label: "Rejected", value: "rejected" }
];

const resetForm = () => {
  name.value = "";
  email.value = "";
  role.value = "";
  status.value = "screening";
  score.value = 80;
  stage.value = "New application";
  location.value = "";
  experienceYears.value = 3;
  skillsRaw.value = "";
  summary.value = "";
  submitError.value = "";
};

const handleClose = () => {
  resetForm();
  showModal.value = false;
};

const handleSave = async () => {
  if (!name.value || !email.value || !role.value) {
    submitError.value = "Name, Email, and Role are required.";
    return;
  }

  // Parse comma separated skills
  const skills = skillsRaw.value
    ? skillsRaw.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const candidatePayload = {
    name: name.value,
    email: email.value,
    role: role.value,
    status: status.value,
    score: score.value,
    stage: stage.value,
    location: location.value || "Remote",
    experienceYears: experienceYears.value || 0,
    skills,
    summary: summary.value
  };

  submitting.value = true;
  submitError.value = "";

  try {
    await store.createCandidate(candidatePayload);
    handleClose();
  } catch (error) {
    submitError.value = error.response?.data?.message || "Failed to add candidate. Make sure email is unique.";
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <Dialog
    v-model:visible="showModal"
    modal
    header="Add New Candidate"
    :style="{ width: '45rem' }"
    class="glassmorphism-dialog"
    :closable="true"
    @hide="resetForm"
  >
    <div class="form-grid">
      <div class="form-field full-width" v-if="submitError">
        <div class="p-message p-message-error p-component">
          <div class="p-message-wrapper">
            <span class="p-message-icon pi pi-exclamation-triangle"></span>
            <span class="p-message-summary">{{ submitError }}</span>
          </div>
        </div>
      </div>

      <div class="form-field">
        <label for="c-name">Full Name *</label>
        <InputText id="c-name" v-model="name" placeholder="e.g. Liam Smith" />
      </div>

      <div class="form-field">
        <label for="c-email">Email Address *</label>
        <InputText id="c-email" v-model="email" placeholder="e.g. liam.s@example.com" />
      </div>

      <div class="form-field">
        <label for="c-role">Target Role *</label>
        <InputText id="c-role" v-model="role" placeholder="e.g. Lead React Developer" />
      </div>

      <div class="form-field">
        <label for="c-location">Location</label>
        <InputText id="c-location" v-model="location" placeholder="e.g. Austin, US" />
      </div>

      <div class="form-field">
        <label for="c-status">Hiring Stage</label>
        <Dropdown
          id="c-status"
          v-model="status"
          :options="statusOptions"
          option-label="label"
          option-value="value"
        />
      </div>

      <div class="form-field">
        <label for="c-stage">Sub-stage Label</label>
        <InputText id="c-stage" v-model="stage" placeholder="e.g. Final interview round" />
      </div>

      <div class="form-field">
        <label for="c-score">Match Score (0-100)</label>
        <InputNumber id="c-score" v-model="score" :min="0" :max="100" show-buttons />
      </div>

      <div class="form-field">
        <label for="c-exp">Experience (Years)</label>
        <InputNumber id="c-exp" v-model="experienceYears" :min="0" show-buttons />
      </div>

      <div class="form-field full-width">
        <label for="c-skills">Skills (Comma-separated)</label>
        <InputText id="c-skills" v-model="skillsRaw" placeholder="e.g. Vue 3, GraphQL, Webpack" />
      </div>

      <div class="form-field full-width">
        <label for="c-summary">AI Dossier Summary / Candidate Pitch</label>
        <Textarea id="c-summary" v-model="summary" rows="3" auto-resize placeholder="Quick professional overview..." />
      </div>
    </div>

    <template #footer>
      <div class="dialog-actions">
        <Button label="Cancel" icon="pi pi-times" outlined severity="secondary" @click="handleClose" />
        <Button label="Save Profile" icon="pi pi-check" :loading="submitting" @click="handleSave" />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  padding: 10px 0;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.full-width {
  grid-column: span 2;
}

label {
  font-weight: 600;
  color: #334155;
  font-size: 0.88rem;
}

.p-message {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
}

@media (max-width: 600px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
  .full-width {
    grid-column: span 1;
  }
}
</style>
