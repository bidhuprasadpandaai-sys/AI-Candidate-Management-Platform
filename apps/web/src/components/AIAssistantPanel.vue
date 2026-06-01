<script setup>
import { ref } from "vue";
import Button from "primevue/button";
import InputTextarea from "primevue/textarea";
import { useCandidateStore } from "../stores/candidates";

const store = useCandidateStore();
const message = ref("");

const sendMessage = async () => {
  await store.sendMessage(message.value);
  message.value = "";
};
</script>

<template>
  <section class="panel-card">
    <div class="panel-heading">
      <div>
        <h3>AI recruiting assistant</h3>
        <p class="muted">
          Use natural language prompts to review the pipeline.
        </p>
      </div>
    </div>

    <div class="chat-feed">
      <div
        v-for="entry in store.chatHistory"
        :key="`${entry.role}-${entry.text}`"
        class="chat-message"
        :class="entry.role"
      >
        <strong>{{ entry.role === "assistant" ? "AI" : "You" }}:</strong>
        <div>{{ entry.text }}</div>
      </div>
    </div>

    <div class="chat-form">
      <InputTextarea
        v-model="message"
        rows="4"
        auto-resize
        placeholder="Ask for a dashboard summary or top candidates"
        @keydown.enter.exact.prevent="sendMessage"
      />
      <Button
        label="Send"
        icon="pi pi-send"
        :loading="store.chatLoading"
        @click="sendMessage"
      />
    </div>
  </section>
</template>
