/**
 * Outreach settings (owner 2026-11-24, from the 23 Nov HR meeting): the job application form's questions, the message
 * templates for bulk WhatsApp and email, and the automatic outreach when a hiring request is approved. All three are
 * HR's to change in Recruitment → Outreach, never in code; they are kept in organization_settings.recruitment_config
 * under `outreach`. This file is pure (no database): parsing, defaults, validation and filling in the placeholders.
 */
import { z } from "zod";

// The job application form ----------------------------------------------------------------------------------------------

export const APPLICATION_FIELD_TYPES = ["text", "textarea", "number", "email", "phone", "select", "date", "file"] as const;
export type ApplicationFieldType = (typeof APPLICATION_FIELD_TYPES)[number];

/** Where an answer goes on the candidate's record ("" = kept with the application only). */
export const APPLICATION_TARGETS = {
  fullName: "Full name",
  email: "Email",
  phone: "Mobile number",
  location: "Current city",
  preferredLocations: "Preferred locations",
  currentOrganization: "Current company",
  currentDesignation: "Current designation",
  totalExpYears: "Total experience (years)",
  relevantExpYears: "Relevant experience (years)",
  noticePeriodDays: "Notice period (days)",
  currentInhand: "Current in-hand salary (₹ / month)",
  expectedInhand: "Expected in-hand salary (₹ / month)",
  skills: "Key skills",
  ugQualification: "Graduation",
  pgQualification: "Post-graduation",
  institute: "Institute",
  industry: "Industry",
  resume: "Resume file",
} as const;
export type ApplicationTarget = keyof typeof APPLICATION_TARGETS;
/** Every form has these three, so an application always reaches a person (matched by email, then mobile). */
export const REQUIRED_TARGETS: readonly ApplicationTarget[] = ["fullName", "email", "phone"];

export interface ApplicationField {
  id: string;
  label: string;
  type: ApplicationFieldType;
  required: boolean;
  help?: string;
  /** For "select". */
  options?: string[];
  target?: ApplicationTarget | null;
}
export interface ApplicationFormConfig {
  title: string;
  intro: string;
  fields: ApplicationField[];
  consentText: string;
  thanks: string;
}

/** The standard form, as HR's Google Form asked it (23 Nov meeting); HR edits it from here. */
export const DEFAULT_APPLICATION_FORM: ApplicationFormConfig = {
  title: "Job application",
  intro: "Thank you for your interest in working with us. It takes about three minutes.",
  fields: [
    { id: "full_name", label: "Full name", type: "text", required: true, target: "fullName" },
    { id: "email", label: "Email", type: "email", required: true, target: "email" },
    { id: "phone", label: "Mobile number", type: "phone", required: true, target: "phone" },
    { id: "city", label: "Current city", type: "text", required: true, target: "location" },
    { id: "preferred_locations", label: "Locations you can work from", type: "text", required: false, help: "Separate them with commas", target: "preferredLocations" },
    { id: "company", label: "Current company", type: "text", required: false, target: "currentOrganization" },
    { id: "designation", label: "Current designation", type: "text", required: false, target: "currentDesignation" },
    { id: "total_exp", label: "Total experience (years)", type: "number", required: true, target: "totalExpYears" },
    { id: "relevant_exp", label: "Relevant experience (years)", type: "number", required: false, target: "relevantExpYears" },
    { id: "current_salary", label: "Current in-hand salary (₹ per month)", type: "number", required: false, target: "currentInhand" },
    { id: "expected_salary", label: "Expected in-hand salary (₹ per month)", type: "number", required: true, target: "expectedInhand" },
    { id: "notice", label: "Notice period (days)", type: "number", required: true, help: "0 if you can join now", target: "noticePeriodDays" },
    { id: "qualification", label: "Highest qualification", type: "text", required: false, target: "ugQualification" },
    { id: "skills", label: "Key skills", type: "text", required: false, help: "Separate them with commas", target: "skills" },
    { id: "linkedin", label: "LinkedIn profile", type: "text", required: false, target: null },
    { id: "reason", label: "Why are you looking for a change?", type: "textarea", required: false, target: null },
    { id: "resume", label: "Resume", type: "file", required: true, help: "PDF or Word, up to 4 MB", target: "resume" },
  ],
  consentText: "I agree that Autopilot Offices may keep these details to consider me for this and future roles, and contact me about them. I can ask for them to be removed at any time.",
  thanks: "Thank you. Your application has reached our recruitment team; we will be in touch if your profile fits.",
};

