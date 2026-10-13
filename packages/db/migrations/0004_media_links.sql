CREATE TABLE "app"."media_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"purpose" varchar(20) NOT NULL,
	"contact_id" uuid,
	"caption" varchar(200),
	"visibility" varchar(16) NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_links_purpose_check" CHECK ("app"."media_links"."purpose" in ('sign', 'overview', 'section', 'voice', 'card_front', 'card_back', 'wechat_qr', 'whatsapp_qr')),
	CONSTRAINT "media_links_visibility_check" CHECK ("app"."media_links"."visibility" in ('subscriber', 'staff', 'internal'))
);
--> statement-breakpoint
ALTER TABLE "app"."media_assets" DROP CONSTRAINT "media_assets_state_check";--> statement-breakpoint
ALTER TABLE "app"."media_links" ADD CONSTRAINT "media_links_revision_id_shop_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "app"."shop_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."media_links" ADD CONSTRAINT "media_links_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "app"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."media_links" ADD CONSTRAINT "media_links_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."media_links" ADD CONSTRAINT "media_links_revision_contact_fk" FOREIGN KEY ("revision_id","contact_id") REFERENCES "app"."revision_contacts"("revision_id","contact_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_links_revision_media_key" ON "app"."media_links" USING btree ("revision_id","media_id");--> statement-breakpoint
CREATE INDEX "media_links_revision_idx" ON "app"."media_links" USING btree ("revision_id","purpose","order_index");--> statement-breakpoint
CREATE INDEX "media_links_media_idx" ON "app"."media_links" USING btree ("media_id");--> statement-breakpoint
ALTER TABLE "app"."media_assets" ADD CONSTRAINT "media_assets_state_check" CHECK ("app"."media_assets"."state" in ('staged', 'uploaded', 'validated', 'rejected', 'removed'));