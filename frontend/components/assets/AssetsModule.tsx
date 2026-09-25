'use client';

import { useState } from 'react';
import { PackageSearch, Tags, BarChart3 } from 'lucide-react';
import AssetRegisterView from './AssetRegisterView';
import AssetCategoriesPanel from './AssetCategoriesPanel';
import AssetReportsView from './AssetReportsView';

interface Props {
    organizationId: string;
    /** undefined = org-wide (org console); set = scoped to one property's tab */
    propertyId?: string;
    propertyName?: string;
    properties?: { id: string; name: string }[];
    canManage: boolean;
}

type Tab = 'register' | 'reports' | 'categories';

export default function AssetsModule({ organizationId, propertyId, propertyName, properties = [], canManage }: Props) {
    const [tab, setTab] = useState<Tab>('register');

    const tabs: { id: Tab; label: string; icon: any }[] = [
        { id: 'register', label: 'Asset Register', icon: PackageSearch },
        { id: 'reports', label: 'Reports', icon: BarChart3 },
        { id: 'categories', label: 'Categories', icon: Tags },
    ];

    return (
        <div className="flex flex-col h-full bg-white">
            <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-100 bg-white overflow-x-auto">
                {tabs.map((t) => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-t-xl transition-all border-b-2 whitespace-nowrap ${active ? 'text-primary border-primary bg-primary/5' : 'text-slate-500 border-transparent hover:text-slate-700'}`}
                        >
                            <Icon className="w-4 h-4" />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            <div className="flex-1 overflow-auto p-5">
                {tab === 'register' && (
                    <AssetRegisterView
                        organizationId={organizationId}
                        propertyId={propertyId}
                        propertyName={propertyName}
                        properties={properties}
                        canManage={canManage}
                    />
                )}
                {tab === 'reports' && <AssetReportsView organizationId={organizationId} propertyId={propertyId} />}
                {tab === 'categories' && <AssetCategoriesPanel organizationId={organizationId} canManage={canManage} />}
            </div>
        </div>
    );
}
