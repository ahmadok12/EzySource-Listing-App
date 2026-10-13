CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"state" varchar(16) DEFAULT 'active' NOT NULL,
	"authz_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_state_check" CHECK ("app"."app_users"."state" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "app"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_label" varchar(80),
	"action" varchar(80) NOT NULL,
	"target_type" varchar(40) NOT NULL,
	"target_id" uuid,
	"outcome" varchar(16) NOT NULL,
	"policy_version" integer,
	"request_id" varchar(64),
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_outcome_check" CHECK ("app"."audit_events"."outcome" in ('success', 'denied', 'failed')),
	CONSTRAINT "audit_events_actor_check" CHECK ("app"."audit_events"."actor_id" is not null or "app"."audit_events"."actor_label" is not null)
);
--> statement-breakpoint
CREATE TABLE "app"."auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_subject" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."idempotency_keys" (
	"actor_id" uuid NOT NULL,
	"operation" varchar(80) NOT NULL,
	"key" varchar(128) NOT NULL,
	"payload_hash" varchar(128) NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"result_reference" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_actor_id_operation_key_pk" PRIMARY KEY("actor_id","operation","key"),
	CONSTRAINT "idempotency_keys_state_check" CHECK ("app"."idempotency_keys"."state" in ('pending', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" varchar(128),
	"state" varchar(16) DEFAULT 'staged' NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"uploader_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_kind_check" CHECK ("app"."media_assets"."kind" in ('image', 'audio', 'pdf')),
	CONSTRAINT "media_assets_state_check" CHECK ("app"."media_assets"."state" in ('staged', 'uploaded', 'validated', 'rejected')),
	CONSTRAINT "media_assets_size_check" CHECK ("app"."media_assets"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."staff_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "staff_roles_role_check" CHECK ("app"."staff_roles"."role" in ('owner', 'admin', 'collector', 'mapper', 'sourcing'))
);
--> statement-breakpoint
ALTER TABLE "app"."audit_events" ADD CONSTRAINT "audit_events_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_identities" ADD CONSTRAINT "auth_identities_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."media_assets" ADD CONSTRAINT "media_assets_uploader_id_app_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."staff_roles" ADD CONSTRAINT "staff_roles_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."staff_roles" ADD CONSTRAINT "staff_roles_granted_by_app_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "app"."audit_events" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "app"."audit_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_subject_key" ON "app"."auth_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "auth_identities_user_id_idx" ON "app"."auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "app"."idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_object_key_key" ON "app"."media_assets" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "media_assets_uploader_idx" ON "app"."media_assets" USING btree ("uploader_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_roles_active_user_role_key" ON "app"."staff_roles" USING btree ("user_id","role") WHERE "app"."staff_roles"."revoked_at" is null;