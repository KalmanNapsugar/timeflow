/**
 * Eszköz (equipment) erőforrásokra vonatkozó segédfüggvények.
 *
 * Szabályok:
 *  - Egy szolgáltatás eszközigényei = a service_resources sorok azon csoportjai, ahol
 *    minden erőforrás type='equipment'. (Helyszín-csoportokra ezt nem alkalmazzuk.)
 *  - Egy eszközcsoport teljesül, ha legalább egy benne lévő eszköz szabad.
 *  - Egy eszköz "biztosan használatban" egy adott foglalás alatt, ha a foglalás
 *    szolgáltatásában van olyan eszközcsoport, amelynek egyetlen tagja az eszköz.
 *    (Több opcióval bíró OR-csoportnál nem tudjuk, melyiket választotta a rendszer
 *    ténylegesen → konzervatív becslés: nem blokkoljuk.)
 *  - Egy szolgáltatás csak olyan helyszínre (szoba/szék) foglalható, amely
 *    equipment_locations szerint tartalmazza a foglaláshoz választott eszközt.
 */

export type EquipmentGroup = string[]; // equipment resource id-k

/** A szolgáltatás eszközcsoportjai (csak teljesen eszközből álló group_no-k). */
export function extractEquipmentGroups(
  serviceResources: { resource_id: string; group_no: number }[],
  resourceTypes: Map<string, string>,
): EquipmentGroup[] {
  const byGroup = new Map<number, string[]>();
  for (const r of serviceResources) {
    if (!byGroup.has(r.group_no)) byGroup.set(r.group_no, []);
    byGroup.get(r.group_no)!.push(r.resource_id);
  }
  const out: EquipmentGroup[] = [];
  for (const [, ids] of Array.from(byGroup.entries()).sort((a, b) => a[0] - b[0])) {
    const uniq = Array.from(new Set(ids));
    if (uniq.length === 0) continue;
    const allEquip = uniq.every((rid) => resourceTypes.get(rid) === "equipment");
    if (allEquip) out.push(uniq);
  }
  return out;
}

/** Egy szolgáltatás "biztosan használt" eszközei = egyelemű eszközcsoportok tagjai. */
export function definitelyUsedEquipment(groups: EquipmentGroup[]): Set<string> {
  const out = new Set<string>();
  for (const g of groups) if (g.length === 1) out.add(g[0]);
  return out;
}

/** Igaz, ha minden eszközcsoporthoz létezik szabad eszköz, amely engedélyezett a megadott helyszínen. */
export function locationSupportsAllEquipmentGroups(
  locationId: string,
  equipmentGroups: EquipmentGroup[],
  blockedEquipment: Set<string>,
  equipmentLocations: Map<string, Set<string>>,
): boolean {
  for (const g of equipmentGroups) {
    const ok = g.some((eqId) => {
      if (blockedEquipment.has(eqId)) return false;
      const allowed = equipmentLocations.get(eqId);
      // Ha az eszközhöz nincs egy helyszín sem regisztrálva, akkor sehol nem foglalható.
      if (!allowed || allowed.size === 0) return false;
      return allowed.has(locationId);
    });
    if (!ok) return false;
  }
  return true;
}
