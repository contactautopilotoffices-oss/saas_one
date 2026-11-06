'use client';

import ProctorHub from '@/frontend/components/proctor/ProctorHub';

/**
 * /proctor — standalone list of proctored tests. HR works from the
 * Assessments tab of the HR module instead; this page is where anyone
 * without the HR sidebar sees the tests open to them.
 */
export default function ProctorHubPage() {
    return <ProctorHub />;
}
