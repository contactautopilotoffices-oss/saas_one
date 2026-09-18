-- Supabase Storage Setup for HR Ticket Attachments

-- 1. Create the Storage Bucket for HR Ticket Attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'hr-ticket-attachments',
    'hr-ticket-attachments',
    true,
    52428800, -- 50 MB limit per file
    ARRAY[
        'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
        'application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 52428800;

-- 2. Allow Public Access to view/download HR ticket attachments
DROP POLICY IF EXISTS "Public Read Access for HR Ticket Attachments" ON storage.objects;
CREATE POLICY "Public Read Access for HR Ticket Attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'hr-ticket-attachments');

-- 3. Allow Authenticated Users to upload HR ticket attachments
DROP POLICY IF EXISTS "Authenticated Users Upload HR Ticket Attachments" ON storage.objects;
CREATE POLICY "Authenticated Users Upload HR Ticket Attachments"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'hr-ticket-attachments'
    AND auth.role() = 'authenticated'
);

-- 4. Allow Authenticated Users / Owners to delete their attachments if needed
DROP POLICY IF EXISTS "Authenticated Users Delete HR Ticket Attachments" ON storage.objects;
CREATE POLICY "Authenticated Users Delete HR Ticket Attachments"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'hr-ticket-attachments'
    AND auth.role() = 'authenticated'
);
