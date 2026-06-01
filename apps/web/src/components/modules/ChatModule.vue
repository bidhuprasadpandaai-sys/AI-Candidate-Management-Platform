<script setup>
import { ChatPanel } from "@acmp/chat";
import { useCandidateStore } from "../../stores/candidates";

const store = useCandidateStore();
</script>

<template>
  <section class="content-grid">
    <ChatPanel :candidates="store.candidates" :api-base="store.apiBaseUrl" />
  </section>
</template>