// The message templates ----------------------------------------------------------------------------------------------

export const PLACEHOLDERS = {
  first_name: "The candidate's first name",
  full_name: "The candidate's full name",
  role: "The role (the position's title)",
  location: "The role's location",
  company: "Your company's name",
  company_profile: "The link to your company profile (Outreach → Automatic)",
  application_link: "The candidate's own link to the job application form",
  recruiter_name: "The name of the person sending",
  screening_link: "The candidate's own link to the screening questions",
  round: "The interview round (e.g. L1)",
  interview_time: "When the interview is (e.g. Fri, 28 Nov 2026 at 11:00 am (IST))",
  interview_page: "The interview's page: the job, the company profile, the guidelines, how to join, and Yes / No",
  guidelines: "The interview guidelines, on one line",
  assignment_title: "The assignment's title",
  due_date: "When the assignment is due (e.g. Mon, 1 Dec 2026 at 6:00 pm (IST))",
  assignment_link: "The candidate's own link to the assignment (the brief, the files, and where to submit)",
  documents_link: "The candidate's own link to upload their documents",
  loi_link: "The candidate's own link to the letter of intent (the salary breakup, Accept / Decline)",
} as const;
export type Placeholder = keyof typeof PLACEHOLDERS;

export interface OutreachTemplate {
  id: string;
  name: string;
  channel: "whatsapp" | "email";
  /** WhatsApp: the AiSensy campaign of the Meta-approved template. */
  campaign?: string;
  /** WhatsApp: the template's {{1}}, {{2}}, … in order. */
  params?: Placeholder[];
  /** Email: the subject, with placeholders. */
  subject?: string;
  /** Email: the text sent. WhatsApp: what the approved template says (the preview), with placeholders. */
  body: string;
}

const BASE_TEMPLATES: OutreachTemplate[] = [
  {
    id: "wa_job_opening",
    name: "Job opening, with the application form",
    channel: "whatsapp",
    campaign: "hr_candidate_job_opening_v1",
    params: ["first_name", "role", "location", "application_link"],
    body: "Hello {{first_name}},\n\nWe at Autopilot Offices found your profile a good fit for the {{role}} role in {{location}}.\n\nIf you are interested, please apply here: {{application_link}}\n\nAutopilot Offices Recruitment Team",
  },
  {
    id: "email_job_opening",
    name: "Job opening, with the application form",
    channel: "email",
    subject: "{{role}} at {{company}}, {{location}}",
    body: "Hello {{first_name}},\n\nWe came across your profile and think you could be a good fit for the {{role}} role at {{company}} in {{location}}.\n\nIf you are interested, please fill in this short application form (about three minutes): {{application_link}}\n\nWe look forward to hearing from you.\n\nRegards,\n{{recruiter_name}}\n{{company}} Recruitment Team",
  },
];

