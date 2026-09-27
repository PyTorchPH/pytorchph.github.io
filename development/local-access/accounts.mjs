export const localAccounts = Object.freeze({
  member: Object.freeze({
    userId: "00000000-0000-4000-8000-000000000001",
    email: "demo.member@example.org",
    password: "demo-password",
    role: "member",
    isOfficer: false,
    origin: "http://members.ph.localhost:3100",
  }),
  officer: Object.freeze({
    userId: "00000000-0000-4000-8000-000000000101",
    email: "demo.officer@example.org",
    password: "demo-password",
    role: "admin",
    isOfficer: true,
    origin: "http://officers.ph.localhost:3100",
  }),
});
