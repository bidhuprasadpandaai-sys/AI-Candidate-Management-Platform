<script setup>
import Message from "primevue/message";
import DashboardCards from "../DashboardCards.vue";
import { useCandidateStore } from "../../stores/candidates";

const store = useCandidateStore();
</script>

<template>
  <section class="content-grid">
    <section class="intro-card">
      <div>
        <p class="eyebrow">Microfrontend host</p>
        <h2>Compose recruiting experiences from isolated UI modules.</h2>
        <p class="intro-copy">
          The platform shell now lazy-loads Overview, Candidates, AI Assistant,
          and Analytics as independent modules so they can evolve into remote
          microfrontends later.
        </p>
      </div>

      <div class="module-meta-grid">
        <article class="mini-stat">
          <span class="label">Active modules</span>
          <strong class="value">{{ store.modules.length }}</strong>
        </article>
        <article class="mini-stat">
          <span class="label">Backend state</span>
          <strong class="value">{{
            store.backendReady ? "Online" : "Offline"
          }}</strong>
        </article>
        <article class="mini-stat">
          <span class="label">Data source</span>
          <strong class="value">{{
            store.usingMemoryStore ? "Demo" : "MongoDB"
          }}</strong>
        </article>
      </div>
    </section>

    <DashboardCards />

    <Message severity="info" :closable="false">
      The shell registry currently loads local Vue modules asynchronously. You
      can later swap each module for a remote federated build without changing
      the page layout.
    </Message>
  </section>
</template>
