/**
 * Upload file with XHR progress tracking
 * @param url - Upload endpoint
 * @param file - File to upload
 * @param fields - Additional form fields
 * @param onProgress - Progress callback (0-100)
 * @param retries - Number of retry attempts (default 2)
 */
export async function uploadWithProgress(
    url: string,
    file: File,
    fields: Record<string, string>,
    onProgress: (progress: number) => void,
    retries = 2
): Promise<{ url: string }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    resolve(data);
                } catch {
                    reject(new Error('Invalid response from server'));
                }
            } else {
                reject(new Error(`Upload failed: ${xhr.statusText}`));
            }
        });

        xhr.addEventListener('error', () => {
            reject(new Error('Network error during upload'));
        });

        xhr.addEventListener('timeout', () => {
            reject(new Error('Upload timed out'));
        });

        xhr.timeout = 120000; // 2 minutes

        const formData = new FormData();
        formData.append('file', file);
        Object.entries(fields).forEach(([key, value]) => {
            formData.append(key, value);
        });

        xhr.open('POST', url);
        xhr.send(formData);
    });
}