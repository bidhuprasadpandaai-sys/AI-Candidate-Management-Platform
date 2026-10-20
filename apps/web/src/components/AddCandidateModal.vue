<script setup>
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Dropdown from "primevue/dropdown";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import api from "../services/api";
import { useAuthStore } from "../stores/auth";
import { useCandidateStore } from "../stores/candidates";
import { useJobsStore } from "../stores/jobs";

const MAX_BYTES = 5 * 1024 * 1024;

const props = defineProps({
  visible: {
    type: Boolean,
    required: true
  }
});

const emit = defineEmits(["update:visible"]);

const store = useCandidateStore();
const auth = useAuthStore();
const jobsStore = useJobsStore();

const showModal = computed({
  get: () => props.visible,
  set: (val) => emit("update:visible", val)
});

// Admins are not tied to a company, so they choose one; everyone else adds to their own company.
const companyId = ref(null);
const companyOptions = computed(() => store.companies.map((company) => ({ label: company.name, value: company.id })));

// Form state
const name = ref("");
const email = ref("");
const phone = ref("");
const role = ref("");
const status = ref("screening");
const stage = ref("New application");
const location = ref("");
const experienceYears = ref(3);
const skillsRaw = ref("");
const summary = ref("");
const jobId = ref(null);
const submitError = ref("");
const submitting = ref(false);

// Resume autofill
const reading = ref(false);
const resumeInfo = ref(null); // the upload response while a resume is attached
const savedWithResume = ref(false);
const existingMatch = ref(null); // a resume of someone who is already a candidate: never used to fill or change a profile

const activeCompany = computed(() => (auth.isAdmin ? companyId.value : auth.user?.companyId));
const jobOptions = computed(() =>
  jobsStore.jobs
    .filter((job) => job.status === "open" && !job.isExpired && !job.isFull && (!activeCompany.value || job.companyId === activeCompany.value))
    .map((job) => ({ label: job.title, value: job.id }))
);
const blockedByDuplicate = computed(() => Boolean(resumeInfo.value?.alreadyAttachedTo));
const checkNote = (field) => {
  const level = resumeInfo.value?.confidence?.[field];
  if (level === "ai") return "Suggested by AI: please check";
  if (level === "low") return "Please check";
  return "";
};

const statusOptions = [
  { label: "Screening", value: "screening" },
  { label: "Interview", value: "interview" },
  { label: "Offer", value: "offer" },
  { label: "Hired", value: "hired" },
  { label: "Rejected", value: "rejected" }
];

watch(
  () => props.visible,
  async (open) => {
    if (!open) {
      await handleHide(); // closed by any route (Cancel, X, Escape, saved): clean up
      return;
    }
    if (auth.isAdmin) await store.fetchCompanies().catch(() => {});
    await jobsStore.fetchJobs().catch(() => {});
  }
);

const resetForm = () => {
  name.value = "";
  email.value = "";
  phone.value = "";
  role.value = "";
  status.value = "screening";
  stage.value = "New application";
  location.value = "";
  experienceYears.value = 3;
  skillsRaw.value = "";
  summary.value = "";
  jobId.value = null;
  companyId.value = null;
  resumeInfo.value = null;
  existingMatch.value = null;
  savedWithResume.value = false;
  reading.value = false;
  submitError.value = "";
};

// A resume that was read but not saved is removed, so no personal data is left behind.
async function discardResume() {
  const info = resumeInfo.value;
  if (info && !savedWithResume.value && !info.reused && !info.resume.candidateId) {
    await api.delete(`/resumes/${info.resume.id}`).catch(() => {});
  }
}

async function handleHide() {
  await discardResume();
  resetForm();
}

const handleClose = () => {
  showModal.value = false;
};

function openExisting() {
  const id = existingMatch.value?.id;
  showModal.value = false;
  if (id) store.selectCandidate(id);
}

async function removeResume() {
  await discardResume();
  resumeInfo.value = null;
}

const fillIfEmpty = (ref, value) => {
  if (value !== null && value !== undefined && value !== "" && !String(ref.value ?? "").trim()) ref.value = value;
};

