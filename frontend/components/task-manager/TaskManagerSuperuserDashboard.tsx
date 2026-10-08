"use client";

import React from 'react';
import TaskAssignmentDashboard from './TaskAssignmentDashboard';

export default function TaskManagerSuperuserDashboard({ orgId }: { orgId?: string }) {
    return <TaskAssignmentDashboard orgId={orgId} isSuperuserView={true} />;
}