/** Owner 2026-11-24: the screening, interview and rejection templates (added to saved settings that predate them). */
export const FLOW_TEMPLATES: OutreachTemplate[] = [
  {
    id: "wa_screening",
    name: "Screening questions",
    channel: "whatsapp",
    campaign: "hr_candidate_screening_v1",
    params: ["first_name", "recruiter_name", "company", "role", "location", "screening_link"],
    body: "Hello {{first_name}},\n\nThis is {{recruiter_name}} from the {{company}} HR team. We have considered your profile for the {{role}} role in {{location}}.\n\nIf you are interested, please answer a few quick questions here: {{screening_link}}\n\nWe will also call you shortly.",
  },
  {
    id: "wa_interview_invite",
    name: "Interview invite",
    channel: "whatsapp",
    campaign: "hr_candidate_interview_invite_v1",
    params: ["first_name", "round", "role", "company", "interview_time", "interview_page"],
    body: "Hello {{first_name}},\n\nYour {{round}} interview for the {{role}} role at {{company}} is on {{interview_time}}.\n\nThe job description, our company profile, the interview guidelines and how to join are here: {{interview_page}}\n\nPlease confirm on the same page that you will attend.",
  },
  {
    id: "wa_interview_reminder",
    name: "Interview reminder",
    channel: "whatsapp",
    campaign: "hr_candidate_interview_reminder_v1",
    params: ["first_name", "round", "interview_time", "guidelines", "interview_page"],
    body: "Hello {{first_name}},\n\nA reminder of your {{round}} interview on {{interview_time}}.\n\n{{guidelines}}\n\nPlease confirm you will attend: {{interview_page}}",
  },
  {
    id: "email_rejection",
    name: "Soft rejection",
    channel: "email",
    subject: "Your application for {{role}} at {{company}}",
    body: "Dear {{first_name}},\n\nThank you for your interest in the {{role}} role at {{company}}, and for the time you gave us.\n\nAfter careful consideration, we will not be moving forward with your application for this position. It was not an easy decision.\n\nWe will keep your profile with us and reach out if a role that suits you opens up.\n\nWe wish you the very best.\n\nWarm regards,\n{{recruiter_name}}\n{{company}} Recruitment Team",
  },
];
/** Owner 2026-11-24 ("complete all the remaining phases"): the assignment, documents and LOI templates. */
export const OFFER_TEMPLATES: OutreachTemplate[] = [
  {
    id: "wa_assignment",
    name: "Assignment",
    channel: "whatsapp",
    campaign: "hr_candidate_assignment_v1",
    params: ["first_name", "role", "company", "assignment_title", "due_date", "assignment_link"],
    body: "Hello {{first_name}},\n\nThank you for your time so far on the {{role}} role at {{company}}. The next step is an assignment: {{assignment_title}}.\n\nPlease submit it by {{due_date}}. The brief, the files and where to submit are here: {{assignment_link}}",
  },
  {
    id: "wa_documents",
    name: "Documents to upload",
    channel: "whatsapp",
    campaign: "hr_candidate_documents_v1",
    params: ["first_name", "role", "company", "documents_link"],
    body: "Hello {{first_name}},\n\nCongratulations on being selected for the {{role}} role at {{company}}.\n\nTo prepare your offer, please upload your documents (such as your latest salary slips) here: {{documents_link}}",
  },
  {
    id: "wa_loi",
    name: "Letter of intent",
    channel: "whatsapp",
    campaign: "hr_candidate_loi_v1",
    params: ["first_name", "role", "company", "loi_link"],
    body: "Hello {{first_name}},\n\nYour letter of intent for the {{role}} role at {{company}}, with your salary breakup, is ready.\n\nPlease read it and accept or decline here: {{loi_link}}",
  },
];

export const DEFAULT_TEMPLATES: OutreachTemplate[] = [...BASE_TEMPLATES, ...FLOW_TEMPLATES, ...OFFER_TEMPLATES];

// Assignments, documents and offers (owner 2026-11-24) ---------------------------------------------------------------------

/** One ready-made assignment (meeting: "standard assignment templates per department"). */
export interface AssignmentTemplate { id: string; name: string; department: string; title: string; brief: string; guidelines: string; driveLink: string; dueDays: number }
export interface AssignmentConfig { whatsappTemplateId: string; defaultDueDays: number; library: AssignmentTemplate[] }
export const DEFAULT_ASSIGNMENT: AssignmentConfig = {
  whatsappTemplateId: "wa_assignment",
  defaultDueDays: 3,
  library: [],
};

export interface DocumentsConfig { whatsappTemplateId: string; items: string[] }
export const DEFAULT_DOCUMENTS: DocumentsConfig = {
  whatsappTemplateId: "wa_documents",
  items: ["Last 3 months' salary slips", "Current offer or appointment letter", "Latest bank statement showing salary credit (optional)", "PAN card", "Aadhaar card"],
};

