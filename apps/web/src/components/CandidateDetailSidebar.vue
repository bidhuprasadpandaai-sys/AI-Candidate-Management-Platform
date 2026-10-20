<script setup>
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Dropdown from "primevue/dropdown";
import InputText from "primevue/inputtext";
import Sidebar from "primevue/sidebar";
import { PIPELINE_STAGES, STATUS_SEVERITY, profileCompleteness } from "@acmp/shared";
import CandidateDocuments from "./CandidateDocuments.vue";
import ProfileMeter from "./ProfileMeter.vue";
import api from "../services/api";
import { useAuthStore } from "../stores/auth";
import { useCandidateStore } from "../stores/candidates";
import { useJobsStore } from "../stores/jobs";

const store = useCandidateStore();
const auth = useAuthStore();
const jobsStore = useJobsStore();

// Role-aware controls. These only hide or disable things; the API enforces the same rules.
const canEdit = computed(() => auth.canEdit(store.selectedCandidate));
const canAnnotate = computed(() => auth.canAnnotate(store.selectedCandidate));
const canDelete = computed(() => auth.canDelete(store.selectedCandidate));
const canAssign = computed(() => auth.canAssign(store.selectedCandidate));
const isOwner = computed(() => store.selectedCandidate?.ownerId === auth.user?.id);

// Sections of the overlay: one tab each, so only one topic is on screen at a time
const tab = ref("overview");
const documentsRef = ref(null);
const tabs = computed(() => {
  const candidate = store.selectedCandidate;
  const expired = documentsRef.value?.expiredCount || 0;
  return [
    { id: "overview", label: "Overview", icon: "pi-user" },
    { id: "jobs", label: "Jobs", icon: "pi-briefcase", badge: applications.value.length || "" },
    { id: "documents", label: "Documents", icon: "pi-file", badge: expired || "", alert: expired > 0 },
    { id: "notes", label: "Notes", icon: "pi-comments", badge: (candidate?.notes?.length || 0) + (candidate?.interviews?.length || 0) || "" },
    { id: "activity", label: "Activity", icon: "pi-history" }
  ];
});

// Ownership and activity
const companyChoice = ref(null);
const ownerChoice = ref(null);
const assignableUsers = ref([]);
const activity = ref([]);
const assignError = ref("");

const companyOptions = computed(() => store.companies.map((company) => ({ label: company.name, value: company.id })));
// Owner choices: active users of the candidate's company (admins can own anything).
const ownerOptions = computed(() => {
  const companyId = store.selectedCandidate?.companyId;
  return assignableUsers.value
    .filter((user) => user.accessRole === "admin" || (companyId && user.companyId === companyId))
    .map((user) => ({ label: user.name || user.email, value: user.id }));
});

// Profile completion
const completeness = computed(() => profileCompleteness(store.selectedCandidate));

// Job applications: a candidate can apply to several jobs; each has its own stage and fit score
const applications = ref([]);
const appsLoading = ref(false);
const appsError = ref("");
const expandedApp = ref(null);
const applyChoice = ref(null);
let appsRequest = 0;

async function loadApplications() {
  const id = store.selectedCandidateId;
  if (!id) return;
  const mine = ++appsRequest;
  appsLoading.value = true;
  appsError.value = "";
  try {
    const result = await store.fetchApplications(id);
    if (mine !== appsRequest) return;
    applications.value = result;
    if (!result.some((a) => a.id === expandedApp.value)) expandedApp.value = result[0]?.id ?? null;
  } catch {
    if (mine === appsRequest) {
      applications.value = [];
      appsError.value = "The job fit could not be calculated.";
    }
  } finally {
    if (mine === appsRequest) appsLoading.value = false;
  }
}

// Recalculate when anything the scores depend on changes (resume, skills, role, years, ...)
const fitSignature = computed(() => {
  const c = store.selectedCandidate;
  return c ? JSON.stringify([c.id, c.resumeId, c.role, c.skills, c.experienceYears, c.location, c.summary, c.phone, c.score]) : "";
});
watch(fitSignature, (value, previous) => {
  if (value && value !== previous) loadApplications();
});

const applyOptions = computed(() => {
  const companyId = store.selectedCandidate?.companyId;
  const applied = new Set(applications.value.map((a) => a.job.id));
  return jobsStore.jobs
    .filter((job) => job.companyId === companyId && job.status === "open" && !job.isExpired && !job.isFull && !applied.has(job.id))
    .map((job) => ({ label: job.title, value: job.id }));
});
const hasApplications = computed(() => applications.value.length > 0);

async function addApplication() {
  if (!applyChoice.value) return;
  appsError.value = "";
  try {
    await store.applyToJob(store.selectedCandidateId, applyChoice.value);
    applyChoice.value = null;
    await jobsStore.fetchJobs().catch(() => {});
    await loadApplications();
    loadActivity();
  } catch (error) {
    appsError.value = error.response?.data?.error || "Unable to add the candidate to that job.";
  }
}

async function changeStage(application, status) {
  appsError.value = "";
  try {
    await store.moveCandidateApplication(application.id, status);
    await loadApplications();
    loadActivity();
  } catch (error) {
    appsError.value = error.response?.data?.error || "Unable to move the candidate.";
  }
}

