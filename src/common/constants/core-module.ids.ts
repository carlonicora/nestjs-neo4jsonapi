/**
 * Permission section ids for the library's own controllers (`@ModuleACL`).
 *
 * The first eight are the ids the apps already seed (same values as the
 * `ModuleId` enum in `foundations/module/enums/module.id.ts`, plus HowTo).
 * The rest were generated once for the permission gate.
 *
 * NEVER change a value: apps seed `(Module)` nodes and grants against them.
 * An app that switches `permissions.enforce` on must seed a `(Module)` node
 * for every id its mounted controllers reference, or the boot audit refuses
 * to start.
 */
export const CoreModuleId = {
  Auth: "035fe8a6-d467-40c0-9d1d-6a87f0dd286e",
  Company: "f9e77c8f-bfd1-4fd4-80b0-e1d891ab7113",
  Feature: "025fdd23-2803-4360-9fd9-eaa3612c2e23",
  HowTo: "6f975207-0df3-4c0d-b541-ed5dc04487b2",
  Notification: "9259d704-c670-4e77-a3a1-a728ffc5be3d",
  Role: "9f6416e6-7b9b-4e1a-a99f-833191eca8a9",
  S3: "db41ba46-e171-4324-8845-99353eba8568",
  User: "04cfc677-0fd2-4f5e-adf4-2483a00c0277",
  Assistant: "1d30b63e-c5e9-46a4-b26e-91ad397c75af",
  Billing: "8db0b573-9ba3-48c9-8a2d-6f093d339048",
  Analytics: "a057a946-f835-4b7e-bf11-226308d230b5",
  Waitlist: "ceed89c9-54ee-4168-9a41-045ccabbe822",
  EmailAutomation: "ac29ede6-6c80-4e99-9e88-732cc3efb946",
  TokenUsage: "15fba3d5-4637-4fa4-8d30-b33227ddba43",
  AiConnection: "73960c40-4501-4aae-a3f1-c187b6a6af8c",
  Audit: "445cf50b-2a5c-4c73-83a1-2f23e9989a59",
  Push: "b7abe58f-908d-4fb7-893e-9584dff17c70",
  Referral: "d792daf3-2296-46ae-9408-daf9c122029a",
  Content: "bd6d9360-c816-4e8a-aabe-d5ca03408067",
  Chunk: "3b60a9ff-e511-4683-9411-f1a11a80b498",
  KeyConcept: "f69f5384-d4aa-4001-920d-95d8fa572198",
  Handbook: "7b04d088-3512-4554-852a-c26804e618ec",
  OAuthClient: "f7812e20-16d6-44a0-bcd5-2b47a44808e9",
} as const;

export type CoreModuleIdKey = keyof typeof CoreModuleId;