/** The salary breakup's rows (₹ per month, except benefits per year) and who approves the annexure. */
export interface OfferConfig {
  /** The hiring manager (who raised the request) approves the annexure first (meeting: "annexure approval by management"). */
  hiringManagerApproves: boolean;
  /** The Director approves every annexure, not only those above the band. */
  directorAlways: boolean;
  loiTemplateId: string;
  earnings: string[];
  deductions: string[];
  benefits: string[];
}
export const DEFAULT_OFFER: OfferConfig = {
  hiringManagerApproves: true,
  directorAlways: true,
  loiTemplateId: "wa_loi",
  earnings: ["Basic", "HRA", "Special allowance", "Conveyance", "Other allowances"],
  deductions: ["Employee PF", "Professional tax", "TDS (estimated)"],
  benefits: ["Employer PF", "Gratuity", "Medical insurance", "Performance bonus"],
};

// Screening and interviews (owner 2026-11-24) -----------------------------------------------------------------------------

/** "When a candidate moves to screening, a WhatsApp message with the screening questions should go out" (23 Nov meeting). */
export interface ScreeningConfig {
  enabled: boolean;
  /** The pipeline stage that sends the questions. */
  stageKey: string;
  /** Where people go when they do not answer in time ("" = stay where they are). */
  noResponseStageKey: string;
  whatsappTemplateId: string;
  /** No answer this long after the questions went: "No response" (chasers go at 24 h and 48 h). */
  noResponseAfterHours: number;
  intro: string;
  /** The questions (the same kinds as the application form; an answer can fill the record). */
  fields: ApplicationField[];
  /**
   * Owner 2026-11-25: the most questions a candidate is asked, the standard ones included, when a position has its own
   * (drafted by the AI from the JD). Candidates answer on a phone; a long form loses them.
   */
  maxQuestions: number;
}
export const DEFAULT_SCREENING: ScreeningConfig = {
  enabled: true,
  stageKey: "screening_pending",
  noResponseStageKey: "not_responding",
  whatsappTemplateId: "wa_screening",
  noResponseAfterHours: 72,
  intro: "A few quick questions before our call. It takes about two minutes.",
  maxQuestions: 25,
  fields: [
    { id: "total_exp", label: "Total experience (years)", type: "number", required: true, target: "totalExpYears" },
    { id: "relevant_exp", label: "Experience relevant to this role (years)", type: "number", required: false, target: "relevantExpYears" },
    { id: "city", label: "Current city", type: "text", required: true, target: "location" },
    { id: "preferred_locations", label: "Locations you can work from", type: "text", required: false, help: "Separate them with commas", target: "preferredLocations" },
    { id: "notice", label: "Notice period (days)", type: "number", required: true, help: "0 if you can join now", target: "noticePeriodDays" },
    { id: "current_salary", label: "Current in-hand salary (₹ per month)", type: "number", required: false, target: "currentInhand" },
    { id: "expected_salary", label: "Expected in-hand salary (₹ per month)", type: "number", required: true, target: "expectedInhand" },
    { id: "reason", label: "Why are you looking for a change?", type: "textarea", required: true, target: null },
  ],
};

export interface InterviewConfig {
  /** The WhatsApp invite and reminder ("" = none on WhatsApp). */
  inviteTemplateId: string;
  reminderTemplateId: string;
  guidelinesOnline: string[];
  guidelinesInPerson: string[];
}
export const DEFAULT_INTERVIEW: InterviewConfig = {
  inviteTemplateId: "wa_interview_invite",
  reminderTemplateId: "wa_interview_reminder",
  guidelinesOnline: [
    "Use earphones",
    "Sit in a quiet place with good light and a steady internet connection",
    "Dress formally",
    "Read the job description and our company profile before the interview",
    "Join 5 minutes early",
  ],
  guidelinesInPerson: [
    "Dress formally and be well groomed",
    "Carry a printed copy of your resume and a photo ID",
    "Read the job description and our company profile before the interview",
    "Arrive 10 minutes early",
  ],
};

// Automatic outreach when a hiring request is approved ----------------------------------------------------------------------