async function onResumeChosen(event) {
  const picked = event.target.files?.[0] || null;
  event.target.value = "";
  if (!picked) return;
  submitError.value = "";

  if (!/\.(pdf|docx)$/i.test(picked.name)) {
    submitError.value = "Choose a PDF or Word (.docx) file.";
    return;
  }
  if (picked.size > MAX_BYTES) {
    submitError.value = "The file is larger than 5 MB.";
    return;
  }
  if (auth.isAdmin && !companyId.value) {
    submitError.value = "Choose the company first, then add the resume.";
    return;
  }

  await discardResume();
  resumeInfo.value = null;
  existingMatch.value = null;
  reading.value = true;
  try {
    const query = auth.isAdmin ? `?companyId=${encodeURIComponent(companyId.value)}` : "";
    const { data } = await api.post(`/resumes${query}`, picked, {
      headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(picked.name) },
      transformRequest: [(body) => body],
      timeout: 60000
    });
    if (data.existingCandidate) {
      // The person is already a candidate: leave their profile alone and do not keep this file here.
      resumeInfo.value = data;
      await discardResume();
      resumeInfo.value = null;
      existingMatch.value = data.existingCandidate;
      return;
    }
    resumeInfo.value = data;
    const p = data.profile || {};
    fillIfEmpty(name, p.name);
    fillIfEmpty(email, p.email);
    fillIfEmpty(phone, p.phone);
    fillIfEmpty(role, p.role);
    fillIfEmpty(location, p.location);
    fillIfEmpty(skillsRaw, (p.skills || []).join(", "));
    fillIfEmpty(summary, p.summary);
    if (p.experienceYears !== null && p.experienceYears !== undefined) experienceYears.value = p.experienceYears;
  } catch (error) {
    submitError.value = error.response?.data?.error || error.response?.data?.message || "The resume could not be read.";
  } finally {
    reading.value = false;
  }
}

