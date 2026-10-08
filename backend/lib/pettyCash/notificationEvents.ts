import { z } from 'zod';
import { PC_NOTIFICATION_EVENTS } from '@/frontend/lib/notifications/pettyCashTemplates';
const uuid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const amount=z.string().regex(/^\d{1,14}\.\d{2}$/);
export const pcNotificationPayload=z.object({schema_version:z.literal(1),activity_id:uuid,organization_id:uuid,property_id:uuid,request_id:uuid,request_no:z.string().min(1),requester_id:uuid,assigned_allocator_id:uuid.nullable(),assigned_approver_id:uuid.nullable(),actor_id:uuid,action:z.string(),to_status:z.string(),expense_id:uuid.nullable(),occurred_at:z.string().datetime({offset:true}),request_version:z.number().int(),payment_date:z.string().nullable(),expense_date:z.string().nullable(),review_status:z.string().nullable(),amounts:z.object({requested:amount,allocated:amount,approved:amount,paid:amount,spent:amount,returned:amount,remaining:amount,expense:amount.nullable(),return_delta:amount.nullable()})});
export type PcEventPayload=z.infer<typeof pcNotificationPayload>;
export function pcEventDefinition(eventType: string){return PC_NOTIFICATION_EVENTS.find(event=>event.eventType===eventType);}
