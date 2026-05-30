/**
 * Service ↔ Resource OR-csoport logika.
 * - Egy szolgáltatáshoz tartozó erőforrás-sorok `group_no`-val csoportokba szervezve:
 *   ('R1' VAGY 'R2') ÉS ('R3') ÉS ('R4' VAGY 'R5').
 * - Egy csoport "teljesül", ha legalább egy benne lévő erőforrás szabad.
 * - Minden csoportnak teljesülnie kell.
 *
 * Konzervatív becslés más, már létező foglalások erőforrás-fogyasztására:
 *   - a foglalás `resource_id`-ja "biztosan használatban"
 *   - a foglalás szolgáltatásának egyelemű csoportjai is "biztosan használatban"
 *   - többelemű csoportoknál nem tudjuk, melyiket választották, ezért nem feltételezzük blokkoltnak.
 */

export type ResourceGroup = string[];
export type ServiceResourceRow = { service_id: string; resource_id: string; group_no: number };

/** group_no szerinti csoportosítás → tömb-tömb */
export function groupResourceRows(rows: ServiceResourceRow[]): Map<string, ResourceGroup[]> {
  const byService = new Map<string, Map<number, string[]>>();
  for (const r of rows) {
    if (!byService.has(r.service_id)) byService.set(r.service_id, new Map());
    const m = byService.get(r.service_id)!;
    if (!m.has(r.group_no)) m.set(r.group_no, []);
    m.get(r.group_no)!.push(r.resource_id);
  }
  const out = new Map<string, ResourceGroup[]>();
  for (const [svcId, m] of byService) {
    const groups: ResourceGroup[] = [];
    for (const [, ids] of Array.from(m.entries()).sort((a, b) => a[0] - b[0])) {
      const uniq = Array.from(new Set(ids));
      if (uniq.length > 0) groups.push(uniq);
    }
    out.set(svcId, groups);
  }
  return out;
}

/** A más foglalások által biztosan elhasznált erőforrás-azonosítók */
export function definitelyConsumed(b: { resource_id: string | null; service_id: string }, groupsMap: Map<string, ResourceGroup[]>): string[] {
  const out: string[] = [];
  if (b.resource_id) out.push(b.resource_id);
  const grps = groupsMap.get(b.service_id) ?? [];
  for (const g of grps) if (g.length === 1) out.push(g[0]);
  return out;
}

/** Igaz, ha a `ourGroups` minden csoportjára van legalább egy erőforrás, ami NINCS blocked-ban. */
export function allGroupsHaveFreeResource(ourGroups: ResourceGroup[], blocked: Set<string>): boolean {
  if (ourGroups.length === 0) return true;
  return ourGroups.every((g) => g.some((rid) => !blocked.has(rid)));
}

/** Az ourGroups összes erőforrásának halmaza (új foglalás potenciálisan használt erőforrásai). */
export function allResourcesInGroups(groups: ResourceGroup[]): string[] {
  const s = new Set<string>();
  for (const g of groups) for (const r of g) s.add(r);
  return Array.from(s);
}
