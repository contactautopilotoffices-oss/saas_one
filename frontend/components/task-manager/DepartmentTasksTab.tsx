'use client';

import React from 'react';
import ProcurementTasksTab from '@/frontend/components/procurement/ProcurementTasksTab';

/**
 * The Tasks tab Procurement uses (Board, Team, Notifications, lock, delete), for ANY department.
 * No department is named here: for everyone except a superuser the server shows the signed-in person's OWN department,
 * so Tech, Procurement and any department added later all get the same screen with no per-department code.
 */
export default function DepartmentTasksTab() {
    return <ProcurementTasksTab departmentName="" />;
}
