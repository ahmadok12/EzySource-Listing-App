CREATE TABLE "app"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" varchar(80) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_zh" varchar(120),
	"order_index" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "app"."collection_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collector_id" uuid NOT NULL,
	"district_id" uuid,
	"floor_id" uuid,
	"default_category_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."collector_policies" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"mode" varchar(24) DEFAULT 'review_then_submit' NOT NULL,
	"grant_duration_minutes" integer,
	"grant_deadline" timestamp with time zone,
	"allow_offline_capture" boolean DEFAULT true NOT NULL,
	"changed_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collector_policies_mode_check" CHECK ("app"."collector_policies"."mode" in ('own_until_revoked', 'temporary', 'review_then_submit', 'immediate_handoff')),
	CONSTRAINT "collector_policies_temporary_check" CHECK ("app"."collector_policies"."mode" <> 'temporary' or "app"."collector_policies"."grant_duration_minutes" is not null or "app"."collector_policies"."grant_deadline" is not null),
	CONSTRAINT "collector_policies_duration_check" CHECK ("app"."collector_policies"."grant_duration_minutes" is null or "app"."collector_policies"."grant_duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."contact_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"contact_id" uuid,
	"type" varchar(16) NOT NULL,
	"value" varchar(300) NOT NULL,
	"label" varchar(60),
	"order_index" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_channels_type_check" CHECK ("app"."contact_channels"."type" in ('phone', 'email', 'wechat', 'whatsapp', 'website', 'social'))
);
--> statement-breakpoint
CREATE TABLE "app"."contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"code" varchar(20) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_zh" varchar(120),
	"order_index" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"district_id" uuid NOT NULL,
	"label" varchar(20) NOT NULL,
	"order_index" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(60) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_zh" varchar(120),
	"order_index" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "app"."record_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"source" varchar(16) NOT NULL,
	"policy_mode" varchar(24) NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_grants_source_check" CHECK ("app"."record_grants"."source" in ('collection', 'return', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "app"."revision_categories" (
	"revision_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "revision_categories_revision_id_category_id_pk" PRIMARY KEY("revision_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "app"."revision_contacts" (
	"revision_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"display_name" varchar(120),
	"title" varchar(120),
	"is_primary" boolean DEFAULT false NOT NULL,
	"order_index" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "revision_contacts_revision_id_contact_id_pk" PRIMARY KEY("revision_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "app"."revision_keywords" (
	"revision_id" uuid NOT NULL,
	"keyword" varchar(80) NOT NULL,
	"language" varchar(16) DEFAULT 'und' NOT NULL,
	CONSTRAINT "revision_keywords_revision_id_keyword_pk" PRIMARY KEY("revision_id","keyword")
);
--> statement-breakpoint
CREATE TABLE "app"."shop_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"state" varchar(16) DEFAULT 'draft' NOT NULL,
	"name_zh" varchar(200),
	"name_en" varchar(200),
	"company_name" varchar(200),
	"description" varchar(4000),
	"district_id" uuid,
	"floor_id" uuid,
	"booth_number" varchar(40),
	"collector_id" uuid NOT NULL,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	CONSTRAINT "shop_revisions_state_check" CHECK ("app"."shop_revisions"."state" in ('draft', 'submitted', 'returned', 'approved', 'archived')),
	CONSTRAINT "shop_revisions_version_check" CHECK ("app"."shop_revisions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lifecycle" varchar(16) DEFAULT 'active' NOT NULL,
	"published_revision_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shops_lifecycle_check" CHECK ("app"."shops"."lifecycle" in ('active', 'moved', 'closed', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "app"."categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "app"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."collection_sessions" ADD CONSTRAINT "collection_sessions_collector_id_app_users_id_fk" FOREIGN KEY ("collector_id") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."collection_sessions" ADD CONSTRAINT "collection_sessions_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "app"."districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."collection_sessions" ADD CONSTRAINT "collection_sessions_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "app"."floors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."collection_sessions" ADD CONSTRAINT "collection_sessions_default_category_id_categories_id_fk" FOREIGN KEY ("default_category_id") REFERENCES "app"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."collector_policies" ADD CONSTRAINT "collector_policies_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."collector_policies" ADD CONSTRAINT "collector_policies_changed_by_app_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contact_channels" ADD CONSTRAINT "contact_channels_revision_id_shop_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "app"."shop_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contact_channels" ADD CONSTRAINT "contact_channels_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "app"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contact_channels" ADD CONSTRAINT "contact_channels_revision_contact_fk" FOREIGN KEY ("revision_id","contact_id") REFERENCES "app"."revision_contacts"("revision_id","contact_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contacts" ADD CONSTRAINT "contacts_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."districts" ADD CONSTRAINT "districts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "app"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."floors" ADD CONSTRAINT "floors_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "app"."districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."record_grants" ADD CONSTRAINT "record_grants_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."record_grants" ADD CONSTRAINT "record_grants_revision_id_shop_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "app"."shop_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."record_grants" ADD CONSTRAINT "record_grants_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revision_categories" ADD CONSTRAINT "revision_categories_revision_id_shop_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "app"."shop_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revision_categories" ADD CONSTRAINT "revision_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revision_contacts" ADD CONSTRAINT "revision_contacts_revision_id_shop_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "app"."shop_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revision_contacts" ADD CONSTRAINT "revision_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "app"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revision_keywords" ADD CONSTRAINT "revision_keywords_revision_id_shop_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "app"."shop_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shop_revisions" ADD CONSTRAINT "shop_revisions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "app"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shop_revisions" ADD CONSTRAINT "shop_revisions_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "app"."districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shop_revisions" ADD CONSTRAINT "shop_revisions_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "app"."floors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shop_revisions" ADD CONSTRAINT "shop_revisions_collector_id_app_users_id_fk" FOREIGN KEY ("collector_id") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shop_revisions" ADD CONSTRAINT "shop_revisions_session_id_collection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app"."collection_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shop_revisions" ADD CONSTRAINT "shop_revisions_reviewed_by_app_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shops" ADD CONSTRAINT "shops_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "app"."categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_sessions_open_key" ON "app"."collection_sessions" USING btree ("collector_id") WHERE "app"."collection_sessions"."finished_at" is null;--> statement-breakpoint
CREATE INDEX "collection_sessions_collector_idx" ON "app"."collection_sessions" USING btree ("collector_id","started_at");--> statement-breakpoint
CREATE INDEX "contact_channels_revision_idx" ON "app"."contact_channels" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "districts_market_code_key" ON "app"."districts" USING btree ("market_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "floors_district_label_key" ON "app"."floors" USING btree ("district_id","label");--> statement-breakpoint
CREATE INDEX "record_grants_user_idx" ON "app"."record_grants" USING btree ("user_id","revision_id");--> statement-breakpoint
CREATE INDEX "record_grants_revision_idx" ON "app"."record_grants" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revision_categories_primary_key" ON "app"."revision_categories" USING btree ("revision_id") WHERE "app"."revision_categories"."is_primary";--> statement-breakpoint
CREATE INDEX "revision_categories_category_idx" ON "app"."revision_categories" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revision_contacts_primary_key" ON "app"."revision_contacts" USING btree ("revision_id") WHERE "app"."revision_contacts"."is_primary";--> statement-breakpoint
CREATE INDEX "revision_contacts_contact_idx" ON "app"."revision_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "shop_revisions_shop_idx" ON "app"."shop_revisions" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "shop_revisions_collector_idx" ON "app"."shop_revisions" USING btree ("collector_id","state","created_at");--> statement-breakpoint
CREATE INDEX "shop_revisions_session_idx" ON "app"."shop_revisions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "shops_published_idx" ON "app"."shops" USING btree ("published_revision_id","lifecycle");