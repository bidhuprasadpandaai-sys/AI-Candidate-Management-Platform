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
  jobs: defineAsyncComponent(
    () => import("../components/modules/JobsModule.vue")
  ),
  assistant: defineAsyncComponent(
    () => import("../components/modules/AssistantModule.vue")
  ),
  analytics: defineAsyncComponent(
    () => import("../components/modules/AnalyticsModule.vue")
  ),
  admin: defineAsyncComponent(
    () => import("../components/modules/AdminModule.vue")
  ),
  profile: defineAsyncComponent(
    () => import("../components/modules/ProfileModule.vue")
  )
};