export interface AutoOutreachConfig {
  enabled: boolean;
  whatsappTemplateId: string | null;
  emailTemplateId: string | null;
  /** Only people whose city (or preferred locations) matches the role's location. */
  matchLocation: boolean;
  /** At most this many people per approved request. */
  maxPerRequest: number;
  /** Leave out anyone messaged about a job in the last N days. */
  skipContactedDays: number;
}
export const DEFAULT_AUTO: AutoOutreachConfig = { enabled: false, whatsappTemplateId: "wa_job_opening", emailTemplateId: "email_job_opening", matchLocation: true, maxPerRequest: 50, skipContactedDays: 30 };

export interface OutreachSettings {
  companyName: string;
  /** Owner 2026-11-24: the company profile link HR sets ({{company_profile}}; shown on the interview page). "" = none yet. */
  companyProfileUrl: string;
  applicationForm: ApplicationFormConfig;
  templates: OutreachTemplate[];
  auto: AutoOutreachConfig;
  screening: ScreeningConfig;
  interview: InterviewConfig;
  /** Owner 2026-11-24: the email offered after a move to a rejected stage ("" = none). */
  rejectionEmailTemplateId: string;
  assignment: AssignmentConfig;
  documents: DocumentsConfig;
  offer: OfferConfig;
}
export const DEFAULT_OUTREACH: OutreachSettings = {
  companyName: "Autopilot Offices", companyProfileUrl: "", applicationForm: DEFAULT_APPLICATION_FORM, templates: DEFAULT_TEMPLATES, auto: DEFAULT_AUTO,
  screening: DEFAULT_SCREENING, interview: DEFAULT_INTERVIEW, rejectionEmailTemplateId: "email_rejection",
  assignment: DEFAULT_ASSIGNMENT, documents: DEFAULT_DOCUMENTS, offer: DEFAULT_OFFER,
};

// Validation -----------------------------------------------------------------------------------------------------------

const ID = /^[a-z0-9_]{1,40}$/;
const PLACEHOLDER_KEYS = Object.keys(PLACEHOLDERS) as [Placeholder, ...Placeholder[]];
const TARGET_KEYS = Object.keys(APPLICATION_TARGETS) as [ApplicationTarget, ...ApplicationTarget[]];

