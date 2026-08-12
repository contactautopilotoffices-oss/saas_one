import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import sharp from 'sharp';

/**
 * POST /api/properties/[propertyId]/sop/templates/[templateId]/cad
 * Upload a CAD file (image, DWG, DXF) and convert to PNG for display.
 * PDF should be converted client-side to PNG before upload.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; templateId: string }> }
) {
    const { propertyId, templateId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Verify template belongs to property
        const { data: template, error: templateError } = await supabaseAdmin
            .from('sop_templates')
            .select('id')
            .eq('id', templateId)
            .eq('property_id', propertyId)
            .maybeSingle();

        if (templateError || !template) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'File is required' }, { status: 400 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
        const mimeType = file.type;

        let cadFileType: 'image' | 'dwg' | 'dxf' | 'pdf';
        let convertedPngBuffer: Buffer;

        // Determine file type
        if (['dwg'].includes(fileExt) || mimeType === 'application/acad' || mimeType === 'image/vnd.dwg') {
            cadFileType = 'dwg';
        } else if (['dxf'].includes(fileExt) || mimeType === 'application/dxf' || mimeType === 'image/vnd.dxf') {
            cadFileType = 'dxf';
        } else if (['pdf'].includes(fileExt) || mimeType === 'application/pdf') {
            cadFileType = 'pdf';
            return NextResponse.json(
                { error: 'Please convert PDF to PNG client-side before uploading. Use the provided PDF converter in the CAD modal.' },
                { status: 400 }
            );
        } else if (['png', 'jpg', 'jpeg', 'webp'].includes(fileExt) || mimeType.startsWith('image/')) {
            cadFileType = 'image';
        } else {
            return NextResponse.json(
                { error: 'Unsupported file type. Upload PNG, JPEG, WebP, DWG, or DXF.' },
                { status: 400 }
            );
        }

        // Convert to PNG
        if (cadFileType === 'image') {
            convertedPngBuffer = await sharp(buffer)
                .png({ quality: 90 })
                .toBuffer();
        } else {
            // DWG / DXF — use CloudConvert API
            const cloudConvertApiKey = process.env.CLOUDCONVERT_API_KEY;
            if (!cloudConvertApiKey) {
                return NextResponse.json(
                    { error: 'DWG/DXF conversion service is not configured. Please upload a PNG/PDF/image version of the CAD file.' },
                    { status: 503 }
                );
            }

            convertedPngBuffer = await convertCadWithCloudConvert(buffer, fileExt, cloudConvertApiKey);
        }

        // Upload original CAD file
        const timestamp = Date.now();
        const originalExt = cadFileType === 'image' ? (fileExt === 'jpg' ? 'jpeg' : fileExt) : fileExt;
        const originalPath = `sop-cad-files/${propertyId}/${templateId}/${timestamp}.${originalExt}`;
        const convertedPath = `sop-cad-images/${propertyId}/${templateId}/${timestamp}.png`;

        const { error: originalUploadError } = await supabaseAdmin.storage
            .from('sop-cad-files')
            .upload(originalPath, buffer, {
                contentType: mimeType || 'application/octet-stream',
                upsert: false,
            });

        if (originalUploadError) {
            return NextResponse.json({ error: originalUploadError.message }, { status: 500 });
        }

        const { error: convertedUploadError } = await supabaseAdmin.storage
            .from('sop-cad-images')
            .upload(convertedPath, convertedPngBuffer, {
                contentType: 'image/png',
                upsert: false,
            });

        if (convertedUploadError) {
            return NextResponse.json({ error: convertedUploadError.message }, { status: 500 });
        }

        const { data: originalPublic } = supabaseAdmin.storage
            .from('sop-cad-files')
            .getPublicUrl(originalPath);

        const { data: convertedPublic } = supabaseAdmin.storage
            .from('sop-cad-images')
            .getPublicUrl(convertedPath);

        // Update template
        const { error: updateError } = await supabaseAdmin
            .from('sop_templates')
            .update({
                cad_file_url: originalPublic.publicUrl,
                cad_file_type: cadFileType,
                cad_converted_image_url: convertedPublic.publicUrl,
                updated_at: new Date().toISOString(),
            })
            .eq('id', templateId);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            cadFileUrl: originalPublic.publicUrl,
            cadFileType: cadFileType,
            cadConvertedImageUrl: convertedPublic.publicUrl,
        }, { status: 201 });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

async function convertCadWithCloudConvert(buffer: Buffer, ext: string, apiKey: string): Promise<Buffer> {
    // Create a CloudConvert job: import → convert to png → export
    const jobResponse = await fetch('https://api.cloudconvert.com/v2/jobs', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tasks: {
                import: {
                    operation: 'import/upload',
                },
                convert: {
                    operation: 'convert',
                    input: 'import',
                    output_format: 'png',
                },
                export: {
                    operation: 'export/url',
                    input: 'convert',
                },
            },
        }),
    });

    if (!jobResponse.ok) {
        const errorText = await jobResponse.text();
        throw new Error(`CloudConvert job creation failed: ${errorText}`);
    }

    const jobData = await jobResponse.json();
    const jobId = jobData.data.id;
    const uploadTask = jobData.data.tasks.find((t: any) => t.name === 'import');
    const uploadUrl = uploadTask?.result?.form?.url;
    const uploadParams = uploadTask?.result?.form?.parameters;

    if (!uploadUrl || !uploadParams) {
        throw new Error('CloudConvert did not return upload URL');
    }

    // Upload file to CloudConvert
    const uploadFormData = new FormData();
    Object.entries(uploadParams).forEach(([key, value]) => {
        uploadFormData.append(key, value as string);
    });
    uploadFormData.append('file', new Blob([new Uint8Array(buffer)]), `cad.${ext}`);

    const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: uploadFormData,
    });

    if (!uploadResponse.ok) {
        throw new Error(`CloudConvert upload failed: ${uploadResponse.statusText}`);
    }

    // Poll for job completion
    let jobStatus = 'processing';
    let exportUrl: string | null = null;
    const maxAttempts = 30;
    const pollInterval = 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        const statusResponse = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });

        if (!statusResponse.ok) {
            throw new Error('Failed to check CloudConvert job status');
        }

        const statusData = await statusResponse.json();
        jobStatus = statusData.data.status;

        if (jobStatus === 'finished') {
            const exportTask = statusData.data.tasks.find((t: any) => t.name === 'export');
            exportUrl = exportTask?.result?.files?.[0]?.url;
            break;
        } else if (jobStatus === 'error') {
            throw new Error('CloudConvert job failed');
        }
    }

    if (jobStatus !== 'finished' || !exportUrl) {
        throw new Error('CloudConvert conversion timed out or failed');
    }

    // Download converted PNG
    const downloadResponse = await fetch(exportUrl);
    if (!downloadResponse.ok) {
        throw new Error('Failed to download converted file');
    }

    const convertedArrayBuffer = await downloadResponse.arrayBuffer();
    return Buffer.from(convertedArrayBuffer);
}
