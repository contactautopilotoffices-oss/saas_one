import { createClient } from '@/frontend/utils/supabase/server';
import { redirect } from 'next/navigation';
import ScanQuickLog from '@/frontend/components/diesel/ScanQuickLog';

interface PageProps {
    params: Promise<{ generatorId: string }>;
}

export default async function ScanGeneratorPage({ params }: PageProps) {
    const { generatorId } = await params;
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        redirect(`/login?redirect=/scan/${generatorId}`);
    }

    const { data: generator, error: genError } = await supabase
        .from('generators')
        .select('*')
        .eq('id', generatorId)
        .single();

    if (genError || !generator) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
                <div className="max-w-sm text-center">
                    <p className="text-2xl font-black text-slate-900 mb-2">Tag not recognized</p>
                    <p className="text-sm text-slate-500 font-medium">
                        This NFC tag isn&apos;t linked to a generator in the system. Check the tag ID or contact your admin.
                    </p>
                </div>
            </div>
        );
    }

    const { data: property } = await supabase
        .from('properties')
        .select('id, name, code')
        .eq('id', generator.property_id)
        .single();

    return <ScanQuickLog generator={generator} property={property} />;
}