export const FieldInput = z.object({
  id: z.string().regex(ID, "Each question needs a short id (letters, numbers, _)."),
  label: z.string().trim().min(1, "Each question needs its text.").max(200),
  type: z.enum(APPLICATION_FIELD_TYPES),
  required: z.boolean(),
  help: z.string().trim().max(200).optional(),
  options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  target: z.enum(TARGET_KEYS).nullable().optional(),
});
const FormInput = z.object({
  title: z.string().trim().min(1, "Give the form a title.").max(120),
  intro: z.string().trim().max(1000),
  fields: z.array(FieldInput).min(3).max(40),
  consentText: z.string().trim().min(1, "Keep the consent line: a candidate must agree before applying.").max(1000),
  thanks: z.string().trim().min(1).max(500),
});
const TemplateInput = z.object({
  id: z.string().regex(ID),
  name: z.string().trim().min(1, "Name each template.").max(80),
  channel: z.enum(["whatsapp", "email"]),
  campaign: z.string().trim().max(120).optional(),
  params: z.array(z.enum(PLACEHOLDER_KEYS)).max(10).optional(),
  subject: z.string().trim().max(250).optional(),
  body: z.string().trim().min(1, "Write the message.").max(5000),
});
const AutoInput = z.object({
  enabled: z.boolean(),
  whatsappTemplateId: z.string().regex(ID).nullable(),
  emailTemplateId: z.string().regex(ID).nullable(),
  matchLocation: z.boolean(),
  maxPerRequest: z.number().int().min(1).max(500),
  skipContactedDays: z.number().int().min(0).max(365),
});
const KEY = /^[a-z0-9_]{0,40}$/;
const ScreeningInput = z.object({
  enabled: z.boolean(),
  stageKey: z.string().regex(KEY).min(1, "Pick the stage that sends the screening questions."),
  noResponseStageKey: z.string().regex(KEY),
  whatsappTemplateId: z.string().regex(ID, "Pick the screening WhatsApp template."),
  noResponseAfterHours: z.number().int().min(24, "Give people at least 24 hours to answer.").max(336),
  intro: z.string().trim().max(1000),
  fields: z.array(FieldInput).min(1, "Keep at least one screening question.").max(25),
  maxQuestions: z.number().int().min(5, "Allow at least 5 screening questions.").max(40, "40 screening questions is the most."),
});
const InterviewInput = z.object({
  inviteTemplateId: z.string().regex(KEY),
  reminderTemplateId: z.string().regex(KEY),
  guidelinesOnline: z.array(z.string().trim().min(1).max(200)).max(15),
  guidelinesInPerson: z.array(z.string().trim().min(1).max(200)).max(15),
});
const names = (max: number) => z.array(z.string().trim().min(1).max(80)).max(max);
const AssignmentInput = z.object({
  whatsappTemplateId: z.string().regex(KEY),
  defaultDueDays: z.number().int().min(1).max(30),
  library: z.array(z.object({
    id: z.string().regex(ID),
    name: z.string().trim().min(1, "Name each assignment template.").max(80),
    department: z.string().trim().max(80),
    title: z.string().trim().min(1, "Give each assignment a title.").max(150),
    brief: z.string().trim().min(1, "Write each assignment's brief.").max(5000),
    guidelines: z.string().trim().max(2000),
    driveLink: z.string().trim().max(500).refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "An assignment's file link must start with https://."),
    dueDays: z.number().int().min(1).max(30),
  })).max(40),
});
const DocumentsInput = z.object({ whatsappTemplateId: z.string().regex(KEY), items: z.array(z.string().trim().min(1).max(120)).min(1, "Keep at least one document to ask for.").max(20) });
const OfferInput = z.object({
  hiringManagerApproves: z.boolean(),
  directorAlways: z.boolean(),
  loiTemplateId: z.string().regex(KEY),
  earnings: names(15).min(1, "Keep at least one earning in the salary breakup."),
  deductions: names(15),
  benefits: names(15),
});
export const OutreachSettingsInput = z.object({
  companyName: z.string().trim().min(1).max(120),
  companyProfileUrl: z.string().trim().max(500).refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "The company profile link must start with https://."),
  applicationForm: FormInput,
  templates: z.array(TemplateInput).max(30),
  auto: AutoInput,
  screening: ScreeningInput,
  interview: InterviewInput,
  rejectionEmailTemplateId: z.string().regex(KEY),
  assignment: AssignmentInput,
  documents: DocumentsInput,
  offer: OfferInput,
});

/** The placeholders a text uses ("{{role}}" -> "role"). */
export const placeholdersIn = (text: string): string[] => [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))];

