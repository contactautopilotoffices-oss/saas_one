import { CheckCheck, PackagePlus, PenLine, Play, RotateCcw, Send, ThumbsDown, ThumbsUp, UserPlus, type LucideIcon } from 'lucide-react';
import { ACTION_LABELS, type LabModel, type TicketAction } from './useLabModel';

export const ACTION_ICONS: Record<TicketAction, LucideIcon> = {
    assign: UserPlus,
    reassign: UserPlus,
    start: Play,
    complete: CheckCheck,
    approval: Send,
    looks_good: ThumbsUp,
    request_changes: ThumbsDown,
    reopen: RotateCcw,
    material: PackagePlus,
    edit: PenLine,
};

/** Assign and Reassign open the drawer. Every other action is preview only in the lab. */
export function runAction(lab: LabModel, a: TicketAction) {
    if (a === 'assign' || a === 'reassign') lab.openDrawer();
    else lab.previewAction(ACTION_LABELS[a]);
}

export { ACTION_LABELS };
