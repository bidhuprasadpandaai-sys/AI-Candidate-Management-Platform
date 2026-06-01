<script setup>
import { ref, watch } from "vue";
import Button from "primevue/button";
import Dropdown from "primevue/dropdown";
import InputText from "primevue/inputtext";
import Sidebar from "primevue/sidebar";
import { STATUS_SEVERITY } from "@acmp/shared";
import { useCandidateStore } from "../stores/candidates";

const store = useCandidateStore();

const showSidebar = ref(false);

// Watch for store selection changes
watch(
  () => store.selectedCandidateId,
  (newId) => {
    showSidebar.value = !!newId;
    if (newId) {
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
    :style="{ width: '30rem' }"
    @hide="handleClose"
  >
    <template #header>
      <div class="drawer-header" v-if="store.selectedCandidate">
        <div class="avatar-badge">
          {{ getInitials(store.selectedCandidate.name) }}
        </div>
        <div>
          <h3>{{ store.selectedCandidate.name }}</h3>
          <p class="muted-text">{{ store.selectedCandidate.role }}</p>
        </div>
      </div>
    </template>

    <div class="drawer-body" v-if="store.selectedCandidate">
      <!-- 1) Candidate Snapshot -->
      <section class="snapshot-card glassmorphic-inset">
        <div class="d-meta">
          <span class="label">Location</span>
          <strong>{{ store.selectedCandidate.location }}</strong>
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
          />
        </div>
        <Button
          label="Delete Candidate"
          icon="pi pi-trash"
          severity="danger"
          text
          class="delete-btn"
          @click="handleDelete"
        />
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

      <!-- 5) Interview Scheduling -->
      <section class="drawer-section">
        <div class="section-title-row">
          <h4>Scheduled Interviews</h4>
          <Button
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
        <div class="add-note-box">
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
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
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
  border-left: 3px solid #3b82f6;
  padding-left: 8px;
}

.skills-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.skill-chip {
  padding: 4px 10px;
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
  border: 1px solid rgba(59, 130, 246, 0.15);
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
  background: rgba(139, 92, 246, 0.04);
  border: 1px dashed rgba(139, 92, 246, 0.25);
  padding: 12px;
  border-radius: 12px;
}

.ai-box {
  padding: 12px;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #1e293b;
  border-left: 3px solid #8b5cf6;
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
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
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
  color: #2563eb;
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
</style>
