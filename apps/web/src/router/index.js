import { createRouter, createWebHistory } from "vue-router";
import SignUpForm from "../views/SignUp.vue";
import SignInForm from "../views/SignIn.vue";
import ResetPassword from "../views/ResetPassword.vue";

const routes = [
  { path: "/", component: { template: "" }, name: "Dashboard" },
  { path: "/signup", component: SignUpForm, name: "SignUp", meta: { authLayout: true } },
  { path: "/signin", component: SignInForm, name: "SignIn", meta: { authLayout: true } },
  {
    path: "/resetpassword",
    component: ResetPassword,
    name: "ResetPassword",
    alias: ["/reset", "/reset-password"],
    meta: { authLayout: true }
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

export default router;
