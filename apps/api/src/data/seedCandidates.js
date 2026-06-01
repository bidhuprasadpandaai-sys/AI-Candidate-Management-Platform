export const seedCandidates = [
  {
    name: "Ava Thompson",
    email: "ava.thompson@example.com",
    role: "Senior Frontend Engineer",
    status: "interview",
    score: 92,
    stage: "Technical interview",
    location: "Berlin, DE",
    experienceYears: 7,
    skills: ["Vue 3", "TypeScript", "Design Systems"],
    summary: "Strong UI architecture experience with enterprise dashboards.",
    notes: [
      {
        author: "Sarah Connor (HR)",
        text: "Initial screening call went exceptionally well. Very articulate and clear understanding of modern reactive architectures.",
        createdAt: new Date("2026-05-20T10:00:00Z")
      },
      {
        author: "David Miller (Tech Lead)",
        text: "Outstanding code review challenge. Clean components, perfect TypeScript typings, and highly optimized Vue rendering.",
        createdAt: new Date("2026-05-25T14:30:00Z")
      }
    ],
    interviews: [
      {
        title: "System Design Interview",
        date: "2026-05-29",
        time: "02:00 PM",
        interviewer: "David Miller (Principal Engineer)",
        type: "Technical"
      }
    ]
  },
  {
    name: "Liam Carter",
    email: "liam.carter@example.com",
    role: "AI Product Manager",
    status: "offer",
    score: 89,
    stage: "Offer review",
    location: "London, UK",
    experienceYears: 8,
    skills: ["AI Strategy", "Analytics", "Stakeholder Management"],
    summary: "Led AI roadmap delivery across recruiting and HR products.",
    notes: [
      {
        author: "Sarah Connor (HR)",
        text: "Verbal offer extended. Candidate was enthusiastic about our AI vision but requested a minor revision on the stock options split.",
        createdAt: new Date("2026-05-26T09:15:00Z")
      }
    ],
    interviews: []
  },
  {
    name: "Sophia Nguyen",
    email: "sophia.nguyen@example.com",
    role: "Backend Engineer",
    status: "screening",
    score: 84,
    stage: "CV review",
    location: "Toronto, CA",
    experienceYears: 5,
    skills: ["Node.js", "MongoDB", "System Design"],
    summary: "Focused on scalable API design and data platforms.",
    notes: [
      {
        author: "Recruiter Admin",
        text: "CV passed initial keyword screen. Experience with microservices matches requirements. Needs a screening call.",
        createdAt: new Date("2026-05-27T08:00:00Z")
      }
    ],
    interviews: [
      {
        title: "HR Screening Call",
        date: "2026-05-29",
        time: "10:30 AM",
        interviewer: "Sarah Connor (HR Manager)",
        type: "HR Screening"
      }
    ]
  },
  {
    name: "Noah Patel",
    email: "noah.patel@example.com",
    role: "ML Engineer",
    status: "hired",
    score: 95,
    stage: "Onboarding",
    location: "Bengaluru, IN",
    experienceYears: 6,
    skills: ["Python", "MLOps", "LLM Evaluation"],
    summary: "Built production-grade AI ranking and recommendation services.",
    notes: [
      {
        author: "Recruiter Admin",
        text: "Background check complete. Reference letters received. Highly positive remarks from previous team leads.",
        createdAt: new Date("2026-05-18T11:00:00Z")
      },
      {
        author: "Sarah Connor (HR)",
        text: "Contract signed! Hardware preferences logged (Macbook Pro 16). Welcome pack has been dispatched.",
        createdAt: new Date("2026-05-24T16:00:00Z")
      }
    ],
    interviews: []
  },
  {
    name: "Emma Rodriguez",
    email: "emma.rodriguez@example.com",
    role: "UX Researcher",
    status: "interview",
    score: 87,
    stage: "Panel interview",
    location: "Austin, US",
    experienceYears: 4,
    skills: ["Research Ops", "Journey Mapping", "Figma"],
    summary: "Specializes in candidate journey and recruiter workflow studies.",
    notes: [
      {
        author: "Sarah Connor (HR)",
        text: "Very strong portfolio review. High empathy and clear user-centered methodology outlined.",
        createdAt: new Date("2026-05-22T13:00:00Z")
      }
    ],
    interviews: [
      {
        title: "Recruiting Panel Interview",
        date: "2026-06-01",
        time: "04:00 PM",
        interviewer: "Sarah, David, & Liam",
        type: "Panel Review"
      }
    ]
  },
  {
    name: "Mason Kim",
    email: "mason.kim@example.com",
    role: "Full Stack Engineer",
    status: "rejected",
    score: 70,
    stage: "Final decision",
    location: "Seoul, KR",
    experienceYears: 3,
    skills: ["Vue", "Express", "PostgreSQL"],
    summary: "Solid generalist profile with startup delivery experience.",
    notes: [
      {
        author: "David Miller (Tech Lead)",
        text: "Technical test showed gaps in concurrency and caching principles. Let's pass for now and reconsider for a mid-level role in the future.",
        createdAt: new Date("2026-05-23T15:00:00Z")
      }
    ],
    interviews: []
  }
];
