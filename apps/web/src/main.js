import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import App from "./App.vue";
import "primevue/resources/themes/lara-light-blue/theme.css";
import "primevue/resources/primevue.min.css";
import "primeicons/primeicons.css";
import "./styles.css";
import router from "./router"; // <-- added router import

const app = createApp(App);
app.use(createPinia());
app.use(PrimeVue);
app.use(router); // <-- register router
app.mount("#app");
