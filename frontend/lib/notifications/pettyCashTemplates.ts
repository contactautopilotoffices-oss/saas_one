export interface PcTemplate { name: string; body: string; params: string[]; samples: string[] }
export interface PcNotificationEvent { action: string; name: string; key: string; eventType: string; templateName: string; nextAction: string; amountSource: string; audience: string; stage: string | null; description: string; hasContextual?: { assignee?: boolean; requester?: boolean; approver?: boolean }; assigneeLabel?: string }
export const PC_NOTIFICATION_TEMPLATES: PcTemplate[] = [
  {
    "name": "pc_action_required_v1",
    "body": "Hello {{1}},\n\nA petty cash request requires your action.\nRequest: {{2}}\nProperty: {{3}}\nRequested by: {{4}}\nAmount: {{5}}\nNext step: {{6}}\n\nOpen request: {{7}}\nPlease sign in to Autopilot to review this request.\nThank you.",
    "params": [
      "user_name",
      "request_no",
      "property_name",
      "requester_name",
      "event_amount",
      "next_action",
      "request_url"
    ],
    "samples": [
      "Asha",
      "PC-2026-00003",
      "Mafatlal Chambers",
      "Ravi",
      "INR 150.00",
      "Review the allocation",
      "https://fms-dev-saas-one.vercel.app/211e1330-ad83-446d-941f-dcea48396798/petty-cash?request_id=11111111-1111-4111-8111-111111111111"
    ]
  },
  {
    "name": "pc_request_update_v1",
    "body": "Hello {{1}},\n\nA petty cash request has a status update.\nRequest: {{2}}\nProperty: {{3}}\nStatus: {{4}}\nUpdated on: {{5}}\n\nOpen request: {{6}}\nPlease sign in to Autopilot to view the details and any remarks.\nThank you.",
    "params": [
      "user_name",
      "request_no",
      "property_name",
      "status_label",
      "event_date",
      "request_url"
    ],
    "samples": [
      "Ravi",
      "PC-2026-00003",
      "Mafatlal Chambers",
      "Sent back",
      "06 Oct 2026, 12:00 IST",
      "https://fms-dev-saas-one.vercel.app/211e1330-ad83-446d-941f-dcea48396798/petty-cash?request_id=11111111-1111-4111-8111-111111111111"
    ]
  },
  {
    "name": "pc_wallet_credited_v1",
    "body": "Hello {{1}},\n\nPetty cash has been added to your wallet.\nRequest: {{2}}\nProperty: {{3}}\nAmount received: {{4}}\nPayment date: {{5}}\nRemaining cash for this request: {{6}}\n\nYou can record partial expenses. Bills and receipts are optional.\nOpen request: {{7}}\nPlease sign in to Autopilot to record your expenses.\nThank you.",
    "params": [
      "user_name",
      "request_no",
      "property_name",
      "paid_amount",
      "payment_date",
      "request_remaining",
      "request_url"
    ],
    "samples": [
      "Ravi",
      "PC-2026-00003",
      "Mafatlal Chambers",
      "INR 150.00",
      "06 Oct 2026",
      "INR 150.00",
      "https://fms-dev-saas-one.vercel.app/211e1330-ad83-446d-941f-dcea48396798/petty-cash?request_id=11111111-1111-4111-8111-111111111111"
    ]
  },
  {
    "name": "pc_expense_review_required_v1",
    "body": "Hello {{1}},\n\nA petty cash expense is awaiting Accounts review.\nRequest: {{2}}\nProperty: {{3}}\nRecorded by: {{4}}\nExpense amount: {{5}}\nExpense date: {{6}}\n\nBills and receipts are optional.\nOpen request: {{7}}\nPlease sign in to Autopilot to review this expense.\nThank you.",
    "params": [
      "user_name",
      "request_no",
      "property_name",
      "requester_name",
      "expense_amount",
      "expense_date",
      "request_url"
    ],
    "samples": [
      "Meera",
      "PC-2026-00003",
      "Mafatlal Chambers",
      "Ravi",
      "INR 100.00",
      "06 Oct 2026",
      "https://fms-dev-saas-one.vercel.app/211e1330-ad83-446d-941f-dcea48396798/petty-cash?request_id=11111111-1111-4111-8111-111111111111"
    ]
  },
  {
    "name": "pc_expense_review_result_v1",
    "body": "Hello {{1}},\n\nYour petty cash expense has been reviewed.\nRequest: {{2}}\nProperty: {{3}}\nExpense amount: {{4}}\nExpense date: {{5}}\nReview result: {{6}}\n\nOpen request: {{7}}\nPlease sign in to Autopilot to view the review remarks and any required correction.\nThank you.",
    "params": [
      "user_name",
      "request_no",
      "property_name",
      "expense_amount",
      "expense_date",
      "review_status",
      "request_url"
    ],
    "samples": [
      "Ravi",
      "PC-2026-00003",
      "Mafatlal Chambers",
      "INR 100.00",
      "06 Oct 2026",
      "Accepted",
      "https://fms-dev-saas-one.vercel.app/211e1330-ad83-446d-941f-dcea48396798/petty-cash?request_id=11111111-1111-4111-8111-111111111111"
    ]
  },
  {
    "name": "pc_cash_return_v1",
    "body": "Hello {{1}},\n\nAccounts has confirmed your petty cash return.\nRequest: {{2}}\nProperty: {{3}}\nAmount returned: {{4}}\nConfirmed on: {{5}}\nRemaining cash for this request: {{6}}\n\nOpen request: {{7}}\nPlease sign in to Autopilot to view the return record.\nThank you.",
    "params": [
      "user_name",
      "request_no",
      "property_name",
      "returned_amount",
      "event_date",
      "request_remaining",
      "request_url"
    ],
    "samples": [
      "Ravi",
      "PC-2026-00003",
      "Mafatlal Chambers",
      "INR 50.00",
      "06 Oct 2026, 12:00 IST",
      "INR 0.00",
      "https://fms-dev-saas-one.vercel.app/211e1330-ad83-446d-941f-dcea48396798/petty-cash?request_id=11111111-1111-4111-8111-111111111111"
    ]
  },
  {
    "name": "pc_settlement_closed_v1",
    "body": "Hello {{1}},\n\nYour petty cash settlement has been closed.\nRequest: {{2}}\nProperty: {{3}}\nTotal received: {{4}}\nTotal spent: {{5}}\nTotal returned: {{6}}\nClosed on: {{7}}\n\nOpen request: {{8}}\nPlease sign in to Autopilot to view the completed settlement.\nThank you.",
    "params": [
      "user_name",
      "request_no",
      "property_name",
      "paid_amount",
      "spent_amount",
      "total_returned",
      "event_date",
      "request_url"
    ],
    "samples": [
      "Ravi",
      "PC-2026-00003",
      "Mafatlal Chambers",
      "INR 150.00",
      "INR 100.00",
      "INR 50.00",
      "06 Oct 2026, 12:00 IST",
      "https://fms-dev-saas-one.vercel.app/211e1330-ad83-446d-941f-dcea48396798/petty-cash?request_id=11111111-1111-4111-8111-111111111111"
    ]
  }
];
export const PC_NOTIFICATION_EVENTS: PcNotificationEvent[] = [
  {
    "action": "submitted",
    "name": "Request submitted",
    "key": "petty_cash_submitted",
    "eventType": "PETTY_CASH_SUBMITTED",
    "templateName": "pc_action_required_v1",
    "nextAction": "Allocate the requested cash",
    "amountSource": "requested",
    "audience": "allocator",
    "stage": "submitted",
    "description": "Allocate the requested cash. Delivery follows your channel and recipient selections.",
    "hasContextual": {
      "assignee": true
    },
    "assigneeLabel": "Notify Assigned Allocator"
  },
  {
    "action": "allocate",
    "name": "Allocation completed",
    "key": "petty_cash_allocated",
    "eventType": "PETTY_CASH_ALLOCATED",
    "templateName": "pc_action_required_v1",
    "nextAction": "Review the allocation",
    "amountSource": "allocated",
    "audience": "approver",
    "stage": "pending_approval",
    "description": "Review the allocation. Delivery follows your channel and recipient selections.",
    "hasContextual": {
      "approver": true
    }
  },
  {
    "action": "approve",
    "name": "Request approved",
    "key": "petty_cash_approved",
    "eventType": "PETTY_CASH_APPROVED",
    "templateName": "pc_action_required_v1",
    "nextAction": "Record the external payment",
    "amountSource": "approved",
    "audience": "finance",
    "stage": "approved",
    "description": "Record the external payment. Delivery follows your channel and recipient selections."
  },
  {
    "action": "reject",
    "name": "Request rejected",
    "key": "petty_cash_rejected",
    "eventType": "PETTY_CASH_REJECTED",
    "templateName": "pc_request_update_v1",
    "nextAction": "View the rejection details",
    "amountSource": "requested",
    "audience": "requester",
    "stage": null,
    "description": "View the rejection details. Delivery follows your channel and recipient selections.",
    "hasContextual": {
      "requester": true
    }
  },
  {
    "action": "send_back",
    "name": "Request sent back",
    "key": "petty_cash_sent_back",
    "eventType": "PETTY_CASH_SENT_BACK",
    "templateName": "pc_request_update_v1",
    "nextAction": "Update and resubmit the request",
    "amountSource": "requested",
    "audience": "requester",
    "stage": null,
    "description": "Update and resubmit the request. Delivery follows your channel and recipient selections.",
    "hasContextual": {
      "requester": true
    }
  },
  {
    "action": "pay",
    "name": "Payment recorded",
    "key": "petty_cash_paid",
    "eventType": "PETTY_CASH_PAID",
    "templateName": "pc_wallet_credited_v1",
    "nextAction": "Record spending as it happens",
    "amountSource": "paid",
    "audience": "requester",
    "stage": null,
    "description": "Record spending as it happens. Delivery follows your channel and recipient selections.",
    "hasContextual": {
      "requester": true
    }
  },
  {
    "action": "expense_recorded",
    "name": "Expense recorded",
    "key": "petty_cash_expense_recorded",
    "eventType": "PETTY_CASH_EXPENSE_RECORDED",
    "templateName": "pc_expense_review_required_v1",
    "nextAction": "Review the expense",
    "amountSource": "expense",
    "audience": "finance",
    "stage": "funded",
    "description": "Review the expense. Delivery follows your channel and recipient selections."
  },
  {
    "action": "expense_accepted",
    "name": "Expense accepted",
    "key": "petty_cash_expense_accepted",
    "eventType": "PETTY_CASH_EXPENSE_ACCEPTED",
    "templateName": "pc_expense_review_result_v1",
    "nextAction": "View the accepted expense",
    "amountSource": "expense",
    "audience": "requester",
    "stage": null,
    "description": "View the accepted expense. Delivery follows your channel and recipient selections.",
    "hasContextual": {
      "requester": true
    }
  },
  {
    "action": "expense_rejected",
    "name": "Expense rejected",
    "key": "petty_cash_expense_rejected",
    "eventType": "PETTY_CASH_EXPENSE_REJECTED",
    "templateName": "pc_expense_review_result_v1",
    "nextAction": "Review remarks and correct the expense proof",
    "amountSource": "expense",
    "audience": "requester",
    "stage": null,
    "description": "Review remarks and correct the expense proof. Delivery follows your channel and recipient selections.",
    "hasContextual": {
      "requester": true
    }
  },
  {
    "action": "proof_corrected",
    "name": "Expense proof corrected",
    "key": "petty_cash_proof_corrected",
    "eventType": "PETTY_CASH_PROOF_CORRECTED",
    "templateName": "pc_expense_review_required_v1",
    "nextAction": "Review the corrected expense proof",
    "amountSource": "expense",
    "audience": "finance",
    "stage": "funded",
    "description": "Review the corrected expense proof. Delivery follows your channel and recipient selections."
  },
  {
    "action": "return",
    "name": "Cash return confirmed",
    "key": "petty_cash_return_confirmed",
    "eventType": "PETTY_CASH_RETURN_CONFIRMED",
    "templateName": "pc_cash_return_v1",
    "nextAction": "View the confirmed cash return",
    "amountSource": "return_delta",
    "audience": "requester",
    "stage": null,
    "description": "View the confirmed cash return. Delivery follows your channel and recipient selections.",
    "hasContextual": {
      "requester": true
    }
  },
  {
    "action": "settle",
    "name": "Settlement submitted",
    "key": "petty_cash_settlement_submitted",
    "eventType": "PETTY_CASH_SETTLEMENT_SUBMITTED",
    "templateName": "pc_action_required_v1",
    "nextAction": "Review all expenses and close the settlement",
    "amountSource": "paid",
    "audience": "finance",
    "stage": "settlement_submitted",
    "description": "Review all expenses and close the settlement. Delivery follows your channel and recipient selections."
  },
  {
    "action": "close",
    "name": "Settlement closed",
    "key": "petty_cash_closed",
    "eventType": "PETTY_CASH_CLOSED",
    "templateName": "pc_settlement_closed_v1",
    "nextAction": "View the completed settlement",
    "amountSource": "paid",
    "audience": "requester",
    "stage": null,
    "description": "View the completed settlement. Delivery follows your channel and recipient selections.",
    "hasContextual": {
      "requester": true
    }
  },
  {
    "action": "cancel",
    "name": "Request cancelled",
    "key": "petty_cash_cancelled",
    "eventType": "PETTY_CASH_CANCELLED",
    "templateName": "pc_request_update_v1",
    "nextAction": "View the cancelled request",
    "amountSource": "requested",
    "audience": "participants",
    "stage": null,
    "description": "View the cancelled request. Delivery follows your channel and recipient selections.",
    "hasContextual": {
      "requester": true,
      "assignee": true,
      "approver": true
    }
  },
  {
    "action": "reassign",
    "name": "Routing reassigned",
    "key": "petty_cash_routing_reassigned",
    "eventType": "PETTY_CASH_ROUTING_REASSIGNED",
    "templateName": "pc_action_required_v1",
    "nextAction": "Allocate this reassigned request",
    "amountSource": "requested",
    "audience": "allocator",
    "stage": "submitted",
    "description": "Allocate this reassigned request. Delivery follows your channel and recipient selections.",
    "hasContextual": {
      "assignee": true
    },
    "assigneeLabel": "Notify Assigned Allocator"
  }
];
export const PC_DEFAULT_RULES = Object.fromEntries(PC_NOTIFICATION_EVENTS.map(event => [event.key, { enabled: false, channels: {email:false,whatsapp:false,push:false,voice:false}, roles:[] as string[],user_ids:[] as string[],notify_assignee:false,notify_requester:false,notify_approver:false }]));
export const PC_EMPTY_CAMPAIGNS = Object.fromEntries(PC_NOTIFICATION_EVENTS.map(event => [event.key,{campaign_name:'',params:PC_NOTIFICATION_TEMPLATES.find(template=>template.name===event.templateName)!.params}]));
export function importPcCampaigns(current: Record<string, any>) { const result={...current}; for(const event of PC_NOTIFICATION_EVENTS) if(!current[event.key]?.campaign_name) result[event.key]={...current[event.key],campaign_name:event.templateName,params:PC_NOTIFICATION_TEMPLATES.find(t=>t.name===event.templateName)!.params}; return result; }

