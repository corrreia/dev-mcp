import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull()
});

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull()
  },
  (table) => [index("account_user_id_idx").on(table.userId)]
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull()
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent")
  },
  (table) => [index("session_user_id_idx").on(table.userId)]
);

export const oauthApplication = sqliteTable(
  "oauth_application",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    redirectUrls: text("redirect_urls"),
    disabled: integer("disabled", { mode: "boolean" }).default(false),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
  },
  (table) => [index("oauth_application_user_id_idx").on(table.userId)]
);

export const oauthAccessToken = sqliteTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    accessToken: text("access_token").unique(),
    refreshToken: text("refresh_token").unique(),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    clientId: text("client_id").references(() => oauthApplication.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    scopes: text("scopes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
  },
  (table) => [index("oauth_access_token_client_id_idx").on(table.clientId), index("oauth_access_token_user_id_idx").on(table.userId)]
);

export const oauthConsent = sqliteTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").references(() => oauthApplication.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    scopes: text("scopes"),
    consentGiven: integer("consent_given", { mode: "boolean" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
  },
  (table) => [index("oauth_consent_client_id_idx").on(table.clientId), index("oauth_consent_user_id_idx").on(table.userId)]
);

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    type: text("type", { enum: ["openapi", "mcp"] }).notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url"),
    specUrl: text("spec_url"),
    authType: text("auth_type", { enum: ["none", "bearer", "header", "oauth"] }).notNull().default("none"),
    authHeaderName: text("auth_header_name"),
    encryptedSecret: text("encrypted_secret"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull()
  },
  (table) => [
    uniqueIndex("sources_owner_slug_idx").on(table.ownerId, table.slug),
    index("sources_type_idx").on(table.type)
  ]
);

export const catalogEntries = sqliteTable(
  "catalog_entries",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    sourceSlug: text("source_slug").notNull(),
    sourceType: text("source_type", { enum: ["openapi", "mcp"] }).notNull(),
    operationKey: text("operation_key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    searchText: text("search_text").notNull(),
    inputSchemaJson: text("input_schema_json"),
    executionRefJson: text("execution_ref_json").notNull(),
    refreshedAt: integer("refreshed_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull()
  },
  (table) => [
    index("catalog_entries_source_id_idx").on(table.sourceId),
    index("catalog_entries_search_text_idx").on(table.searchText)
  ]
);

export const executionLogs = sqliteTable(
  "execution_logs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id"),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    code: text("code").notNull(),
    resultJson: text("result_json"),
    error: text("error"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull()
  },
  (table) => [index("execution_logs_owner_id_idx").on(table.ownerId)]
);

export const sourceRelations = relations(sources, ({ many }) => ({
  catalogEntries: many(catalogEntries)
}));

export const catalogEntryRelations = relations(catalogEntries, ({ one }) => ({
  source: one(sources, {
    fields: [catalogEntries.sourceId],
    references: [sources.id]
  })
}));
