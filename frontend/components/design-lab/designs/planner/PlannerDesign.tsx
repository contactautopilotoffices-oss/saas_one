'use client';

import type { DesignProps } from '../../DesignLab';

export default function PlannerDesign({ screen }: DesignProps) {
    return <div className="p-10 text-[15px]">This design is next in the build queue ({screen}).</div>;
}