/** Checks a whole settings body; returns it cleaned, or throws with the first problem in plain words. */
export function validateOutreachSettings(body: unknown): OutreachSettings {
  const parsed = OutreachSettingsInput.safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SettingsError(issue?.message && !/^(Invalid|Expected|Required)/.test(issue.message) ? issue.message : `Check ${issue?.path.join(" → ") || "the settings"}.`);
  }
  const s = parsed.data as OutreachSettings;
  const ids = s.applicationForm.fields.map((f) => f.id);
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupe) throw new SettingsError(`Two questions use the id "${dupe}".`);
  for (const target of REQUIRED_TARGETS) {
    const field = s.applicationForm.fields.find((f) => f.target === target);
    if (!field) throw new SettingsError(`Keep a question for "${APPLICATION_TARGETS[target]}": it is how an application reaches the right person.`);
    if (!field.required) throw new SettingsError(`"${field.label}" must stay required.`);
  }
  const targets = s.applicationForm.fields.map((f) => f.target).filter(Boolean);
  const twice = targets.find((t, i) => targets.indexOf(t) !== i);
  if (twice) throw new SettingsError(`Two questions fill "${APPLICATION_TARGETS[twice as ApplicationTarget]}". Keep one.`);
  for (const f of s.applicationForm.fields) {
    if (f.type === "select" && !(f.options?.length)) throw new SettingsError(`"${f.label}" is a choice: give it at least one option.`);
    if (f.target === "resume" && f.type !== "file") throw new SettingsError(`"${f.label}" fills the resume, so it must be a file upload.`);
    if (f.type === "file" && f.target !== "resume") throw new SettingsError(`"${f.label}": only the resume can be a file upload.`);
  }
  if (s.applicationForm.fields.filter((f) => f.type === "file").length > 1) throw new SettingsError("Keep one file upload (the resume).");

  const templateIds = s.templates.map((t) => t.id);
  const sameId = templateIds.find((id, i) => templateIds.indexOf(id) !== i);
  if (sameId) throw new SettingsError(`Two templates use the id "${sameId}".`);
  for (const t of s.templates) {
    const unknown = placeholdersIn(`${t.subject ?? ""} ${t.body}`).find((p) => !(p in PLACEHOLDERS));
    if (unknown) throw new SettingsError(`"${t.name}" uses {{${unknown}}}, which is not a placeholder. Use: ${PLACEHOLDER_KEYS.map((k) => `{{${k}}}`).join(", ")}.`);
    if (t.channel === "whatsapp") {
      if (!t.campaign) throw new SettingsError(`"${t.name}" needs its AiSensy campaign name.`);
      if (!t.params?.length) throw new SettingsError(`"${t.name}": list the template's variables {{1}}, {{2}}, … in order.`);
    } else if (!t.subject) throw new SettingsError(`"${t.name}" needs a subject.`);
  }
  const has = (id: string | null, channel: "whatsapp" | "email") => !id || s.templates.some((t) => t.id === id && t.channel === channel);
  if (!has(s.auto.whatsappTemplateId, "whatsapp")) throw new SettingsError("Automatic outreach points to a WhatsApp template that is not in the list.");
  if (!has(s.auto.emailTemplateId, "email")) throw new SettingsError("Automatic outreach points to an email template that is not in the list.");
  if (s.auto.enabled && !s.auto.whatsappTemplateId && !s.auto.emailTemplateId) throw new SettingsError("Automatic outreach is on: pick a WhatsApp or an email template for it.");

  // Screening: its own questions (no name / email / mobile / file: the person is already known).
  if (!has(s.screening.whatsappTemplateId, "whatsapp")) throw new SettingsError("Screening points to a WhatsApp template that is not in the list.");
  const sIds = s.screening.fields.map((f) => f.id);
  const sDupe = sIds.find((id, i) => sIds.indexOf(id) !== i);
  if (sDupe) throw new SettingsError(`Two screening questions use the id "${sDupe}".`);
  for (const f of s.screening.fields) {
    if (f.type === "file" || f.target === "resume") throw new SettingsError(`Screening question "${f.label}": no file uploads in screening.`);
    if (f.target && REQUIRED_TARGETS.includes(f.target)) throw new SettingsError(`Screening question "${f.label}": the name, email and mobile are already known; ask something else.`);
    if (f.type === "select" && !(f.options?.length)) throw new SettingsError(`Screening question "${f.label}" is a choice: give it at least one option.`);
  }
  const sTargets = s.screening.fields.map((f) => f.target).filter(Boolean);
  const sTwice = sTargets.find((t, i) => sTargets.indexOf(t) !== i);
  if (sTwice) throw new SettingsError(`Two screening questions fill "${APPLICATION_TARGETS[sTwice as ApplicationTarget]}". Keep one.`);
  if (s.screening.noResponseStageKey && s.screening.noResponseStageKey === s.screening.stageKey) throw new SettingsError("The no-response stage must differ from the screening stage.");

  if (!has(s.interview.inviteTemplateId || null, "whatsapp")) throw new SettingsError("The interview invite points to a WhatsApp template that is not in the list.");
  if (!has(s.interview.reminderTemplateId || null, "whatsapp")) throw new SettingsError("The interview reminder points to a WhatsApp template that is not in the list.");
  if (!has(s.rejectionEmailTemplateId || null, "email")) throw new SettingsError("The rejection email points to an email template that is not in the list.");
  if (!has(s.assignment.whatsappTemplateId || null, "whatsapp")) throw new SettingsError("Assignments point to a WhatsApp template that is not in the list.");
  if (!has(s.documents.whatsappTemplateId || null, "whatsapp")) throw new SettingsError("Documents point to a WhatsApp template that is not in the list.");
  if (!has(s.offer.loiTemplateId || null, "whatsapp")) throw new SettingsError("The letter of intent points to a WhatsApp template that is not in the list.");
  const aIds = s.assignment.library.map((a) => a.id);
  const aDupe = aIds.find((id, i) => aIds.indexOf(id) !== i);
  if (aDupe) throw new SettingsError(`Two assignment templates use the id "${aDupe}".`);
  return s;
}

