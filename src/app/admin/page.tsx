"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopNav from "@/components/TopNav";
import { supabaseClient } from "@/lib/supabaseClient";

type AuthStatus = "loading" | "signedOut" | "signedIn";

type AdminView =
  | "users"
  | "images"
  | "humorFlavors"
  | "humorFlavorSteps"
  | "humorMix"
  | "terms"
  | "captions"
  | "captionRequests"
  | "captionExamples"
  | "llmModels"
  | "llmProviders"
  | "llmPromptChains"
  | "llmResponses"
  | "allowedSignupDomains"
  | "whitelistEmailAddresses";

type FieldType = "text" | "textarea" | "number" | "checkbox" | "select";
type ViewMode = "read" | "crud" | "updateOnly";
type OptionSource = "humorFlavors" | "llmProviders";
type Primitive = string | number | boolean | null;
type GenericRow = Record<string, unknown>;
type DraftState = Record<string, string | boolean>;

type FieldConfig = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  nullable?: boolean;
  create?: boolean;
  update?: boolean;
  defaultValue?: string | boolean;
  optionsSource?: OptionSource;
  placeholder?: string;
  rows?: number;
};

type DisplayField = {
  key: string;
  label: string;
  kind?: "text" | "longText" | "date" | "boolean";
};

type ViewConfig = {
  key: AdminView;
  label: string;
  title: string;
  description: string;
  table: string;
  select: string;
  orderBy: string;
  orderAscending?: boolean;
  mode: ViewMode;
  fields?: FieldConfig[];
  displayFields: DisplayField[];
  showCreateForm?: boolean;
  touchModifiedAt?: boolean;
};

type SelectOption = {
  value: string;
  label: string;
};

const PAGE_SIZE = 25;

const allowedContentTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
]);

const VIEW_ORDER: AdminView[] = [
  "users",
  "images",
  "humorFlavors",
  "humorFlavorSteps",
  "humorMix",
  "terms",
  "captions",
  "captionRequests",
  "captionExamples",
  "llmModels",
  "llmProviders",
  "llmPromptChains",
  "llmResponses",
  "allowedSignupDomains",
  "whitelistEmailAddresses",
];

