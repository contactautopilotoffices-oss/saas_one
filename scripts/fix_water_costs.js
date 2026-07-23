const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixWaterCosts() {
    console.log('Fetching all water readings...');
    const { data: readings, error: readingsError } = await supabase
        .from('water_readings')
        .select('*');
        
    if (readingsError) {
        console.error('Error fetching readings:', readingsError);
        return;
    }
    
    console.log(`Found ${readings.length} readings. Fetching tariffs...`);
    const { data: tariffs, error: tariffsError } = await supabase
        .from('water_tariffs')
        .select('*')
        .order('effective_from', { ascending: false });
        
    if (tariffsError) {
        console.error('Error fetching tariffs:', tariffsError);
        return;
    }
    
    let updatedCount = 0;
    
    for (const reading of readings) {
        // Find applicable tariff for this reading's source and date
        const applicableTariff = tariffs.find(t => 
            t.source_id === reading.source_id && 
            t.effective_from <= reading.reading_date
        );
        
        let newRate = 0;
        let newTariffId = null;
        
        if (applicableTariff) {
            newRate = applicableTariff.rate_per_unit;
            newTariffId = applicableTariff.id;
        }
        
        const newCost = reading.quantity * newRate;
        
        // Only update if it's currently wrong (like 0 when rate > 0)
        if (reading.computed_cost !== newCost || reading.tariff_rate_used !== newRate) {
            console.log(`Fixing reading ${reading.id} (Date: ${reading.reading_date}): Rate ${reading.tariff_rate_used} -> ${newRate}, Cost ${reading.computed_cost} -> ${newCost}`);
            
            await supabase
                .from('water_readings')
                .update({ 
                    tariff_id: newTariffId, 
                    tariff_rate_used: newRate, 
                    computed_cost: newCost 
                })
                .eq('id', reading.id);
                
            updatedCount++;
        }
    }
    
    console.log(`Finished fixing ${updatedCount} readings.`);
}

fixWaterCosts();