export class SettingsError extends Error {}

/**
 * The saved settings, or the defaults for anything missing or no longer valid (never throws). Settings saved before
 * screening and interviews existed (owner 2026-11-24) get their templates and defaults added, so nothing HR saved is lost.
 */
export function toOutreachSettings(raw: unknown): OutreachSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_OUTREACH;
  const r = raw as Partial<OutreachSettings>;
  const saved = Array.isArray(r.templates) ? (r.templates as OutreachTemplate[]) : null;
  // Templates that arrived after HR saved: added once (a template HR deleted later stays deleted).
  const added = [...(r.screening === undefined ? FLOW_TEMPLATES : []), ...(r.assignment === undefined ? OFFER_TEMPLATES : [])];
  const templates = saved ? [...saved, ...added.filter((t) => !saved.some((x) => x.id === t.id))] : DEFAULT_TEMPLATES;
  try {
    return validateOutreachSettings({
      companyName: r.companyName ?? DEFAULT_OUTREACH.companyName,
      companyProfileUrl: r.companyProfileUrl ?? "",
      applicationForm: r.applicationForm ?? DEFAULT_APPLICATION_FORM,
      templates,
      auto: { ...DEFAULT_AUTO, ...(r.auto ?? {}) },
      screening: { ...DEFAULT_SCREENING, ...(r.screening ?? {}) },
      interview: { ...DEFAULT_INTERVIEW, ...(r.interview ?? {}) },
      rejectionEmailTemplateId: r.rejectionEmailTemplateId ?? DEFAULT_OUTREACH.rejectionEmailTemplateId,
      assignment: { ...DEFAULT_ASSIGNMENT, ...(r.assignment ?? {}) },
      documents: { ...DEFAULT_DOCUMENTS, ...(r.documents ?? {}) },
      offer: { ...DEFAULT_OFFER, ...(r.offer ?? {}) },
    });
  } catch {
    return DEFAULT_OUTREACH;
  }
}

/** The guidelines as one line (WhatsApp refuses line breaks in a parameter): "Use earphones. Dress formally." */
export const guidelinesLine = (list: string[]) => list.map((g) => g.trim().replace(/[.\s]+$/, "")).filter(Boolean).map((g) => `${g}.`).join(" ");

// Filling in the placeholders ------------------------------------------------------------------------------------------

export type PlaceholderValues = Partial<Record<Placeholder, string | null>>;

/** The text with every placeholder filled; `gaps` lists those with no value (a message with gaps is not sent). */
export function fillTemplate(text: string, values: PlaceholderValues): { text: string; gaps: string[] } {
  const gaps = new Set<string>();
  const out = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => {
    const v = (values as Record<string, string | null | undefined>)[key];
    if (v === undefined || v === null || !String(v).trim()) { gaps.add(key); return `{{${key}}}`; }
    return String(v);
  });
  return { text: out, gaps: [...gaps] };
}

/** A WhatsApp template's parameters in order; WhatsApp refuses line breaks in a parameter, so each is one line. */
export function whatsappParams(t: OutreachTemplate, values: PlaceholderValues): { params: string[]; gaps: string[] } {
  const gaps: string[] = [];
  const params = (t.params ?? []).map((key) => {
    const v = values[key];
    if (v === undefined || v === null || !String(v).trim()) { gaps.push(key); return ""; }
    return String(v).replace(/\s+/g, " ").trim().slice(0, 900);
  });
  return { params, gaps };
}