async function removeApplication(application) {
  if (!confirm(`Remove this candidate from "${application.job.title}"?`)) return;
  appsError.value = "";
  try {
    await store.removeApplication(application.id);
    await jobsStore.fetchJobs().catch(() => {});
    await loadApplications();
    loadActivity();
  } catch (error) {
    appsError.value = error.response?.data?.error || "Unable to remove the application.";
  }
}

const toggleApp = (id) => {
  expandedApp.value = expandedApp.value === id ? null : id;
};

// Resume
const resumeBusy = ref(false);
const resumeError = ref("");

async function loadJobs() {
  resumeError.value = "";
  try {
    if (!jobsStore.jobs.length) await jobsStore.fetchJobs();
  } catch {
    /* jobs are optional extras for this panel */
  }
}

async function downloadResume() {
  resumeError.value = "";
  resumeBusy.value = true;
  try {
    const { data, headers } = await api.get(`/resumes/${store.selectedCandidate.resumeId}/file`, { responseType: "blob" });
    const disposition = headers?.["content-disposition"] || "";
    const name = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] || "resume");
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    resumeError.value = "The resume could not be downloaded.";
  } finally {
    resumeBusy.value = false;
  }
}

// What the resume says that differs from the profile. The name is never offered (it stays as entered).
const RESUME_FIELDS = [
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location" },
  { key: "role", label: "Role" },
  { key: "experienceYears", label: "Years of experience" },
  { key: "skills", label: "Skills" },
  { key: "summary", label: "Summary" }
];
const resumeUpdate = ref(null);
const resumeUpdateBusy = ref(false);
const resumeUpdateError = ref("");

const showValue = (key, value) => (key === "skills" ? (value || []).join(", ") : key === "experienceYears" ? `${value}` : value || "");
const sameValue = (key, a, b) =>
  key === "skills"
    ? JSON.stringify([...(a || [])].map((x) => x.toLowerCase()).sort()) === JSON.stringify([...(b || [])].map((x) => x.toLowerCase()).sort())
    : String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

function offerProfileUpdate(profile) {
  const candidate = store.selectedCandidate;
  const items = [];
  for (const { key, label } of RESUME_FIELDS) {
    const next = profile[key];
    const empty = next === null || next === undefined || next === "" || (Array.isArray(next) && !next.length);
    if (empty || sameValue(key, next, candidate[key])) continue;
    items.push({ key, label, value: next, current: showValue(key, candidate[key]), proposed: showValue(key, next), checked: true });
  }
  resumeUpdateError.value = "";
  resumeUpdate.value = items.length ? { items } : null;
}

async function applyProfileUpdate() {
  const chosen = resumeUpdate.value.items.filter((item) => item.checked);
  if (!chosen.length) {
    resumeUpdate.value = null;
    return;
  }
  resumeUpdateBusy.value = true;
  resumeUpdateError.value = "";
  try {
    await store.updateCandidate(store.selectedCandidateId, Object.fromEntries(chosen.map((item) => [item.key, item.value])));
    resumeUpdate.value = null;
    loadActivity();
  } catch (error) {
    resumeUpdateError.value = error.response?.data?.message || error.response?.data?.error || "The profile could not be updated.";
  } finally {
    resumeUpdateBusy.value = false;
  }
}

async function attachResume(event) {
  const picked = event.target.files?.[0];
  event.target.value = "";
  if (!picked) return;
  resumeError.value = "";
  if (!/\.(pdf|docx)$/i.test(picked.name) || picked.size > 5 * 1024 * 1024) {
    resumeError.value = "Choose a PDF or Word (.docx) file up to 5 MB.";
    return;
  }
  resumeBusy.value = true;
  try {
    const companyId = store.selectedCandidate.companyId;
    const query = auth.isAdmin ? `?companyId=${encodeURIComponent(companyId)}` : "";
    const { data } = await api.post(`/resumes${query}`, picked, {
      headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(picked.name) },
      transformRequest: [(body) => body],
      timeout: 60000
    });
    if (data.alreadyAttachedTo) {
      resumeError.value =
        data.alreadyAttachedTo.id === store.selectedCandidateId
          ? "That file is already this candidate's resume."
          : "That file is already attached to another candidate.";
      return;
    }
    // Attaching never changes the profile by itself: the file is stored, then we ask what to do with what it says.
    await store.updateCandidate(store.selectedCandidateId, { resumeId: data.resume.id });
    offerProfileUpdate(data.profile || {});
    loadActivity();
  } catch (error) {
    resumeError.value = error.response?.data?.error || error.response?.data?.message || "The resume could not be attached.";
  } finally {
    resumeBusy.value = false;
  }
}

async function loadActivity() {
  if (!store.selectedCandidateId) return;
  try {
    activity.value = await store.fetchCandidateActivity(store.selectedCandidateId);
  } catch {
    activity.value = [];
  }
}

async function loadOwnership() {
  assignError.value = "";
  companyChoice.value = store.selectedCandidate?.companyId ?? null;
  ownerChoice.value = store.selectedCandidate?.ownerId ?? null;
  if (!auth.isAdmin) return;
  try {
    await store.fetchCompanies();
    const { data } = await api.get("/users");
    assignableUsers.value = data.users.filter((user) => user.isActive);
  } catch {
    /* companies and users are optional extras for this panel */
  }
}

