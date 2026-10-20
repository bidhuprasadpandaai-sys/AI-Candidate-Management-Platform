import { defineStore } from "pinia";
import api from "../services/api";

// Job openings. The pipeline board itself lives in the candidates store (it shares the detail panel).
export const useJobsStore = defineStore("jobs", {
  state: () => ({
    jobs: [],
    hiringManagers: [],
    loading: false
  }),
  getters: {
    openJobs: (state) => state.jobs.filter((job) => job.status === "open"),
    jobById: (state) => (id) => state.jobs.find((job) => job.id === id) || null
  },
  actions: {
    async fetchJobs() {
      this.loading = true;
      try {
        const { data } = await api.get("/jobs");
        this.jobs = data.jobs;
      } finally {
        this.loading = false;
      }
    },
    // People who can be named hiring manager for a company (admins pass the company).
    async fetchHiringManagers(companyId) {
      const { data } = await api.get("/jobs/hiring-managers", { params: companyId ? { companyId } : {} });
      this.hiringManagers = data.users;
      return data.users;
    },
    async saveJob(id, payload) {
      const { data } = id ? await api.patch(`/jobs/${id}`, payload) : await api.post("/jobs", payload);
      await this.fetchJobs();
      return data.job;
    },
    async deleteJob(id) {
      await api.delete(`/jobs/${id}`);
      await this.fetchJobs();
    }
  }
});
