import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bootstrapOwner } from "../src/bootstrap-owner";
import { appUsers, auditEvents, staffRoles } from "../src/schema";
import { adminUrl, createTestDatabase, type TestDatabase } from "./harness";

describe.skipIf(!adminUrl)("database security (specs/12)", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl!);
  }, 60_000);

  afterAll(async () => {
    await t?.drop();
  });

  async function newUser(name = "Collector") {
    const [user] = await t.runtime.db
      .insert(appUsers)
      .values({ displayName: name })
      .returning({ id: appUsers.id });
    return user!.id;
  }

  describe("schema", () => {
    it("enables row level security on every application table", async () => {
      const rows = await t.superSql<{ relname: string; relrowsecurity: boolean }[]>`
        select c.relname, c.relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relkind = 'r'`;
      expect(rows.length).toBeGreaterThanOrEqual(6);
      expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
    });

    it("keeps application tables out of the public schema", async () => {
      const rows = await t.superSql`
        select tablename from pg_tables where schemaname = 'public'`;
      expect(rows).toEqual([]);
    });
  });

  describe.each(["anon", "authenticated"])("browser-facing role %s", (role) => {
    it("has no access to the app schema, which covers tables added later", async () => {
      const [row] = await t.superSql<{ usage: boolean }[]>`
        select has_schema_privilege(${role}, 'app', 'USAGE') as usage`;
      expect(row!.usage).toBe(false);
    });

    it("cannot read or write application tables", async () => {
      await expect(
        t.superSql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx.unsafe("select * from app.app_users");
        }),
      ).rejects.toThrow(/permission denied/);

      await expect(
        t.superSql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx.unsafe("insert into app.staff_roles (user_id, role) values (gen_random_uuid(), 'owner')");
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe("API runtime role", () => {
    it("can create users and non-owner staff roles", async () => {
      const userId = await newUser();
      await t.runtime.db.insert(staffRoles).values({ userId, role: "collector" });
      const roles = await t.runtime.db.select().from(staffRoles).where(eq(staffRoles.userId, userId));
      expect(roles.map((r) => r.role)).toEqual(["collector"]);
    });

    it("cannot grant the owner role", async () => {
      const userId = await newUser("Would-be owner");
      await expect(
        t.runtime.db.insert(staffRoles).values({ userId, role: "owner" }),
      ).rejects.toThrow();
    });

    it("cannot promote an existing role to owner", async () => {
      const userId = await newUser();
      await t.runtime.db.insert(staffRoles).values({ userId, role: "admin" });
      await expect(
        t.runtime.db.update(staffRoles).set({ role: "owner" }).where(eq(staffRoles.userId, userId)),
      ).rejects.toThrow();
    });

    it("cannot revoke or alter an owner role", async () => {
      const ownerId = await newUser("Owner");
      await t.migration.db.insert(staffRoles).values({ userId: ownerId, role: "owner" });
      await t.runtime.db
        .update(staffRoles)
        .set({ revokedAt: new Date() })
        .where(eq(staffRoles.userId, ownerId));
      const [role] = await t.runtime.db.select().from(staffRoles).where(eq(staffRoles.userId, ownerId));
      expect(role!.revokedAt).toBeNull();
    });

    it("cannot delete users or staff roles", async () => {
      await expect(t.runtime.sql`delete from app.staff_roles`).rejects.toThrow(/permission denied/);
      await expect(t.runtime.sql`delete from app.app_users`).rejects.toThrow(/permission denied/);
    });

    it("can append audit events but never change or remove them", async () => {
      const [event] = await t.runtime.db
        .insert(auditEvents)
        .values({ actorLabel: "test", action: "test.event", targetType: "test", outcome: "success" })
        .returning({ id: auditEvents.id });
      expect(event!.id).toBeTruthy();
      await expect(
        t.runtime.sql`update app.audit_events set outcome = 'denied'`,
      ).rejects.toThrow(/permission denied/);
      await expect(t.runtime.sql`delete from app.audit_events`).rejects.toThrow(/permission denied/);
      await expect(t.runtime.sql`truncate app.audit_events`).rejects.toThrow(/permission denied/);
    });

    it("cannot change the schema or its own privileges", async () => {
      await expect(t.runtime.sql`create table app.sneaky (id int)`).rejects.toThrow(/permission denied/);
      await expect(
        t.runtime.sql`alter table app.staff_roles disable row level security`,
      ).rejects.toThrow(/must be owner/);
      await expect(
        t.runtime.sql`drop policy runtime_insert_non_owner on app.staff_roles`,
      ).rejects.toThrow(/must be owner/);
      // A GRANT without privileges only warns, so check the privilege is still absent.
      await t.runtime.sql.unsafe("grant delete on app.audit_events to ezysource_runtime");
      const [privilege] = await t.superSql<{ allowed: boolean }[]>`
        select has_table_privilege('ezysource_runtime', 'app.audit_events', 'DELETE') as allowed`;
      expect(privilege!.allowed).toBe(false);
      await expect(t.runtime.sql`set role postgres`).rejects.toThrow(/permission denied/);
    });
  });

  describe("owner bootstrap", () => {
    it("creates the first owner once, with an audit event", async () => {
      // Clear any owner rows from earlier tests using migration credentials.
      await t.migration.sql`delete from app.staff_roles where role = 'owner'`;

      const first = await bootstrapOwner(t.migration.db, {
        provider: "supabase",
        providerSubject: "11111111-1111-1111-1111-111111111111",
        displayName: "Ahmad",
      });
      expect(first.status).toBe("created");

      const again = await bootstrapOwner(t.migration.db, {
        provider: "supabase",
        providerSubject: "11111111-1111-1111-1111-111111111111",
        displayName: "Ahmad",
      });
      expect(again).toEqual({ status: "already_owner", userId: (first as { userId: string }).userId });

      const audit = await t.migration.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "staff_role.owner_bootstrap"));
      expect(audit).toHaveLength(1);
      expect(audit[0]!.targetId).toBe((first as { userId: string }).userId);
    });

    it("refuses a second owner unless explicitly allowed", async () => {
      const second = {
        provider: "supabase",
        providerSubject: "22222222-2222-2222-2222-222222222222",
        displayName: "Someone else",
      };
      expect(await bootstrapOwner(t.migration.db, second)).toEqual({ status: "owner_exists" });
      expect((await bootstrapOwner(t.migration.db, { ...second, allowAdditional: true })).status).toBe(
        "created",
      );
    });

    it("cannot run with the API's runtime credentials", async () => {
      await expect(
        bootstrapOwner(t.runtime.db, {
          provider: "supabase",
          providerSubject: "33333333-3333-3333-3333-333333333333",
          displayName: "Attacker",
          allowAdditional: true,
        }),
      ).rejects.toThrow();
    });
  });
});