async function saveAssignment(changes) {
  assignError.value = "";
  try {
    await store.assignCandidate(store.selectedCandidateId, changes);
    await loadOwnership();
    await loadActivity();
  } catch (error) {
    assignError.value = error.response?.data?.message || "Unable to change ownership.";
  }
}

const assignToMe = () => saveAssignment({ ownerId: auth.user.id });
const saveCompany = () => saveAssignment({ companyId: companyChoice.value });
const saveOwner = () => saveAssignment({ ownerId: ownerChoice.value });

const formatActivityTime = (iso) => (iso ? new Date(iso).toLocaleString() : "");

const showSidebar = ref(false);

// Watch for store selection changes
watch(
  () => store.selectedCandidateId,
  (newId) => {
    showSidebar.value = !!newId;
    if (newId) {
      loadOwnership();
      loadJobs();
      loadActivity();
      loadApplications();
      tab.value = "overview";
      resumeUpdate.value = null;
      aiAnalysis.value = ""; // Reset analysis when candidate changes
      newNote.value = "";
      resetInterviewForm();
    }
  }
);

const handleClose = () => {
  store.clearSelection();
};

const getInitials = (name) => {
  if (!name) return "";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

const formatDate = (dateStr) => {
  if (!dateStr) return "";
  // If it looks like a YYYY-MM-DD date, format it nicely
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split("-");
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  return dateStr; // Return as-is for natural language dates like "Next Monday"
};


// Notes section
const newNote = ref("");
const addingNote = ref(false);

const handleAddNote = async () => {
  if (!newNote.value.trim()) return;
  addingNote.value = true;
  try {
    await store.addNoteToCandidate(store.selectedCandidateId, newNote.value.trim());
    newNote.value = "";
    loadActivity();
  } catch (err) {
    console.error("Failed to add note", err);
  } finally {
    addingNote.value = false;
  }
};

// Interview scheduling section
const showScheduleForm = ref(false);
const interviewType = ref("");
const interviewDate = ref("");
const interviewTime = ref("");
const interviewer = ref("");
const scheduling = ref(false);

const resetInterviewForm = () => {
  interviewType.value = "";
  interviewDate.value = "";
  interviewTime.value = "";
  interviewer.value = "";
  showScheduleForm.value = false;
};

const handleScheduleInterview = async () => {
  if (!interviewType.value || !interviewDate.value || !interviewTime.value || !interviewer.value) {
    return;
  }

  scheduling.value = true;
  try {
    const interviewData = {
      title: `${interviewType.value} Interview`,
      type: interviewType.value,
      date: interviewDate.value,
      time: interviewTime.value,
      interviewer: interviewer.value
    };

    await store.scheduleInterview(store.selectedCandidateId, interviewData);
    resetInterviewForm();
    loadActivity();
  } catch (err) {
    console.error("Scheduling failed", err);
  } finally {
    scheduling.value = false;
  }
};

// AI Profiler simulation
const aiAnalysis = ref("");
const generatingAi = ref(false);

const runAiAnalysis = () => {
  if (!store.selectedCandidate) return;
  generatingAi.value = true;
  aiAnalysis.value = "";

  setTimeout(() => {
    const candidate = store.selectedCandidate;
    const isHighMatch = candidate.score >= 85;

    aiAnalysis.value = `🤖 **TalentOS AI Assessment Core**\n\n` +
      `**Fit Evaluation for ${candidate.role}:**\n` +
      `Candidate **${candidate.name}** displays an **${isHighMatch ? 'exceptional' : 'appropriate'}** technical alignment for our pipeline. ` +
      `With **${candidate.experienceYears} years** of industry experience and a match rating of **${candidate.score}%**, they score well above general baselines.\n\n` +
      `💡 **Key Strengths Identified:**\n` +
      `- **Skill Synergy:** Strong alignment in core stack: *${candidate.skills.slice(0, 3).join(", ") || 'General Engineering'}*.\n` +
      `- **Hiring Velocity:** Positioned at **${candidate.stage || 'screening'}** stage. High engagement indicators.\n` +
      `- **Recruiter Log Consensus:** notes showcase positive soft skills and strong architectural grasp.\n\n` +
      `⚠️ **Areas to Probe / Next Steps:**\n` +
      `${isHighMatch 
        ? '- Candidate is in high demand; expedite final review rounds and align on compensation packages.'
        : '- Validate deep design fundamentals and probe their backend scaling experience during next interview.'}\n\n` +
      `**Final AI Status:** ✅ **Recommended to Proceed**`;

    generatingAi.value = false;
  }, 1200);
};

const statusOptions = [
  { label: "Screening", value: "screening" },
  { label: "Interview", value: "interview" },
  { label: "Offer", value: "offer" },
  { label: "Hired", value: "hired" },
  { label: "Rejected", value: "rejected" }
];

const handleStatusChange = async (newVal) => {
  if (!store.selectedCandidateId) return;
  try {
    await store.updateCandidate(store.selectedCandidateId, {
      status: newVal,
      stage: `${newVal.charAt(0).toUpperCase()}${newVal.slice(1)} stage`
    });
    loadActivity();
  } catch (error) {
    console.error("Status update failed", error);
  }
};

const handleDelete = async () => {
  if (!confirm(`Are you sure you want to remove ${store.selectedCandidate.name} from the pipeline?`)) {
    return;
  }
  try {
    await store.deleteCandidate(store.selectedCandidateId);
  } catch (error) {
    console.error("Delete failed", error);
  }
};
</script>

<template>
  <Sidebar
    v-model:visible="showSidebar"
    position="right"
    class="candidate-drawer"
    :style="{ width: '46rem', maxWidth: '100vw' }"
    @hide="handleClose"
  >
    <template #header>
      <div class="drawer-header" v-if="store.selectedCandidate">
        <div class="avatar-badge">
          {{ getInitials(store.selectedCandidate.name) }}
        </div>
        <div class="header-copy">
          <h3>{{ store.selectedCandidate.name }}</h3>
          <p class="muted-text">{{ store.selectedCandidate.role }}<template v-if="store.selectedCandidate.location"> · {{ store.selectedCandidate.location }}</template></p>
        </div>
        <span class="score-pill" :class="{ high: store.selectedCandidate.score >= 85 }" :title="'Best match score across jobs'">
          {{ store.selectedCandidate.score }}%
        </span>
      </div>
    </template>

    <div class="drawer-body" v-if="store.selectedCandidate">
      <div class="drawer-tabs" role="tablist" aria-label="Candidate sections">
        <button
          v-for="item in tabs"
          :id="`tab-${item.id}`"
          :key="item.id"
          type="button"
          role="tab"
          class="drawer-tab"
          :class="{ active: tab === item.id }"
          :aria-selected="tab === item.id"
          :aria-controls="`panel-${item.id}`"
          @click="tab = item.id"
        >
          <i class="pi" :class="item.icon" aria-hidden="true"></i>
          <span>{{ item.label }}</span>
          <span v-if="item.badge" class="tab-badge" :class="{ alert: item.alert }">{{ item.badge }}</span>
        </button>
      </div>

      <Dialog
        :visible="Boolean(resumeUpdate)"
        modal
        header="Update the profile from this resume?"
        :style="{ width: '34rem', maxWidth: '95vw' }"
        data-test="resume-update"
        @update:visible="(open) => { if (!open) resumeUpdate = null; }"
      >
        <p class="ru-intro">The resume was saved. Its details differ from {{ store.selectedCandidate.name }}'s profile. Tick what should be updated. The name is never changed.</p>
        <ul v-if="resumeUpdate" class="ru-list">
          <li v-for="item in resumeUpdate.items" :key="item.key">
            <label>
              <input v-model="item.checked" type="checkbox" :aria-label="`Update ${item.label}`" />
              <span class="ru-field">{{ item.label }}</span>
            </label>
            <div class="ru-values">
              <span class="ru-old">{{ item.current || "empty" }}</span>
              <i class="pi pi-arrow-right" aria-hidden="true"></i>
              <strong class="ru-new">{{ item.proposed }}</strong>
            </div>
          </li>
        </ul>
        <p v-if="resumeUpdateError" class="empty-text" role="alert">{{ resumeUpdateError }}</p>
        <template #footer>
          <Button label="Keep current profile" text severity="secondary" @click="resumeUpdate = null" />
          <Button label="Update selected" icon="pi pi-check" :loading="resumeUpdateBusy" @click="applyProfileUpdate" />
        </template>
      </Dialog>

      <!-- Overview -->
      <div v-show="tab === 'overview'" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" class="tab-panel">
      <!-- 1) Candidate Snapshot -->
      <section class="snapshot-card glassmorphic-inset">
        <div class="d-meta">
          <span class="label">Location</span>
          <strong>{{ store.selectedCandidate.location }}</strong>
        </div>
        <div class="d-meta" v-if="store.selectedCandidate.phone">
          <span class="label">Phone</span>
          <strong>{{ store.selectedCandidate.phone }}</strong>
        </div>
        <div class="d-meta">
          <span class="label">Experience</span>
          <strong>{{ store.selectedCandidate.experienceYears }} Years</strong>
        </div>
        <div class="d-meta">
          <span class="label">Match Score</span>
          <span class="score-pill" :class="{ high: store.selectedCandidate.score >= 85 }">
            {{ store.selectedCandidate.score }}%
          </span>
        </div>
      </section>

      <!-- 2) Status Selector & Actions -->
      <section class="action-section">
        <div class="field-row">
          <label>Stage Status</label>
          <Dropdown
            :model-value="store.selectedCandidate.status"
            :options="statusOptions"
            option-label="label"
            option-value="value"
            @update:model-value="handleStatusChange"
            class="status-dropdown"
            :disabled="!canEdit || hasApplications"
          />
        </div>
        <p v-if="hasApplications" class="empty-text" data-test="stage-hint">The stage is set per job: change it in "Jobs and fit" below or on the job's board.</p>
      </section>

      <!-- 2d) Profile completion -->
      <section class="drawer-section" aria-label="Profile completion">
        <h4>Profile completion</h4>
        <ProfileMeter :candidate="store.selectedCandidate" />
        <ul v-if="completeness.missing.length" class="missing-list" data-test="missing-list">
          <li v-for="item in completeness.missing" :key="item.key">Add {{ item.label.toLowerCase() }}</li>
        </ul>
        <p v-else class="empty-text">Everything we ask for is filled in.</p>
      </section>

      <!-- 3) Skills wrap -->
      <section class="drawer-section">
        <h4>Core Skills</h4>
        <div class="skills-wrap">
          <span v-for="skill in store.selectedCandidate.skills" :key="skill" class="skill-chip">
            {{ skill }}
          </span>
          <span v-if="!store.selectedCandidate.skills?.length" class="empty-text">
            No specific skills cataloged.
          </span>
        </div>
      </section>

      <!-- 4) AI Profiling Review -->
      <section class="drawer-section ai-profiler-section">
        <div class="section-title-row">
          <h4>Recruiting AI Insight</h4>
          <Button
            label="Profile Fit"
            icon="pi pi-bolt"
            size="small"
            severity="help"
            outlined
            :loading="generatingAi"
            @click="runAiAnalysis"
          />
        </div>

        <div v-if="aiAnalysis" class="ai-box glassmorphic-inset markdown-body">
          <p v-for="(paragraph, index) in aiAnalysis.split('\n\n')" :key="index">
            <span v-if="paragraph.startsWith('🤖') || paragraph.startsWith('**') || paragraph.startsWith('💡')">
              <strong>{{ paragraph.split('\n')[0] }}</strong>
              <br v-if="paragraph.includes('\n')" />
              <span v-if="paragraph.includes('\n')">{{ paragraph.slice(paragraph.indexOf('\n') + 1) }}</span>
            </span>
            <span v-else>{{ paragraph }}</span>
          </p>
        </div>
        <div v-else class="empty-ai-message">
          <p class="muted-text text-center">Click Profile Fit to compile real-time hiring evaluation summary.</p>
        </div>
      </section>

      <!-- 2b) Ownership -->
      <section class="drawer-section ownership-section" aria-label="Ownership">
        <h4>Ownership</h4>
        <div class="own-row">
          <span class="label">Company</span>
          <strong data-test="company-name">{{ store.selectedCandidate.companyName || "No company" }}</strong>
        </div>
        <div class="own-row">
          <span class="label">Owner</span>
          <strong data-test="owner-name">{{ store.selectedCandidate.ownerName || "Unassigned" }}</strong>
        </div>
        <template v-if="canAssign">
          <Button
            v-if="!isOwner && !auth.isAdmin"
            label="Assign to me"
            icon="pi pi-user-plus"
            size="small"
            outlined
            @click="assignToMe"
          />
          <template v-if="auth.isAdmin">
            <div class="own-edit">
              <Dropdown v-model="companyChoice" :options="companyOptions" option-label="label" option-value="value" placeholder="Company" aria-label="Company" />
              <Button label="Set company" size="small" outlined @click="saveCompany" />
            </div>
            <div class="own-edit">
              <Dropdown v-model="ownerChoice" :options="ownerOptions" option-label="label" option-value="value" show-clear placeholder="Owner" aria-label="Owner" />
              <Button label="Set owner" size="small" outlined @click="saveOwner" />
            </div>
          </template>
        </template>
        <p v-if="assignError" class="empty-text" role="alert">{{ assignError }}</p>
      </section>

        <div v-if="canDelete" class="danger-zone">
          <Button
            v-if="canDelete"
            label="Delete Candidate"
            icon="pi pi-trash"
            severity="danger"
            text
            class="delete-btn"
            @click="handleDelete"
          />
        </div>
      </div>

      <!-- Jobs and fit -->
      <div v-show="tab === 'jobs'" id="panel-jobs" role="tabpanel" aria-labelledby="tab-jobs" class="tab-panel">
      <!-- 2e) Jobs and fit: one entry per job the candidate applied to -->
      <section class="drawer-section" aria-label="Jobs and fit">
        <h4>Jobs and fit</h4>
        <p v-if="appsLoading && !applications.length" class="empty-text">Calculating…</p>
        <p v-else-if="appsError" class="empty-text" role="alert">{{ appsError }}</p>
        <p v-if="!hasApplications && !appsLoading && !appsError" class="empty-text" data-test="fit-no-job">
          Add this candidate to a job to see how well they fit it (from their profile, resume and the job description). A candidate can be considered for several jobs.
        </p>

        <ul class="app-list">
          <li v-for="application in applications" :key="application.id" class="app-item" data-test="application">
            <div class="app-head">
              <button type="button" class="app-toggle" :aria-expanded="expandedApp === application.id" @click="toggleApp(application.id)">
                <span class="fit-badge" :class="`fit-${application.fit.level}`" data-test="fit-score" :aria-label="`Fit score ${application.fit.score} out of 100`">{{ application.fit.score }}</span>
                <span class="app-title">
                  <strong data-test="app-job">{{ application.job.title }}</strong>
                  <small class="muted-text">{{ application.fit.label }}</small>
                </span>
              </button>
              <select
                v-if="canEdit"
                class="app-stage"
                :value="application.status"
                :aria-label="`Stage for ${application.job.title}`"
                @change="changeStage(application, $event.target.value)"
              >
                <option v-for="stage in PIPELINE_STAGES" :key="stage" :value="stage">{{ stage.charAt(0).toUpperCase() + stage.slice(1) }}</option>
              </select>
              <span v-else class="app-stage-text" data-test="app-stage">{{ application.status }}</span>
              <Button v-if="canEdit" icon="pi pi-times" text rounded size="small" severity="secondary" :aria-label="`Remove from ${application.job.title}`" @click="removeApplication(application)" />
            </div>

            <div v-if="expandedApp === application.id" class="fit-section" :class="`fit-${application.fit.level}`" data-test="fit-details">
              <p class="fit-explanation" data-test="fit-explanation">
                {{ application.fit.explanation }}
                <small v-if="application.fit.explanationSource === 'ai'" class="muted-text"> (worded by AI from the numbers below)</small>
              </p>
              <div class="muted-text" v-if="application.fit.usedResume">Resume included</div>
              <ul class="fit-factors">
                <li v-for="factor in application.fit.breakdown" :key="factor.key">
                  <div class="fit-factor__row">
                    <span>{{ factor.label }} <small class="muted-text">({{ factor.weight }}%)</small></span>
                    <strong>{{ factor.score }}</strong>
                  </div>
                  <span class="fit-bar" role="progressbar" :aria-label="`${factor.label} score`" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="factor.score">
                    <span class="fit-bar__fill" :style="{ width: `${factor.score}%` }"></span>
                  </span>
                  <small class="muted-text">{{ factor.detail }}</small>
                </li>
              </ul>
              <div v-if="application.fit.matchedSkills.length || application.fit.missingSkills.length" class="fit-skills">
                <div v-if="application.fit.matchedSkills.length">
                  <span class="label">Has</span>
                  <span v-for="skill in application.fit.matchedSkills" :key="`m-${skill}`" class="skill-chip fit-chip-match">{{ skill }}</span>
                </div>
                <div v-if="application.fit.missingSkills.length">
                  <span class="label">Missing</span>
                  <span v-for="skill in application.fit.missingSkills" :key="`x-${skill}`" class="skill-chip fit-chip-missing">{{ skill }}</span>
                </div>
              </div>
              <ul v-if="application.fit.warnings.length" class="fit-warnings">
                <li v-for="warning in application.fit.warnings" :key="warning">{{ warning }}</li>
              </ul>
            </div>
          </li>
        </ul>

        <div v-if="canEdit && applyOptions.length" class="own-edit">
          <Dropdown v-model="applyChoice" :options="applyOptions" option-label="label" option-value="value" show-clear placeholder="Add to a job" aria-label="Add to a job" />
          <Button label="Add to job" size="small" outlined :disabled="!applyChoice" @click="addApplication" />
        </div>
      </section>

      </div>

      <!-- Documents -->
      <div v-show="tab === 'documents'" id="panel-documents" role="tabpanel" aria-labelledby="tab-documents" class="tab-panel">
      <!-- 2c) Resume -->
      <section class="drawer-section" aria-label="Resume">
        <h4>Resume</h4>
        <div class="own-row">
          <span class="label">Resume</span>
          <strong data-test="resume-state">{{ store.selectedCandidate.resumeId ? "On file" : "None" }}</strong>
        </div>
        <Button
          v-if="store.selectedCandidate.resumeId"
          label="Download resume"
          icon="pi pi-download"
          size="small"
          outlined
          :loading="resumeBusy"
          @click="downloadResume"
        />
        <label v-if="canEdit && auth.can('resume:upload')" class="attach-resume">
          <span>{{ store.selectedCandidate.resumeId ? "Replace resume" : "Attach resume" }} (PDF or Word)</span>
          <input type="file" accept=".pdf,.docx" aria-label="Attach resume" :disabled="resumeBusy" @change="attachResume" />
        </label>
        <p v-if="resumeError" class="empty-text" role="alert">{{ resumeError }}</p>
      </section>

        <section class="drawer-section" aria-label="Other documents">
          <CandidateDocuments
            ref="documentsRef"
            :candidate-id="store.selectedCandidate.id"
            :company-id="store.selectedCandidate.companyId"
            :can-manage="canEdit && auth.can('resume:upload')"
          />
        </section>
      </div>

      <!-- Notes and interviews -->
      <div v-show="tab === 'notes'" id="panel-notes" role="tabpanel" aria-labelledby="tab-notes" class="tab-panel">
      <!-- 5) Interview Scheduling -->
      <section class="drawer-section">
        <div class="section-title-row">
          <h4>Scheduled Interviews</h4>
          <Button
            v-if="canAnnotate"
            :label="showScheduleForm ? 'Cancel' : 'Schedule Round'"
            :icon="showScheduleForm ? 'pi pi-times' : 'pi pi-calendar-plus'"
            size="small"
            text
            @click="showScheduleForm = !showScheduleForm"
          />
        </div>

        <!-- Schedule form -->
        <div v-if="showScheduleForm" class="schedule-form glassmorphic-inset">
          <h5>New Interview Round</h5>
          <div class="s-field">
            <label>Type / Title</label>
            <InputText v-model="interviewType" placeholder="e.g. Technical System Design" />
          </div>
          <div class="s-field-row">
            <div class="s-field">
              <label>Date</label>
              <input type="date" v-model="interviewDate" class="date-input" />
            </div>
            <div class="s-field">
              <label>Time</label>
              <InputText v-model="interviewTime" placeholder="e.g. 02:00 PM" />
            </div>
          </div>
          <div class="s-field">
            <label>Interviewer</label>
            <InputText v-model="interviewer" placeholder="e.g. Sarah Connor & Dave Miller" />
          </div>
          <Button
            label="Confirm Schedule"
            icon="pi pi-check"
            class="w-full mt-2"
            :loading="scheduling"
            @click="handleScheduleInterview"
          />
        </div>

        <!-- Scheduled List -->
        <div class="interviews-list">
          <div
            v-for="(interview, index) in store.selectedCandidate.interviews"
            :key="index"
            class="interview-card"
          >
            <div class="i-icon"><span class="pi pi-video"></span></div>
            <div class="i-info">
              <strong>{{ interview.title }}</strong>
              <small class="muted-text">with {{ interview.interviewer }}</small>
              <div class="i-time">
                <span class="pi pi-clock"></span> {{ formatDate(interview.date) }} at {{ interview.time }}
              </div>
            </div>
          </div>
          <div v-if="!store.selectedCandidate.interviews?.length" class="empty-state">
            No upcoming interview sessions.
          </div>
        </div>
      </section>

      <!-- 6) Timeline Recruiter notes -->
      <section class="drawer-section">
        <h4>Recruiter Notes Logs</h4>

        <!-- Add note -->
        <div v-if="canAnnotate" class="add-note-box">
          <textarea
            v-model="newNote"
            rows="2"
            placeholder="Log interview feedback, updates, or notes..."
          ></textarea>
          <Button
            label="Log Note"
            icon="pi pi-save"
            severity="secondary"
            size="small"
            :loading="addingNote"
            @click="handleAddNote"
          />
        </div>

        <!-- Notes timeline -->
        <div class="notes-timeline">
          <div v-for="(note, index) in store.selectedCandidate.notes" :key="index" class="note-item">
            <div class="note-meta">
              <strong>{{ note.author }}</strong>
              <small>{{ new Date(note.createdAt).toLocaleDateString() }}</small>
            </div>
            <p class="note-text">{{ note.text }}</p>
          </div>
          <div v-if="!store.selectedCandidate.notes?.length" class="empty-state">
            No notes logged for this candidate.
          </div>
        </div>
      </section>

      </div>

      <!-- Activity -->
      <div v-show="tab === 'activity'" id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" class="tab-panel">
      <!-- 7) Activity -->
      <section class="drawer-section" aria-label="Activity">
        <h4>Activity</h4>
        <ul class="activity-list">
          <li v-for="entry in activity" :key="entry.id">
            <span>{{ entry.summary }}</span>
            <small>
              {{ formatActivityTime(entry.createdAt) }}
              <template v-if="entry.source === 'ai'"> · by AI assistant</template>
            </small>
          </li>
          <li v-if="!activity.length" class="empty-text">No activity recorded yet.</li>
        </ul>
      </section>
      </div>
    </div>
  </Sidebar>
