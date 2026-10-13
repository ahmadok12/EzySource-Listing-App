import { Hono } from "hono";
import type { StaffListResponse } from "@ezysource/domain";
import type { AppBindings } from "../env";
import { authenticate, requireStaff } from "../middleware/auth";

export const adminRoutes = new Hono<AppBindings>()
  .use("/admin/*", authenticate, requireStaff("owner", "admin"))
  .get("/admin/staff", async (c) => {
    const staff = await c.get("services").users!.listStaff();
    const body: StaffListResponse = {
      staff: staff.map((s) => ({
        userId: s.id,
        displayName: s.displayName,
        state: s.state,
        roles: s.roles,
      })),
    };
    return c.json(body);
  });
