import { defineAsyncComponent } from "vue";

export const microfrontendRegistry = {
  overview: defineAsyncComponent(
    () => import("../components/modules/OverviewModule.vue")
  ),
  chat: defineAsyncComponent(
    () => import("../components/modules/ChatModule.vue")
  ),
  candidates: defineAsyncComponent(
    () => import("../components/modules/CandidatesModule.vue")
  ),
  assistant: defineAsyncComponent(
    () => import("../components/modules/AssistantModule.vue")
  ),
  analytics: defineAsyncComponent(
    () => import("../components/modules/AnalyticsModule.vue")
  ),
  profile: defineAsyncComponent(
    () => import("../components/modules/ProfileModule.vue")
  )
};