const handleSave = async () => {
  if (!name.value || !email.value || !role.value) {
    submitError.value = "Name, Email, and Role are required.";
    return;
  }
  if (auth.isAdmin && !companyId.value) {
    submitError.value = "Choose the company this candidate belongs to.";
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
    phone: phone.value.trim(),
    role: role.value,
    status: status.value,
    stage: stage.value,
    location: location.value || "Remote",
    experienceYears: experienceYears.value || 0,
    skills,
    summary: summary.value,
    ...(jobId.value ? { jobId: jobId.value } : {}),
    ...(resumeInfo.value ? { resumeId: resumeInfo.value.resume.id } : {}),
    ...(auth.isAdmin ? { companyId: companyId.value } : {})
  };

  submitting.value = true;
  submitError.value = "";

  try {
    await store.createCandidate(candidatePayload);
    savedWithResume.value = true;
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
    :closable="!submitting && !reading"
    @hide="handleHide"
  >
    <div class="form-grid">
      <div class="form-field full-width" v-if="submitError">
        <div class="p-message p-message-error p-component" role="alert">
          <div class="p-message-wrapper">
            <span class="p-message-icon pi pi-exclamation-triangle"></span>
            <span class="p-message-summary">{{ submitError }}</span>
          </div>
        </div>
      </div>

      <div class="form-field full-width" v-if="auth.isAdmin">
        <label for="c-company">Company *</label>
        <Dropdown
          id="c-company"
          v-model="companyId"
          :options="companyOptions"
          option-label="label"
          option-value="value"
          placeholder="Select a company"
          aria-label="Company"
        />
      </div>

      <!-- Resume autofill -->
      <section class="form-field full-width resume-box" aria-label="Resume autofill">
        <div v-if="existingMatch" class="p-message p-message-info p-component" role="status" data-test="existing-candidate">
          <div class="p-message-wrapper">
            <span class="p-message-summary">
              {{ existingMatch.name }} is already a candidate, so nothing was filled in and their profile was not changed.
              Open their profile and add the resume there.
            </span>
            <Button label="Open profile" size="small" text @click="openExisting" />
          </div>
        </div>
        <label for="c-resume">Autofill from a resume (optional)</label>
        <template v-if="!resumeInfo">
          <input
            id="c-resume"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-label="Resume file"
            :disabled="reading"
            @change="onResumeChosen"
          />
          <small class="hint">
            <template v-if="reading"><i class="pi pi-spin pi-spinner"></i> Reading the resume…</template>
            <template v-else>Upload a PDF or Word resume (up to 5 MB). We fill in the form below and keep the file with the candidate. Please check what was filled in.</template>
          </small>
        </template>
        <template v-else>
          <div class="resume-attached">
            <span><i class="pi pi-paperclip"></i> {{ resumeInfo.resume.filename }}</span>
            <small class="hint">
              <template v-if="resumeInfo.source === 'rules+ai'">read with AI help for the gaps</template>
              <template v-else-if="resumeInfo.reused">this file was uploaded before</template>
              <template v-else>read automatically</template>
            </small>
            <Button label="Remove" icon="pi pi-times" size="small" text severity="secondary" @click="removeResume" />
          </div>
          <div v-if="resumeInfo.alreadyAttachedTo" class="p-message p-message-warn p-component" role="alert">
            <div class="p-message-wrapper">
              <span class="p-message-summary">
                This resume already belongs to {{ resumeInfo.alreadyAttachedTo.name || "another candidate" }}. Remove it to continue.
              </span>
            </div>
          </div>
          <div v-for="warning in resumeInfo.warnings" :key="warning" class="p-message p-message-warn p-component" role="status">
            <div class="p-message-wrapper"><span class="p-message-summary">{{ warning }}</span></div>
          </div>
        </template>
      </section>

      <div class="form-field">
        <label for="c-name">Full Name *</label>
        <InputText id="c-name" v-model="name" placeholder="e.g. Liam Smith" />
        <small v-if="checkNote('name')" class="check-note">{{ checkNote("name") }}</small>
      </div>

      <div class="form-field">
        <label for="c-email">Email Address *</label>
        <InputText id="c-email" v-model="email" placeholder="e.g. liam.s@example.com" />
      </div>

      <div class="form-field">
        <label for="c-phone">Phone</label>
        <InputText id="c-phone" v-model="phone" placeholder="e.g. +1 415 555 0123" maxlength="30" />
      </div>

      <div class="form-field">
        <label for="c-role">Target Role *</label>
        <InputText id="c-role" v-model="role" placeholder="e.g. Lead React Developer" />
        <small v-if="checkNote('role')" class="check-note">{{ checkNote("role") }}</small>
      </div>

      <div class="form-field">
        <label for="c-location">Location</label>
        <InputText id="c-location" v-model="location" placeholder="e.g. Austin, US" />
      </div>

      <div class="form-field">
        <label for="c-job">Apply to a job (optional)</label>
        <Dropdown
          id="c-job"
          v-model="jobId"
          :options="jobOptions"
          option-label="label"
          option-value="value"
          show-clear
          placeholder="No job yet (add more later)"
          aria-label="Job"
        />
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
        <label for="c-exp">Experience (Years)</label>
        <InputNumber id="c-exp" v-model="experienceYears" :min="0" show-buttons />
        <small v-if="checkNote('experienceYears')" class="check-note">{{ checkNote("experienceYears") }}</small>
      </div>

      <div class="form-field full-width">
        <label for="c-skills">Skills (Comma-separated)</label>
        <InputText id="c-skills" v-model="skillsRaw" placeholder="e.g. Vue 3, GraphQL, Webpack" />
        <small v-if="checkNote('skills')" class="check-note">{{ checkNote("skills") }}</small>
      </div>

      <div class="form-field full-width">
        <label for="c-summary">AI Dossier Summary / Candidate Pitch</label>
        <Textarea id="c-summary" v-model="summary" rows="3" auto-resize placeholder="Quick professional overview..." />
      </div>
    </div>

    <template #footer>
      <div class="dialog-actions">
        <Button label="Cancel" icon="pi pi-times" outlined severity="secondary" :disabled="submitting" @click="handleClose" />
        <Button label="Save Profile" icon="pi pi-check" :loading="submitting" :disabled="reading || blockedByDuplicate" @click="handleSave" />
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

.resume-box {
  padding: 12px;
  border: 1px dashed #94a3b8;
  border-radius: 12px;
  background: rgba(241, 245, 249, 0.7);
}

.resume-attached {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-weight: 600;
}

.hint {
  color: #64748b;
  font-weight: 400;
}

.check-note {
  color: #b45309;
}

.p-message {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
}

.p-message-error {
  background: #fef2f2;
  color: #b91c1c;
}

.p-message-warn {
  background: #fffbeb;
  color: #92400e;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 768px) {
  .form-grid { grid-template-columns: 1fr; }
  .full-width { grid-column: span 1; }
}
</style>