</template>

<style scoped>
.drawer-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar-badge {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--primary-500), var(--accent-color));
  color: white;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 1.2rem;
}

.drawer-header h3 {
  margin: 0;
  font-size: 1.15rem;
  color: #0f172a;
}

.muted-text {
  color: #64748b;
  font-size: 0.84rem;
  margin: 2px 0 0;
}

.drawer-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 30px;
}

.snapshot-card {
  display: flex;
  justify-content: space-around;
  padding: 14px;
  border-radius: 12px;
  text-align: center;
}

.d-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.d-meta .label {
  font-size: 0.76rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.score-pill {
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
  font-weight: 700;
}

.score-pill.high {
  background: rgba(16, 185, 129, 0.15);
  color: #059669;
}

.glassmorphic-inset {
  background: rgba(248, 250, 252, 0.6);
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 12px;
}

.action-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.field-row label {
  font-weight: 600;
  font-size: 0.84rem;
  color: #334155;
}

.status-dropdown {
  width: 140px;
}

.delete-btn {
  font-size: 0.85rem;
}

.drawer-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drawer-section h4 {
  margin: 0;
  font-size: 0.96rem;
  color: #1e293b;
  border-left: 3px solid var(--primary-500);
  padding-left: 8px;
}

.skills-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.skill-chip {
  padding: 4px 10px;
  background: color-mix(in srgb, var(--primary-color) 8%, transparent);
  color: var(--primary-600);
  border: 1px solid color-mix(in srgb, var(--primary-color) 15%, transparent);
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 500;
}

.section-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ai-profiler-section {
  background: color-mix(in srgb, var(--accent-color) 4%, transparent);
  border: 1px dashed color-mix(in srgb, var(--accent-color) 25%, transparent);
  padding: 12px;
  border-radius: 12px;
}

.ai-box {
  padding: 12px;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #1e293b;
  border-left: 3px solid var(--accent-color);
}

.empty-ai-message {
  padding: 8px;
}

.empty-text {
  font-size: 0.85rem;
  color: #64748b;
  font-style: italic;
}

.schedule-form {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.schedule-form h5 {
  margin: 0;
  font-size: 0.86rem;
  color: #475569;
}

.s-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.s-field label {
  font-size: 0.74rem;
  font-weight: 600;
  color: #475569;
}

.s-field-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.date-input {
  padding: 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.88rem;
  color: #334155;
  background: white;
}

.interviews-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.interview-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.i-icon {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
  color: var(--primary-500);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.i-info {
  display: flex;
  flex-direction: column;
  font-size: 0.82rem;
}

.i-info strong {
  color: #334155;
}

.i-time {
  margin-top: 4px;
  color: var(--primary-600);
  font-weight: 600;
  font-size: 0.78rem;
  display: flex;
  align-items: center;
  gap: 4px;
}

.add-note-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.add-note-box textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-family: inherit;
  font-size: 0.85rem;
  resize: vertical;
}

.notes-timeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  max-height: 250px;
  overflow-y: auto;
}

.note-item {
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.82rem;
}

.note-meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.note-meta strong {
  color: #475569;
}

.note-meta small {
  color: #94a3b8;
}

.note-text {
  margin: 0;
  color: #334155;
  line-height: 1.4;
  white-space: pre-wrap;
}

.empty-state {
  font-size: 0.8rem;
  color: #94a3b8;
  text-align: center;
  padding: 10px 0;
  font-style: italic;
}

.own-row { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.own-edit { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.own-edit > :first-child { flex: 1; min-width: 0; }
.activity-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.activity-list li { display: grid; gap: 2px; font-size: 0.9rem; }
.activity-list small { color: #64748b; }

.attach-resume { display: grid; gap: 4px; margin-top: 8px; font-size: 0.85rem; color: #475569; }

.missing-list { margin: 8px 0 0; padding-left: 1.1rem; color: #475569; font-size: 0.88rem; }
.fit-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.fit-score { width: 3.4rem; height: 3.4rem; border-radius: 50%; display: grid; place-items: center; font-size: 1.3rem; font-weight: 800; color: #fff; background: #94a3b8; }
.fit-strong .fit-score { background: #10b981; }
.fit-good .fit-score { background: var(--primary-500); }
.fit-partial .fit-score { background: #f59e0b; }
.fit-weak .fit-score { background: #ef4444; }
.fit-explanation { margin: 0 0 8px; font-size: 0.9rem; color: #334155; }
.fit-factors { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.fit-factor__row { display: flex; justify-content: space-between; font-size: 0.88rem; }
.fit-bar { display: block; height: 6px; border-radius: 999px; background: #e2e8f0; overflow: hidden; margin: 2px 0; }
.fit-bar__fill { display: block; height: 100%; background: var(--primary-500); border-radius: 999px; }
.fit-skills { display: grid; gap: 6px; margin-top: 10px; }
.fit-chip-match { background: #dcfce7; color: #166534; }
.fit-chip-missing { background: #fee2e2; color: #991b1b; }
.fit-warnings { margin: 10px 0 0; padding-left: 1.1rem; color: #92400e; font-size: 0.85rem; }

.app-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.app-item { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px; }
.app-head { display: flex; align-items: center; gap: 8px; }
.app-toggle { all: unset; display: flex; align-items: center; gap: 10px; flex: 1; cursor: pointer; min-width: 0; }
.app-toggle:focus-visible { outline: 2px solid var(--primary-500); border-radius: 6px; }
.app-title { display: grid; min-width: 0; }
.app-stage { padding: 4px 6px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; font: inherit; }
.app-stage-text { text-transform: capitalize; color: #475569; }
.fit-badge { min-width: 2.4rem; height: 2.4rem; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: #fff; background: #94a3b8; }
.fit-badge.fit-strong { background: #10b981; }
.fit-badge.fit-good { background: var(--primary-500); }
.fit-badge.fit-partial { background: #f59e0b; }
.fit-badge.fit-weak { background: #ef4444; }

/* Tabbed layout: one topic at a time, each section a clean card */
.drawer-header { width: 100%; }
.header-copy { min-width: 0; flex: 1; }
.header-copy .muted-text { margin: 2px 0 0; }
.drawer-header .score-pill { margin-left: auto; padding: 4px 12px; font-size: 0.95rem; }

.drawer-body { gap: 16px; }

.drawer-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface-muted);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  position: sticky;
  top: 0;
  z-index: 2;
  overflow-x: auto;
}

.drawer-tab {
  flex: 1 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 0.86rem;
  cursor: pointer;
  white-space: nowrap;
}

.drawer-tab:hover { background: rgba(16, 24, 40, 0.05); }

.drawer-tab.active {
  background: var(--surface-card);
  color: var(--primary-700);
  box-shadow: var(--shadow-card);
}

.tab-badge {
  min-width: 1.25rem;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--primary-100);
  color: var(--primary-700);
  font-size: 0.72rem;
  line-height: 1.25rem;
  text-align: center;
}

.tab-badge.alert { background: var(--danger); color: #fff; }

.tab-panel { display: flex; flex-direction: column; gap: 16px; }

.drawer-section {
  padding: 16px;
  gap: 12px;
  background: var(--surface-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.snapshot-card {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: 12px;
  text-align: left;
  padding: 16px;
}

.action-section {
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.danger-zone { display: flex; justify-content: flex-end; }

.ru-intro { margin: 0 0 12px; color: var(--text-secondary); }
.ru-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.ru-list li { padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); }
.ru-list label { display: flex; gap: 8px; align-items: center; font-weight: 600; }
.ru-values { display: flex; gap: 8px; align-items: center; margin: 6px 0 0 24px; font-size: 0.86rem; flex-wrap: wrap; }
.ru-old { color: var(--text-muted); text-decoration: line-through; overflow-wrap: anywhere; }
.ru-new { color: var(--primary-700); overflow-wrap: anywhere; }
.attach-resume input[type="file"] { font: inherit; font-size: 0.85rem; }
.attach-resume input[type="file"]::file-selector-button { margin-right: 10px; padding: 6px 12px; border: 1px solid var(--primary-color); border-radius: var(--radius-sm); background: var(--surface-card); color: var(--primary-color); font-weight: 600; cursor: pointer; }
</style>
