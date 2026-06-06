import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/lib/supabase-admin-loader";

export const listEquipmentLocations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ organizationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("equipment_locations")
      .select("*")
      .eq("organization_id", data.organizationId);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const setEquipmentLocations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      organizationId: z.string().uuid(),
      equipmentResourceId: z.string().uuid(),
      locationResourceIds: z.array(z.string().uuid()),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    const { supabase } = context;
    // Ellenőrizzük az eszköz típusát
    const { data: eq } = await supabaseAdmin
      .from("resources").select("type, organization_id").eq("id", data.equipmentResourceId).single();
    if (!eq) throw new Error("Eszköz nem található.");
    if (eq.type !== "equipment") throw new Error("Csak eszköz típusú erőforráshoz rendelhetők helyszínek.");
    if (eq.organization_id !== data.organizationId) throw new Error("Hibás szervezet.");

    // Ellenőrizzük a helyszín típusokat (csak szoba/szék)
    if (data.locationResourceIds.length > 0) {
      const { data: locs } = await supabaseAdmin
        .from("resources").select("id, type, organization_id").in("id", data.locationResourceIds);
      for (const l of locs ?? []) {
        if ((l as any).organization_id !== data.organizationId) throw new Error("Hibás szervezet.");
        if (!["room", "chair"].includes((l as any).type)) {
          throw new Error("Eszköz csak szoba vagy szék típusú erőforráshoz rendelhető.");
        }
      }
    }

    // Töröljük a régieket és beszúrjuk az újakat
    const { error: delErr } = await supabase
      .from("equipment_locations")
      .delete()
      .eq("equipment_resource_id", data.equipmentResourceId);
    if (delErr) throw new Error(delErr.message);

    if (data.locationResourceIds.length > 0) {
      const rows = data.locationResourceIds.map((lid) => ({
        organization_id: data.organizationId,
        equipment_resource_id: data.equipmentResourceId,
        location_resource_id: lid,
      }));
      const { error: insErr } = await supabase.from("equipment_locations").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true };
  });
