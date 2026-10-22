import { validatePlanningSnapshot, type SeatingPlan } from '@wyreup/core/execution';

export function emptySeatingPlan(): SeatingPlan { return { version: 1, kind: 'seating', guests: [], tables: [], assignments: [] }; }
export function editSeatingPlan(plan: SeatingPlan, edit: (draft: SeatingPlan) => void): SeatingPlan {
  const draft = validatePlanningSnapshot(plan, 'seating') as SeatingPlan;
  edit(draft);
  return validatePlanningSnapshot(draft, 'seating') as SeatingPlan;
}
export function assignSeat(plan: SeatingPlan, guestId: string, tableId: string): SeatingPlan {
  return editSeatingPlan(plan, draft => { draft.assignments = draft.assignments.filter(a => a.guestId !== guestId); if (tableId) draft.assignments.push({ guestId, tableId }); });
}
export function removeSeatingItem(plan: SeatingPlan, id: string, kind: 'guest' | 'table'): SeatingPlan {
  return editSeatingPlan(plan, draft => {
    if (kind === 'guest') draft.guests = draft.guests.filter(g => g.id !== id); else draft.tables = draft.tables.filter(t => t.id !== id);
    draft.assignments = draft.assignments.filter(a => kind === 'guest' ? a.guestId !== id : a.tableId !== id);
  });
}
