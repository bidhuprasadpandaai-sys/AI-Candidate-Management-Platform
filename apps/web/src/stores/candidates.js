import { defineStore } from "pinia";
import api, { getResolvedApiBaseUrl } from "../services/api";

const defaultModules = [
  {
    id: "overview",
    name: "Overview",
    description: "Shell dashboard and platform health"
  },
  {
    id: "candidates",
    name: "Candidates",
    description: "Pipeline and search experience"
  },
  {
    id: "jobs",
    name: "Jobs",
    description: "Openings and pipeline boards"
  },
  {
    id: "assistant",
    name: "AI Assistant",
    description: "Recruiting copilot workspace"
  },
  {
    id: "analytics",
    name: "Analytics",
    description: "Delivery and adoption insights"
  },
  {
    id: "profile",
    name: "Profile Settings",
    description: "Manage personal account details"
  },
  {
    id: "admin",
    name: "Admin",
    description: "Users, companies and audit log",
    requires: "user:manage"
  }
];

// Counts board loads so stale responses can be ignored (see fetchBoard).
let boardRequest = 0;

export const useCandidateStore = defineStore("candidates", {
  state: () => ({
    candidates: [],
    companies: [],
    // Pipeline board: the applications to one job, each with its stage, the candidate and the fit for this job
    boardJobId: null,
    boardApplications: [],
    boardLoading: false,
    totalRecords: 0,
    currentPage: 1,
    rows: 10,
    sortField: "score",
    sortOrder: -1,
    modules: defaultModules,
    activeModule: "overview",
    dashboard: {
      totalCandidates: 0,
      shortlisted: 0,
      hired: 0,
      averageScore: 0
    },
    loading: false,
    chatLoading: false,
    search: "",
    status: "all",
    usingMemoryStore: true,
    backendReady: false,
    backendMessage: "Checking backend connectivity...",
    apiBaseUrl: getResolvedApiBaseUrl(),
    lastError: "",
    selectedCandidateId: null,
    chatHistory: [
      {
        role: "assistant",
        text: "Hello. Ask me for a hiring summary, top candidates, or who is closest to an offer."
      }
    ]
  }),
  getters: {
    selectedCandidate: (state) => {
      return (
        state.candidates.find((c) => c.id === state.selectedCandidateId) ||
        state.boardApplications.map((application) => application.candidate).find((c) => c.id === state.selectedCandidateId) ||
        null
      );
    }
  },
  actions: {
    setActiveModule(moduleId) {
      this.activeModule = moduleId;
    },
    selectCandidate(candidateId) {
      this.selectedCandidateId = candidateId;
    },
    clearSelection() {
      this.selectedCandidateId = null;
    },
    async initialize() {
      this.loading = true;
      this.lastError = "";

      try {
        await Promise.all([
          this.fetchPlatformShell(),
          this.fetchDashboard(),
          this.fetchCandidates()
        ]);
      } catch (error) {
        console.error("Initialization failed", error);
        this.backendReady = false;
        this.backendMessage =
          "Backend API is offline. Start `yarn dev:api` or `yarn dev`.";
        this.lastError = error.message || "Unable to reach the backend.";
      } finally {
        this.apiBaseUrl = getResolvedApiBaseUrl();
        this.loading = false;
      }
    },
    async fetchPlatformShell() {
      const [{ data: healthData }, { data: modulesData }] = await Promise.all([
        api.get("/health"),
        api.get("/modules")
      ]);

      this.backendReady = healthData.status === "ok";
      this.backendMessage = `Backend API online on port ${healthData.port}.`;
      this.apiBaseUrl = getResolvedApiBaseUrl();

      if (
        Array.isArray(modulesData.modules) &&
        modulesData.modules.length > 0
      ) {
        this.modules = modulesData.modules;
      }

      if (!this.modules.some((module) => module.id === "profile")) {
        this.modules = [
          ...this.modules,
          {
            id: "profile",
            name: "Profile Settings",
            description: "Manage personal account details"
          }
        ];
      }

      if (!this.modules.some((module) => module.id === this.activeModule)) {
        this.activeModule = this.modules[0]?.id || "overview";
      }
    },
    async fetchDashboard() {
      const { data } = await api.get("/dashboard");
      this.dashboard = data.metrics;
      this.usingMemoryStore = data.usingMemoryStore;
    },
    async fetchCandidates() {
      const { data } = await api.get("/candidates", {
        params: {
          search: this.search,
          status: this.status,
          page: this.currentPage,
          limit: this.rows,
          sortField: this.sortField,
          sortOrder: this.sortOrder
        }
      });

      this.candidates = data.candidates;
      this.totalRecords = data.total ?? data.candidates.length;
      this.usingMemoryStore = data.usingMemoryStore;
    },
    async applyFilters() {
      this.loading = true;
      try {
        await Promise.all([
          this.fetchDashboard(),
          this.fetchCandidates(),
          ...(this.boardJobId ? [this.fetchBoard(this.boardJobId)] : [])
        ]);
      } catch (error) {
        console.error("Filtering failed", error);
        this.lastError = error.message || "Unable to refresh candidate data.";
      } finally {
        this.apiBaseUrl = getResolvedApiBaseUrl();
        this.loading = false;
      }
    },
    async createCandidate(candidateData) {
      this.loading = true;
      try {
        await api.post("/candidates", candidateData);
        await this.applyFilters();
      } catch (error) {
        console.error("Create candidate failed", error);
        this.lastError = error.message || "Unable to add new candidate.";
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async updateCandidate(candidateId, updateData) {
      this.loading = true;
      try {
        await api.put(`/candidates/${candidateId}`, updateData);
        await this.applyFilters();
      } catch (error) {
        console.error("Update candidate failed", error);
        this.lastError = error.message || "Unable to update candidate details.";
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async deleteCandidate(candidateId) {
      this.loading = true;
      try {
        await api.delete(`/candidates/${candidateId}`);
        if (this.selectedCandidateId === candidateId) {
          this.clearSelection();
        }
        await this.applyFilters();
      } catch (error) {
        console.error("Delete candidate failed", error);
        this.lastError = error.message || "Unable to delete candidate.";
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async addNoteToCandidate(candidateId, noteText) {
      const candidate = this.candidates.find((c) => c.id === candidateId);
      if (!candidate) return;

      const newNotes = [
        ...(candidate.notes || []),
        {
          author: "Recruiter",
          text: noteText,
          createdAt: new Date().toISOString()
        }
      ];

      await this.updateCandidate(candidateId, { notes: newNotes });
    },
    async scheduleInterview(candidateId, interviewData) {
      const candidate = this.candidates.find((c) => c.id === candidateId);
      if (!candidate) return;

      const newInterviews = [...(candidate.interviews || []), interviewData];
      await this.updateCandidate(candidateId, { interviews: newInterviews });
    },
    async assignCandidate(candidateId, assignment) {
      this.loading = true;
      try {
        await api.put(`/candidates/${candidateId}/assignment`, assignment);
        await this.applyFilters();
      } catch (error) {
        console.error("Assign candidate failed", error);
        this.lastError = error.response?.data?.message || error.message || "Unable to change ownership.";
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async fetchCandidateActivity(candidateId) {
      const { data } = await api.get(`/candidates/${candidateId}/audit`, { params: { limit: 20 } });
      return data.entries;
    },
    // Loads one job's applications. Only the newest request may update the board, so a slow earlier
    // response (or one that started before a move) can never overwrite newer data.
    async fetchBoard(jobId, { silent = false } = {}) {
      this.boardJobId = jobId;
      boardRequest += 1;
      const mine = boardRequest;
      if (!silent) this.boardLoading = true;
      try {
        const { data } = await api.get(`/jobs/${jobId}/applications`);
        if (mine === boardRequest) this.boardApplications = data.applications;
      } finally {
        if (mine === boardRequest) this.boardLoading = false;
      }
    },
    // Moves one application to another column. Updates the board at once and puts it back if the server refuses.
    async moveApplication(applicationId, status) {
      const card = this.boardApplications.find((a) => a.id === applicationId);
      if (!card || card.status === status) return;
      const previous = { status: card.status, stage: card.stage };
      boardRequest += 1; // any board load still in flight is now out of date
      card.status = status;
      card.stage = `${status.charAt(0).toUpperCase()}${status.slice(1)} stage`;
      try {
        await api.patch(`/applications/${applicationId}`, { status });
        await Promise.all([this.fetchDashboard(), this.fetchCandidates(), this.fetchBoard(this.boardJobId, { silent: true })]);
      } catch (error) {
        Object.assign(card, previous);
        this.lastError = error.response?.data?.error || error.message || "Unable to move the candidate.";
        throw error;
      }
    },
    // A candidate's applications with the full job fit for each
    async fetchApplications(candidateId) {
      const { data } = await api.get(`/candidates/${candidateId}/applications`);
      return data.applications;
    },
    async applyToJob(candidateId, jobId) {
      await api.post(`/candidates/${candidateId}/applications`, { jobId });
      await this.applyFilters();
    },
    async removeApplication(applicationId) {
      await api.delete(`/applications/${applicationId}`);
      await this.applyFilters();
    },
    async moveCandidateApplication(applicationId, status) {
      await api.patch(`/applications/${applicationId}`, { status });
      await this.applyFilters();
    },
    async fetchCompanies() {
      const { data } = await api.get("/companies");
      this.companies = data.companies;
      return data.companies;
    },
    async seedData() {
      this.loading = true;
      try {
        await api.post("/seed");
        await this.initialize();
      } catch (error) {
        console.error("Seeding failed", error);
        this.lastError = error.message || "Unable to seed the backend data.";
      } finally {
        this.apiBaseUrl = getResolvedApiBaseUrl();
        this.loading = false;
      }
    },
    async sendMessage(message) {
      const trimmedMessage = message.trim();
      if (!trimmedMessage) {
        return;
      }

      this.chatHistory.push({ role: "user", text: trimmedMessage });
      this.chatLoading = true;

      try {
        const { data } = await api.post("/chat", { message: trimmedMessage });
        this.chatHistory.push({ role: "assistant", text: data.reply });
        this.backendReady = true;
        this.backendMessage = "AI assistant is connected to the backend API.";

        // If a database command was executed by the AI agent, refresh all statistics/lists
        if (data.actionExecuted) {
          await this.applyFilters();
        }
      } catch (error) {
        console.error("Chat request failed", error);
        this.backendReady = false;
        this.lastError =
          error.message || "Unable to reach the AI assistant endpoint.";
        this.chatHistory.push({
          role: "assistant",
          text: "The API is currently unavailable. Start the backend server and try again."
        });
      } finally {
        this.apiBaseUrl = getResolvedApiBaseUrl();
        this.chatLoading = false;
      }
    }
  }
});
