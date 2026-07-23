const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    try {
        console.log('--- Fetching SS Plaza ---');
        const propertyId = '79ba1aa5-bf91-4956-9dbe-ce9986790b53';
        
        const { data: meters, error: mError } = await supabase
            .from('electricity_meters')
            .select('id, name, meter_type')
            .eq('property_id', propertyId);
        
        if (mError) throw mError;
        
        const { data: readings, error: rError } = await supabase
            .from('electricity_readings')
            .select('meter_id, final_units, computed_units, computed_cost')
            .eq('property_id', propertyId);
            
        if (rError) throw rError;
        
        const meterStats = meters.map(m => {
            const mReadings = readings.filter(r => r.meter_id === m.id);
            const totalUnits = mReadings.reduce((sum, r) => sum + (Number(r.final_units) || Number(r.computed_units) || 0), 0);
            const totalCost = mReadings.reduce((sum, r) => sum + (Number(r.computed_cost) || 0), 0);
            return {
                name: m.name,
                type: m.meter_type,
                readingsCount: mReadings.length,
                totalUnits,
                totalCost
            };
        });
        
        console.table(meterStats.sort((a,b) => b.totalUnits - a.totalUnits));
        
    } catch (e) {
        console.error(e);
    }
}

check();
