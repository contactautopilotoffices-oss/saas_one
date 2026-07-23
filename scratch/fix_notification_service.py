
import os

file_path = r'd:\Projects\saas_one\backend\services\NotificationService.ts'

with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Look for the gap between deepLink and .select
# Current state is something like:
# deepLink: `/procurement?tab=orders`,
#                 .select('*, properties(name)')

pattern_start = 'deepLink: `/procurement?tab=orders`,'
pattern_end = ".select('*, properties(name)')"

if pattern_start in content and pattern_end in content:
    print("Found patterns!")
    start_pos = content.find(pattern_start) + len(pattern_start)
    end_pos = content.find(pattern_end)
    
    insertion = """
                priority: 'HIGH',
            });
        } catch (err) {
            console.error('[NS] afterMaterialRequestAssigned error:', err);
        }
    }

    static async afterMaterialRequestStatusChanged(requestId: string, status: string) {
        try {
            const { data: request, error } = await supabaseAdmin
                """
    
    new_content = content[:start_pos] + insertion + content[end_pos:]
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("File fixed with string injection!")
else:
    print(f"Start pattern in content: {pattern_start in content}")
    print(f"End pattern in content: {pattern_end in content}")
    if not pattern_start in content:
        # Try to find what IS there
        print("First 1000 chars of file:")
        # Skip to where we expect the issue
        print(content[content.find('MATERIAL_REQUEST_ASSIGNED'):content.find('MATERIAL_REQUEST_ASSIGNED')+500])