const VIEW_CONFIGS: Record<AdminView, ViewConfig> = {
  users: {
    key: "users",
    label: "Users",
    title: "Profiles",
    description: "Read users from the profiles table.",
    table: "profiles",
    select:
      "id, first_name, last_name, email, is_superadmin, is_in_study, is_matrix_admin, created_datetime_utc",
    orderBy: "created_datetime_utc",
    mode: "read",
    displayFields: [
      { key: "first_name", label: "First name" },
      { key: "last_name", label: "Last name" },
      { key: "email", label: "Email" },
      { key: "is_superadmin", label: "Superadmin", kind: "boolean" },
      { key: "is_in_study", label: "In study", kind: "boolean" },
      { key: "is_matrix_admin", label: "Matrix admin", kind: "boolean" },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
  images: {
    key: "images",
    label: "Images",
    title: "Images",
    description: "Create, read, update, delete, and upload images.",
    table: "images",
    select:
      "id, created_datetime_utc, modified_datetime_utc, url, is_common_use, profile_id, additional_context, is_public, image_description, celebrity_recognition",
    orderBy: "created_datetime_utc",
    mode: "crud",
    showCreateForm: false,
    touchModifiedAt: true,
    fields: [
      { key: "url", label: "Image URL", type: "text", nullable: true },
      {
        key: "image_description",
        label: "Description",
        type: "textarea",
        nullable: true,
        rows: 3,
      },
      {
        key: "additional_context",
        label: "Additional context",
        type: "textarea",
        nullable: true,
        rows: 3,
      },
      {
        key: "celebrity_recognition",
        label: "Celebrity recognition",
        type: "textarea",
        nullable: true,
        rows: 2,
      },
      {
        key: "profile_id",
        label: "Profile ID",
        type: "text",
        nullable: true,
      },
      {
        key: "is_public",
        label: "Public",
        type: "checkbox",
        defaultValue: false,
      },
      {
        key: "is_common_use",
        label: "Common use",
        type: "checkbox",
        defaultValue: false,
      },
    ],
    displayFields: [
      { key: "image_description", label: "Description", kind: "longText" },
      { key: "additional_context", label: "Additional context", kind: "longText" },
      { key: "celebrity_recognition", label: "Celebrity recognition", kind: "longText" },
      { key: "profile_id", label: "Profile ID" },
      { key: "is_public", label: "Public", kind: "boolean" },
      { key: "is_common_use", label: "Common use", kind: "boolean" },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
  humorFlavors: {
    key: "humorFlavors",
    label: "Humor Flavors",
    title: "Humor Flavors",
    description: "Read humor flavors.",
    table: "humor_flavors",
    select: "id, created_datetime_utc, slug, description",
    orderBy: "id",
    mode: "read",
    displayFields: [
      { key: "slug", label: "Slug" },
      { key: "description", label: "Description", kind: "longText" },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
  humorFlavorSteps: {
    key: "humorFlavorSteps",
    label: "Flavor Steps",
    title: "Humor Flavor Steps",
    description: "Read humor flavor steps.",
    table: "humor_flavor_steps",
    select:
      "id, created_datetime_utc, humor_flavor_id, llm_temperature, order_by, llm_input_type_id, llm_output_type_id, llm_model_id, humor_flavor_step_type_id, llm_system_prompt, llm_user_prompt, description",
    orderBy: "order_by",
    mode: "read",
    displayFields: [
      { key: "humor_flavor_id", label: "Flavor ID" },
      { key: "order_by", label: "Order" },
      { key: "llm_model_id", label: "LLM model ID" },
      { key: "llm_temperature", label: "Temperature" },
      { key: "llm_input_type_id", label: "Input type ID" },
      { key: "llm_output_type_id", label: "Output type ID" },
      { key: "humor_flavor_step_type_id", label: "Step type ID" },
      { key: "description", label: "Description", kind: "longText" },
      { key: "llm_system_prompt", label: "System prompt", kind: "longText" },
      { key: "llm_user_prompt", label: "User prompt", kind: "longText" },
      { key: "id", label: "ID" },
    ],
  },
  humorMix: {
    key: "humorMix",
    label: "Humor Mix",
    title: "Humor Flavor Mix",
    description: "Read and update humor mix rows.",
    table: "humor_flavor_mix",
    select: "id, created_datetime_utc, humor_flavor_id, caption_count",
    orderBy: "id",
    mode: "updateOnly",
    fields: [
      {
        key: "humor_flavor_id",
        label: "Humor flavor",
        type: "select",
        required: true,
        optionsSource: "humorFlavors",
      },
      {
        key: "caption_count",
        label: "Caption count",
        type: "number",
        required: true,
      },
    ],
    displayFields: [
      { key: "humor_flavor_id", label: "Flavor ID" },
      { key: "caption_count", label: "Caption count" },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
  terms: {
    key: "terms",
    label: "Terms",
    title: "Terms",
    description: "Create, read, update, and delete glossary terms.",
    table: "terms",
    select:
      "id, created_datetime_utc, modified_datetime_utc, term, definition, example, priority, term_type_id",
    orderBy: "id",
    mode: "crud",
    showCreateForm: true,
    touchModifiedAt: true,
    fields: [
      { key: "term", label: "Term", type: "text", required: true },
      {
        key: "definition",
        label: "Definition",
        type: "textarea",
        required: true,
        rows: 4,
      },
      {
        key: "example",
        label: "Example",
        type: "textarea",
        required: true,
        rows: 3,
      },
      {
        key: "priority",
        label: "Priority",
        type: "number",
        required: true,
        defaultValue: "0",
      },
      {
        key: "term_type_id",
        label: "Term type ID",
        type: "number",
        nullable: true,
      },
    ],
    displayFields: [
      { key: "term", label: "Term" },
      { key: "definition", label: "Definition", kind: "longText" },
      { key: "example", label: "Example", kind: "longText" },
      { key: "priority", label: "Priority" },
      { key: "term_type_id", label: "Term type ID" },
      { key: "id", label: "ID" },
    ],
  },
  captions: {
    key: "captions",
    label: "Captions",
    title: "Captions",
    description: "Read captions.",
    table: "captions",
    select:
      "id, content, created_datetime_utc, like_count, is_public, is_featured, image_id, humor_flavor_id, profile_id, caption_request_id, llm_prompt_chain_id, images(url, image_description)",
    orderBy: "created_datetime_utc",
    mode: "read",
    displayFields: [
      { key: "content", label: "Content", kind: "longText" },
      { key: "like_count", label: "Likes" },
      { key: "is_public", label: "Public", kind: "boolean" },
      { key: "is_featured", label: "Featured", kind: "boolean" },
      { key: "image_id", label: "Image ID" },
      { key: "humor_flavor_id", label: "Flavor ID" },
      { key: "profile_id", label: "Profile ID" },
      { key: "caption_request_id", label: "Caption request ID" },
      { key: "llm_prompt_chain_id", label: "Prompt chain ID" },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
  captionRequests: {
    key: "captionRequests",
    label: "Caption Requests",
    title: "Caption Requests",
    description: "Read caption requests.",
    table: "caption_requests",
    select: "id, created_datetime_utc, profile_id, image_id",
    orderBy: "created_datetime_utc",
    mode: "read",
    displayFields: [
      { key: "profile_id", label: "Profile ID" },
      { key: "image_id", label: "Image ID" },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
  captionExamples: {
    key: "captionExamples",
    label: "Caption Examples",
    title: "Caption Examples",
    description: "Create, read, update, and delete caption examples.",
    table: "caption_examples",
    select:
      "id, created_datetime_utc, modified_datetime_utc, image_description, caption, explanation, priority, image_id",
    orderBy: "priority",
    orderAscending: false,
    mode: "crud",
    showCreateForm: true,
    touchModifiedAt: true,
    fields: [
      {
        key: "image_description",
        label: "Image description",
        type: "textarea",
        required: true,
        rows: 3,
      },
      {
        key: "caption",
        label: "Caption",
        type: "textarea",
        required: true,
        rows: 3,
      },
      {
        key: "explanation",
        label: "Explanation",
        type: "textarea",
        required: true,
        rows: 4,
      },
      {
        key: "priority",
        label: "Priority",
        type: "number",
        required: true,
        defaultValue: "0",
      },
      {
        key: "image_id",
        label: "Image ID",
        type: "text",
        nullable: true,
      },
    ],
    displayFields: [
      { key: "image_description", label: "Image description", kind: "longText" },
      { key: "caption", label: "Caption", kind: "longText" },
      { key: "explanation", label: "Explanation", kind: "longText" },
      { key: "priority", label: "Priority" },
      { key: "image_id", label: "Image ID" },
      { key: "id", label: "ID" },
    ],
  },
  llmModels: {
    key: "llmModels",
    label: "LLM Models",
    title: "LLM Models",
    description: "Create, read, update, and delete LLM models.",
    table: "llm_models",
    select:
      "id, created_datetime_utc, name, llm_provider_id, provider_model_id, is_temperature_supported",
    orderBy: "id",
    mode: "crud",
    showCreateForm: true,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      {
        key: "llm_provider_id",
        label: "Provider",
        type: "select",
        required: true,
        optionsSource: "llmProviders",
      },
      {
        key: "provider_model_id",
        label: "Provider model ID",
        type: "text",
        required: true,
      },
      {
        key: "is_temperature_supported",
        label: "Temperature supported",
        type: "checkbox",
        defaultValue: false,
      },
    ],
    displayFields: [
      { key: "name", label: "Name" },
      { key: "llm_provider_id", label: "Provider ID" },
      { key: "provider_model_id", label: "Provider model ID" },
      {
        key: "is_temperature_supported",
        label: "Temperature supported",
        kind: "boolean",
      },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
  llmProviders: {
    key: "llmProviders",
    label: "LLM Providers",
    title: "LLM Providers",
    description: "Create, read, update, and delete LLM providers.",
    table: "llm_providers",
    select: "id, created_datetime_utc, name",
    orderBy: "id",
    mode: "crud",
    showCreateForm: true,
    fields: [{ key: "name", label: "Name", type: "text", required: true }],
    displayFields: [
      { key: "name", label: "Name" },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
  llmPromptChains: {
    key: "llmPromptChains",
    label: "Prompt Chains",
    title: "LLM Prompt Chains",
    description: "Read LLM prompt chains.",
    table: "llm_prompt_chains",
    select: "id, created_datetime_utc, caption_request_id",
    orderBy: "created_datetime_utc",
    mode: "read",
    displayFields: [
      { key: "caption_request_id", label: "Caption request ID" },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
  llmResponses: {
    key: "llmResponses",
    label: "LLM Responses",
    title: "LLM Model Responses",
    description: "Read LLM model responses.",
    table: "llm_model_responses",
    select:
      "id, created_datetime_utc, llm_model_response, processing_time_seconds, llm_model_id, profile_id, caption_request_id, llm_system_prompt, llm_user_prompt, llm_temperature, humor_flavor_id, llm_prompt_chain_id, humor_flavor_step_id",
    orderBy: "created_datetime_utc",
    mode: "read",
    displayFields: [
      { key: "llm_model_id", label: "Model ID" },
      { key: "profile_id", label: "Profile ID" },
      { key: "caption_request_id", label: "Caption request ID" },
      { key: "humor_flavor_id", label: "Flavor ID" },
      { key: "humor_flavor_step_id", label: "Flavor step ID" },
      { key: "llm_prompt_chain_id", label: "Prompt chain ID" },
      { key: "processing_time_seconds", label: "Processing seconds" },
      { key: "llm_temperature", label: "Temperature" },
      { key: "llm_system_prompt", label: "System prompt", kind: "longText" },
      { key: "llm_user_prompt", label: "User prompt", kind: "longText" },
      { key: "llm_model_response", label: "Response", kind: "longText" },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
  allowedSignupDomains: {
    key: "allowedSignupDomains",
    label: "Signup Domains",
    title: "Allowed Signup Domains",
    description: "Create, read, update, and delete allowed signup domains.",
    table: "allowed_signup_domains",
    select: "id, created_datetime_utc, apex_domain",
    orderBy: "id",
    mode: "crud",
    showCreateForm: true,
    fields: [
      { key: "apex_domain", label: "Apex domain", type: "text", required: true },
    ],
    displayFields: [
      { key: "apex_domain", label: "Apex domain" },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
  whitelistEmailAddresses: {
    key: "whitelistEmailAddresses",
    label: "Whitelist Emails",
    title: "Whitelisted E-mail Addresses",
    description:
      "Create, read, update, and delete whitelisted e-mail addresses.",
    table: "whitelist_email_addresses",
    select: "id, created_datetime_utc, modified_datetime_utc, email_address",
    orderBy: "id",
    mode: "crud",
    showCreateForm: true,
    touchModifiedAt: true,
    fields: [
      {
        key: "email_address",
        label: "E-mail address",
        type: "text",
        required: true,
      },
    ],
    displayFields: [
      { key: "email_address", label: "E-mail address" },
      { key: "created_datetime_utc", label: "Created", kind: "date" },
      { key: "modified_datetime_utc", label: "Modified", kind: "date" },
      { key: "id", label: "ID" },
    ],
  },
};

function buildInitialMap<T>(createValue: () => T): Record<AdminView, T> {
  return VIEW_ORDER.reduce(
    (accumulator, view) => {
      accumulator[view] = createValue();
      return accumulator;
    },
    {} as Record<AdminView, T>,
  );
}

function getDefaultDraft(fields: FieldConfig[] = []): DraftState {
  return fields.reduce((draft, field) => {
    draft[field.key] =
      field.defaultValue ?? (field.type === "checkbox" ? false : "");
    return draft;
  }, {} as DraftState);
}

function getRecordId(row: GenericRow): string {
  return String(row.id ?? "");
}

function getValue(row: GenericRow, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      row,
    );
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatValue(value: unknown, kind: DisplayField["kind"] = "text") {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "boolean") return value ? "Yes" : "No";
  if (kind === "date") return formatDate(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "—";
    }
  }
  return String(value);
}

function buildDraftFromRow(fields: FieldConfig[] = [], row: GenericRow): DraftState {
  return fields.reduce((draft, field) => {
    const value = row[field.key] as Primitive | undefined;
    if (field.type === "checkbox") {
      draft[field.key] = Boolean(value);
    } else if (value === null || value === undefined) {
      draft[field.key] = "";
    } else {
      draft[field.key] = String(value);
    }
    return draft;
  }, {} as DraftState);
}

function parseFieldValue(
  field: FieldConfig,
  value: string | boolean,
  mode: "create" | "update",
) {
  if (field.type === "checkbox") return Boolean(value);

  const normalized = String(value).trim();

  if (!normalized) {
    if (field.required) {
      throw new Error(`${field.label} is required.`);
    }
    if (field.nullable) {
      return null;
    }
    if (mode === "create") {
      return undefined;
    }
    return null;
  }

  if (field.type === "number" || field.type === "select") {
    const numberValue = Number(normalized);
    if (Number.isNaN(numberValue)) {
      throw new Error(`${field.label} must be numeric.`);
    }
    return numberValue;
  }

  return normalized;
}

function buildPayload(
  config: ViewConfig,
  draft: DraftState,
  mode: "create" | "update",
) {
  const payload: Record<string, Primitive> = {};

  for (const field of config.fields ?? []) {
    if (mode === "create" && field.create === false) continue;
    if (mode === "update" && field.update === false) continue;

    const parsed = parseFieldValue(field, draft[field.key] ?? "", mode);
    if (parsed !== undefined) {
      payload[field.key] = parsed;
    }
  }

  if (mode === "update" && config.touchModifiedAt) {
    payload.modified_datetime_utc = new Date().toISOString();
  }

  return payload;
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

const getCaptionCountFromResponse = (response: unknown) => {
  if (Array.isArray(response)) return response.length;
  return 1;
};

const generateCaptionsBatch = async (
  token: string,
  imageId: string,
  targetCount = 5,
) => {
  const baseUrl = "https://api.almostcrackd.ai";
  const responses: unknown[] = [];
  let totalGenerated = 0;
  let attempts = 0;
  const maxAttempts = 10;

  while (totalGenerated < targetCount && attempts < maxAttempts) {
    const response = await fetchJson<unknown>(
      `${baseUrl}/pipeline/generate-captions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageId }),
      },
    );
    responses.push(response);
    totalGenerated += getCaptionCountFromResponse(response);
    attempts += 1;
  }
  return responses;
};

export default function AdminPage() {
  const supabaseUntyped: {
    from: (table: string) => any;
    auth: typeof supabaseClient.auth;
  } = supabaseClient as any;

  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<AdminView>("images");
  const [recordsByView, setRecordsByView] = useState<Record<AdminView, GenericRow[]>>(
    () => buildInitialMap(() => []),
  );
  const [pageByView, setPageByView] = useState<Record<AdminView, number>>(() =>
    buildInitialMap(() => 0),
  );
  const [hasMoreByView, setHasMoreByView] = useState<Record<AdminView, boolean>>(
    () => buildInitialMap(() => true),
  );
  const [loadingByView, setLoadingByView] = useState<Record<AdminView, boolean>>(
    () => buildInitialMap(() => false),
  );
  const [createDrafts, setCreateDrafts] = useState<Record<AdminView, DraftState>>(
    () =>
      VIEW_ORDER.reduce(
        (accumulator, view) => {
          accumulator[view] = getDefaultDraft(VIEW_CONFIGS[view].fields);
          return accumulator;
        },
        {} as Record<AdminView, DraftState>,
      ),
  );
  const [editingRowIdByView, setEditingRowIdByView] = useState<
    Record<AdminView, string | null>
  >(() => buildInitialMap(() => null));
  const [editDraftByView, setEditDraftByView] = useState<Record<AdminView, DraftState>>(
    () => buildInitialMap(() => ({})),
  );
  const [savingView, setSavingView] = useState<AdminView | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [humorFlavorOptions, setHumorFlavorOptions] = useState<SelectOption[]>([]);
  const [llmProviderOptions, setLlmProviderOptions] = useState<SelectOption[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    const resolveSession = async () => {
      const { data, error } = await supabaseClient.auth.getSession();
      if (!isMounted) return;
      if (error) {
        setAuthStatus("signedOut");
        setErrorMessage(error.message);
        return;
      }
      if (data.session) {
        setCurrentUserId(data.session.user.id);
        setAuthStatus("signedIn");
      } else {
        setCurrentUserId(null);
        setAuthStatus("signedOut");
        setIsSuperAdmin(null);
      }
    };

    void resolveSession();

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      if (session) {
        setCurrentUserId(session.user.id);
        setAuthStatus("signedIn");
      } else {
        setCurrentUserId(null);
        setAuthStatus("signedOut");
        setIsSuperAdmin(null);
        setRecordsByView(buildInitialMap(() => []));
        setPageByView(buildInitialMap(() => 0));
        setHasMoreByView(buildInitialMap(() => true));
        setEditingRowIdByView(buildInitialMap(() => null));
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const checkSuperAdmin = useCallback(async (userId: string) => {
    setErrorMessage(null);
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, is_superadmin")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      setErrorMessage(error.message);
      setIsSuperAdmin(false);
      return false;
    }

    if (!data?.is_superadmin) {
      setIsSuperAdmin(false);
      await supabaseClient.auth.signOut();
      return false;
    }

    setIsSuperAdmin(true);
    return true;
  }, []);

  useEffect(() => {
    if (authStatus !== "signedIn" || !currentUserId) return;
    void checkSuperAdmin(currentUserId);
  }, [authStatus, checkSuperAdmin, currentUserId]);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          prompt: "select_account",
        },
      },
    });
    if (error) {
      setErrorMessage(error.message);
    }
  };

  const handleSignOut = async () => {
    setErrorMessage(null);
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
    }
  };

  const canLoadAdminData = authStatus === "signedIn" && isSuperAdmin;

  const loadSupportOptions = useCallback(async () => {
    if (!canLoadAdminData) return;

    const [humorFlavorResponse, llmProviderResponse] = await Promise.all([
      supabaseUntyped
        .from("humor_flavors")
        .select("id, slug")
        .order("id", { ascending: true }),
      supabaseUntyped
        .from("llm_providers")
        .select("id, name")
        .order("id", { ascending: true }),
    ]);

    if (humorFlavorResponse.error) {
      setErrorMessage(humorFlavorResponse.error.message);
    } else {
      const rows = (humorFlavorResponse.data ?? []) as Array<{
        id: number;
        slug: string;
      }>;
      setHumorFlavorOptions(
        rows.map((row) => ({
          value: String(row.id),
          label: `${row.id} · ${row.slug}`,
        })),
      );
    }

    if (llmProviderResponse.error) {
      setErrorMessage(llmProviderResponse.error.message);
    } else {
      const rows = (llmProviderResponse.data ?? []) as Array<{
        id: number;
        name: string;
      }>;
      setLlmProviderOptions(
        rows.map((row) => ({
          value: String(row.id),
          label: `${row.id} · ${row.name}`,
        })),
      );
    }
  }, [canLoadAdminData]);

  useEffect(() => {
    if (!canLoadAdminData) return;
    void loadSupportOptions();
  }, [canLoadAdminData, loadSupportOptions]);

  const getOptionsForField = useCallback(
    (field: FieldConfig) => {
      if (field.optionsSource === "humorFlavors") return humorFlavorOptions;
      if (field.optionsSource === "llmProviders") return llmProviderOptions;
      return [];
    },
    [humorFlavorOptions, llmProviderOptions],
  );

  const loadViewData = useCallback(
    async (view: AdminView, reset = false) => {
      if (!canLoadAdminData) return;
      if (loadingByView[view]) return;
      if (!reset && !hasMoreByView[view]) return;

      const config = VIEW_CONFIGS[view];
      const currentPage = reset ? 0 : pageByView[view];
      const offset = currentPage * PAGE_SIZE;

      setLoadingByView((prev) => ({ ...prev, [view]: true }));
      setErrorMessage(null);

      const { data, error } = await supabaseUntyped
        .from(config.table)
        .select(config.select)
        .order(config.orderBy, { ascending: config.orderAscending ?? false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        setErrorMessage(error.message);
        setLoadingByView((prev) => ({ ...prev, [view]: false }));
        return;
      }

      const rows = (data ?? []) as GenericRow[];

      setRecordsByView((prev) => ({
        ...prev,
        [view]: reset ? rows : [...prev[view], ...rows],
      }));
      setPageByView((prev) => ({ ...prev, [view]: currentPage + 1 }));
      setHasMoreByView((prev) => ({ ...prev, [view]: rows.length === PAGE_SIZE }));
      setLoadingByView((prev) => ({ ...prev, [view]: false }));
    },
    [canLoadAdminData, hasMoreByView, loadingByView, pageByView],
  );

  useEffect(() => {
    if (!canLoadAdminData) return;
    if (recordsByView[activeView].length > 0) return;
    void loadViewData(activeView);
  }, [activeView, canLoadAdminData, loadViewData, recordsByView]);

  const updateCreateDraft = (
    view: AdminView,
    key: string,
    value: string | boolean,
  ) => {
    setCreateDrafts((prev) => ({
      ...prev,
      [view]: {
        ...prev[view],
        [key]: value,
      },
    }));
  };

  const updateEditDraft = (
    view: AdminView,
    key: string,
    value: string | boolean,
  ) => {
    setEditDraftByView((prev) => ({
      ...prev,
      [view]: {
        ...prev[view],
        [key]: value,
      },
    }));
  };

  const beginEditing = (view: AdminView, row: GenericRow) => {
    setEditingRowIdByView((prev) => ({
      ...prev,
      [view]: getRecordId(row),
    }));
    setEditDraftByView((prev) => ({
      ...prev,
      [view]: buildDraftFromRow(VIEW_CONFIGS[view].fields, row),
    }));
  };

  const cancelEditing = (view: AdminView) => {
    setEditingRowIdByView((prev) => ({ ...prev, [view]: null }));
    setEditDraftByView((prev) => ({ ...prev, [view]: {} }));
  };

  const handleCreateRecord = async (view: AdminView) => {
    const config = VIEW_CONFIGS[view];
    if (!config.fields || config.mode !== "crud") return;

    setSavingView(view);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const payload = buildPayload(config, createDrafts[view], "create");
      const { error } = await supabaseUntyped.from(config.table).insert(payload);

      if (error) throw error;

      setCreateDrafts((prev) => ({
        ...prev,
        [view]: getDefaultDraft(config.fields),
      }));
      setStatusMessage(`${config.title} row created.`);
      await loadViewData(view, true);

      if (view === "llmProviders") {
        await loadSupportOptions();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingView(null);
    }
  };

  const handleUpdateRecord = async (view: AdminView, rowId: string) => {
    const config = VIEW_CONFIGS[view];
    if (!config.fields) return;

    setSavingView(view);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const payload = buildPayload(config, editDraftByView[view], "update");
      const { error } = await supabaseUntyped
        .from(config.table)
        .update(payload)
        .eq("id", rowId);

      if (error) throw error;

      setStatusMessage(`${config.title} row updated.`);
      cancelEditing(view);
      await loadViewData(view, true);

      if (view === "llmProviders") {
        await loadSupportOptions();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingView(null);
    }
  };

  const handleDeleteRecord = async (view: AdminView, rowId: string) => {
    const config = VIEW_CONFIGS[view];
    if (config.mode !== "crud") return;

    const shouldDelete = window.confirm(
      `Delete this ${config.label.toLowerCase()} row?`,
    );
    if (!shouldDelete) return;

    const actionKey = `${view}:${rowId}`;
    setDeletingKey(actionKey);
    setErrorMessage(null);
    setStatusMessage(null);

    const { error } = await supabaseUntyped
      .from(config.table)
      .delete()
      .eq("id", rowId);

    if (error) {
      setErrorMessage(error.message);
      setDeletingKey(null);
      return;
    }

    setStatusMessage(`${config.title} row deleted.`);
    if (editingRowIdByView[view] === rowId) {
      cancelEditing(view);
    }
    await loadViewData(view, true);

    if (view === "llmProviders") {
      await loadSupportOptions();
    }

    setDeletingKey(null);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!allowedContentTypes.has(file.type)) {
      setErrorMessage(
        "Unsupported file type. Please upload a JPEG, JPG, PNG, WEBP, GIF, or HEIC image.",
      );
      event.target.value = "";
      return;
    }

    setIsUploading(true);
    setStatusMessage("Preparing upload...");
    setErrorMessage(null);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabaseClient.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error(
          sessionError?.message ?? "Your session expired. Please sign in again.",
        );
      }

      const token = session.access_token;
      const baseUrl = "https://api.almostcrackd.ai";

      setStatusMessage("Requesting upload URL...");
      const presignResponse = await fetchJson<{
        presignedUrl: string;
        cdnUrl: string;
      }>(`${baseUrl}/pipeline/generate-presigned-url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentType: file.type,
        }),
      });

      setStatusMessage("Uploading image...");
      const uploadResponse = await fetch(presignResponse.presignedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        const text = await uploadResponse.text();
        throw new Error(text || "Failed to upload image bytes.");
      }

      setStatusMessage("Registering image...");
      const registerResponse = await fetchJson<{
        imageId: string;
        now: number;
      }>(`${baseUrl}/pipeline/upload-image-from-url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl: presignResponse.cdnUrl,
          isCommonUse: false,
        }),
      });

      setStatusMessage("Generating captions...");
      await generateCaptionsBatch(token, registerResponse.imageId);

      setStatusMessage("Image uploaded and captions generated.");
      await loadViewData("images", true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setStatusMessage(null);
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const activeButtonStyles = useMemo(
    () =>
      "rounded-full border border-cyan-400/60 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100",
    [],
  );

  const inactiveButtonStyles = useMemo(
    () =>
      "rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 transition hover:border-white/30 hover:text-zinc-200",
    [],
  );

  const activeConfig = VIEW_CONFIGS[activeView];
  const activeRecords = recordsByView[activeView];
  const isActiveViewLoading = loadingByView[activeView];
  const canCreate =
    activeConfig.mode === "crud" && activeConfig.showCreateForm !== false;
  const canUpdate =
    activeConfig.mode === "crud" || activeConfig.mode === "updateOnly";
  const canDelete = activeConfig.mode === "crud";

  const renderFieldInput = (
    field: FieldConfig,
    value: string | boolean,
    onChange: (nextValue: string | boolean) => void,
    disabled = false,
  ) => {
    const commonClassName =
      "w-full rounded-xl border border-white/12 bg-black/25 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50 disabled:cursor-not-allowed disabled:opacity-60";

    if (field.type === "checkbox") {
      return (
        <label className="flex items-center gap-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border-white/20 bg-black/25"
          />
          <span>{field.label}</span>
        </label>
      );
    }

    if (field.type === "textarea") {
      return (
        <textarea
          className={commonClassName}
          rows={field.rows ?? 4}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder ?? field.label}
          disabled={disabled}
        />
      );
    }

    if (field.type === "select") {
      const options = getOptionsForField(field);
      return (
        <select
          className={commonClassName}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        >
          <option value="">Select {field.label.toLowerCase()}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        className={commonClassName}
        type={field.type === "number" ? "number" : "text"}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder ?? field.label}
        disabled={disabled}
      />
    );
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_42%),_radial-gradient(circle_at_bottom,_rgba(244,114,182,0.12),_transparent_40%),_#0b0f17] px-6 py-10 text-zinc-100">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-10">
        <TopNav authStatus={authStatus} onSignOut={handleSignOut} />

        <header className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-fuchsia-300/80">
            Admin Control
          </p>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">
            Manage admin datasets from one console.
          </h1>
          <p className="max-w-3xl text-sm text-zinc-300">
            This console now covers users, images, humor settings, LLM tables,
            terms, caption data, and allowlists. It uses the same client-side
            Supabase access already present in the project.
          </p>
        </header>

        {errorMessage && (
          <p className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {errorMessage}
          </p>
        )}

        {statusMessage && (
          <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {statusMessage}
          </p>
        )}

        {authStatus === "loading" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
            Checking your session...
          </div>
        )}

        {authStatus === "signedOut" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-zinc-300">
              You must sign in with Google to access the admin console.
            </p>
            <button
              className="mt-4 inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/90 transition hover:border-white/40"
              onClick={handleGoogleSignIn}
              type="button"
            >
              Authenticate with Google
            </button>
          </div>
        )}

        {authStatus === "signedIn" && isSuperAdmin === false && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-100">
            You are signed in but do not have superadmin access. Contact the
            project owner if this is unexpected.
          </div>
        )}

        {authStatus === "signedIn" && isSuperAdmin === null && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
            Verifying superadmin access...
          </div>
        )}

        {canLoadAdminData && (
          <section className="rounded-[32px] border border-white/10 bg-gradient-to-br from-white/6 via-white/5 to-transparent p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            <div className="flex flex-wrap gap-3">
              {VIEW_ORDER.map((view) => (
                <button
                  key={view}
                  className={
                    activeView === view
                      ? activeButtonStyles
                      : inactiveButtonStyles
                  }
                  onClick={() => setActiveView(view)}
                  type="button"
                >
                  {VIEW_CONFIGS[view].label}
                </button>
              ))}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-white">
                  {activeConfig.title}
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                  {activeConfig.description}
                </p>
              </div>
              {isActiveViewLoading && (
                <span className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                  Loading...
                </span>
              )}
            </div>

            {activeView === "images" && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-[#0f1522] p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      Upload a new image
                    </h3>
                    <p className="mt-1 text-sm text-zinc-400">
                      Supported types: JPEG, JPG, PNG, WEBP, GIF, HEIC.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <button
                      className="inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/90 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={handleUploadClick}
                      type="button"
                      disabled={isUploading}
                    >
                      {isUploading ? "Uploading..." : "Upload image"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {canCreate && activeConfig.fields && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-[#0f1522] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-zinc-400">
                    Create row
                  </h3>
                  {savingView === activeView && (
                    <span className="text-xs text-zinc-500">Saving...</span>
                  )}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {activeConfig.fields.map((field) => (
                    <div
                      key={field.key}
                      className={field.type === "textarea" ? "md:col-span-2" : ""}
                    >
                      {field.type !== "checkbox" && (
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                          {field.label}
                        </label>
                      )}
                      {renderFieldInput(
                        field,
                        createDrafts[activeView][field.key] ??
                          field.defaultValue ??
                          "",
                        (nextValue) =>
                          updateCreateDraft(activeView, field.key, nextValue),
                        savingView === activeView,
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    className="inline-flex items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    onClick={() => void handleCreateRecord(activeView)}
                    disabled={savingView === activeView}
                  >
                    Create
                  </button>
                </div>
              </div>
            )}

            <div className="mt-8">
              {activeRecords.length === 0 && !isActiveViewLoading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                  No rows loaded yet.
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {activeRecords.map((row) => {
                    const rowId = getRecordId(row);
                    const isEditing = editingRowIdByView[activeView] === rowId;
                    const imageUrl =
                      activeView === "captions"
                        ? (getValue(row, "images.url") as string | undefined)
                        : (row.url as string | undefined);

                    return (
                      <article
                        key={`${activeView}-${rowId}`}
                        className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f1522] shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
                      >
                        {imageUrl && (
                          <div className="relative aspect-[16/9] w-full overflow-hidden bg-black/40">
                            <div
                              className="absolute inset-0 scale-110 blur-xl"
                              style={{
                                backgroundImage: `url(${imageUrl})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                              }}
                            />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imageUrl}
                              alt="Preview"
                              className="relative h-full w-full object-contain"
                            />
                          </div>
                        )}
                        <div className="p-5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                              {activeConfig.label}
                            </p>
                            <div className="flex items-center gap-2">
                              {canUpdate && activeConfig.fields && (
                                <button
                                  className="inline-flex items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-100 transition hover:bg-cyan-400/20"
                                  onClick={() =>
                                    isEditing
                                      ? cancelEditing(activeView)
                                      : beginEditing(activeView, row)
                                  }
                                  type="button"
                                >
                                  {isEditing ? "Close" : "Edit"}
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  className="inline-flex items-center justify-center rounded-full border border-rose-400/60 bg-rose-400/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={() =>
                                    void handleDeleteRecord(activeView, rowId)
                                  }
                                  type="button"
                                  disabled={deletingKey === `${activeView}:${rowId}`}
                                >
                                  {deletingKey === `${activeView}:${rowId}`
                                    ? "Deleting..."
                                    : "Delete"}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3">
                            {activeConfig.displayFields.map((field) => (
                              <div key={field.key}>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                                  {field.label}
                                </p>
                                <p
                                  className={`mt-1 text-sm text-zinc-200 ${
                                    field.kind === "longText"
                                      ? "whitespace-pre-wrap break-words"
                                      : "break-all"
                                  }`}
                                >
                                  {formatValue(getValue(row, field.key), field.kind)}
                                </p>
                              </div>
                            ))}
                            {activeView === "captions" && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                                  Image description
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">
                                  {formatValue(
                                    getValue(row, "images.image_description"),
                                    "longText",
                                  )}
                                </p>
                              </div>
                            )}
                          </div>

                          {isEditing && activeConfig.fields && (
                            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                              <div className="grid gap-4 md:grid-cols-2">
                                {activeConfig.fields.map((field) => (
                                  <div
                                    key={field.key}
                                    className={
                                      field.type === "textarea"
                                        ? "md:col-span-2"
                                        : ""
                                    }
                                  >
                                    {field.type !== "checkbox" && (
                                      <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                                        {field.label}
                                      </label>
                                    )}
                                    {renderFieldInput(
                                      field,
                                      editDraftByView[activeView][field.key] ??
                                        field.defaultValue ??
                                        "",
                                      (nextValue) =>
                                        updateEditDraft(
                                          activeView,
                                          field.key,
                                          nextValue,
                                        ),
                                      savingView === activeView,
                                    )}
                                  </div>
                                ))}
                              </div>
                              <div className="mt-4 flex justify-end gap-3">
                                <button
                                  className="inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-300 transition hover:border-white/40"
                                  type="button"
                                  onClick={() => cancelEditing(activeView)}
                                  disabled={savingView === activeView}
                                >
                                  Cancel
                                </button>
                                <button
                                  className="inline-flex items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                                  type="button"
                                  onClick={() =>
                                    void handleUpdateRecord(activeView, rowId)
                                  }
                                  disabled={savingView === activeView}
                                >
                                  {savingView === activeView ? "Saving..." : "Save"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {hasMoreByView[activeView] && (
                <button
                  className="mt-6 inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-zinc-300 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void loadViewData(activeView)}
                  type="button"
                  disabled={isActiveViewLoading}
                >
                  Load more
                </button>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
