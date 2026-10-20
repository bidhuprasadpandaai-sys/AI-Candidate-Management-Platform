import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ProfileMeter from "../components/ProfileMeter.vue";

const full = {
  name: "Jane Doe", email: "jane@example.com", phone: "+14155550123", role: "Engineer", location: "Austin, TX",
  experienceYears: 6, skills: ["Node.js", "AWS", "Docker"], summary: "Backend engineer who builds reliable APIs for fast growing teams.", resumeId: "r1"
};

describe("ProfileMeter", () => {
  it("shows 100% and no missing items for a complete profile", () => {
    const wrapper = mount(ProfileMeter, { props: { candidate: full } });
    expect(wrapper.find('[data-test="profile-score"]').text()).toBe("100%");
    expect(wrapper.attributes("title")).toBe("Profile complete");
    expect(wrapper.text()).toContain("Complete");
    const bar = wrapper.find('[role="progressbar"]');
    expect(bar.attributes("aria-valuenow")).toBe("100");
    expect(wrapper.find(".profile-meter__fill").attributes("style")).toContain("width: 100%");
    expect(wrapper.classes()).toContain("level-complete");
  });

  it("shows the percentage and lists what is missing in the tooltip", () => {
    const wrapper = mount(ProfileMeter, { props: { candidate: { name: "A B", email: "a@b.co", role: "Dev" } } });
    expect(wrapper.find('[data-test="profile-score"]').text()).toBe("30%");
    expect(wrapper.attributes("title")).toMatch(/^Missing: phone number, location, years of experience, skills/);
    expect(wrapper.classes()).toContain("level-started");
  });

  it("uses level colours and updates when the candidate changes", async () => {
    const wrapper = mount(ProfileMeter, { props: { candidate: { ...full, phone: "", resumeId: null } } });
    expect(wrapper.classes()).toContain("level-good");
    await wrapper.setProps({ candidate: { ...full, phone: "", resumeId: null, summary: "", skills: [] } });
    expect(wrapper.classes()).toContain("level-partial");
    await wrapper.setProps({ candidate: {} });
    expect(wrapper.find('[data-test="profile-score"]').text()).toBe("0%");
  });

  it("compact mode hides the level word", () => {
    const wrapper = mount(ProfileMeter, { props: { candidate: full, compact: true } });
    expect(wrapper.classes()).toContain("compact");
    expect(wrapper.find(".profile-meter__level").exists()).toBe(false);
  });
});
