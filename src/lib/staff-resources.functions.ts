import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const WeeklyPattern = z.record(
  z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  z.array(z.tuple([z.string(), z.string()])).nullable(),
).optional();

const UpsertInput = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  staffProfileId: z.string().uuid(),
  resourceId: z.string().uuid(),
  kind: z.enum(["always", "weekly", "window"]),
  weeklyPattern: WeeklyPattern,
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  active: z.boolean().default(true),
});

export const listStaffResourceAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ organizationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("staff_resource_assignments")
      .select("*, staff_profiles(display_name), resources(name, type)")
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertStaffResourceAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpsertInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const payload = {
      organization_id: data.organizationId,
      staff_profile_id: data.staffProfileId,
      resource_id: data.resourceId,
      kind: data.kind,
      weekly_pattern_json: data.kind === "weekly" ? (data.weeklyPattern ?? null) : null,
      starts_at: data.kind === "window" ? data.startsAt : null,
      ends_at: data.kind === "window" ? data.endsAt : null,
      active: data.active,
    };
    if (data.id) {
      const { error } = await supabase.from("staff_resource_assignments")
        .update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: row, error } = await supabase.from("staff_resource_assignments")
        .insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      return { id: row.id };
    }
  });

export const deleteStaffResourceAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("staff_resource_assignments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
