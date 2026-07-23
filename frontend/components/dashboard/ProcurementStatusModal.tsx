import React, { useState } from 'react';
import { Dialog, DialogOverlay, DialogContent } from '@reach/dialog';
import '@reach/dialog/styles.css';
import { X } from 'lucide-react';

interface StatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  onConfirm: (status: string, quotedPrice?: number, quotationUrl?: string) => Promise<void>;
}

export default function ProcurementStatusModal({ isOpen, onClose, requestId, onConfirm }: StatusModalProps) {
  const [status, setStatus] = useState('ordered');
  const [price, setPrice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    let quotationUrl: string | undefined;
    if (file) {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
      const res = await fetch(`/api/procurement/requests/${requestId}/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const errData = await res.json();
        console.error('Upload error:', errData);
        throw new Error(errData.error || 'Upload failed');
      }
      const data = await res.json();
      quotationUrl = data.url;
      setUploadedUrl(data.url);
      } catch (e: any) {
        setError(e.message);
        setUploading(false);
        return;
      }
      setUploading(false);
    }
    const quotedPrice = price ? parseFloat(price) : undefined;
    await onConfirm(status, quotedPrice, quotationUrl);
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onDismiss={onClose} aria-label="Update procurement status">
      <DialogOverlay className="fixed inset-0 bg-slate-900/40 z-[100]">
        <DialogContent className="bg-white rounded-[32px] p-8 max-w-md mx-auto relative z-[110] shadow-2xl mt-[10vh]">
        <button className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 p-2 rounded-xl transition-all" onClick={onClose}>
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-2xl font-black mb-8 text-slate-900">Update Request Status</h2>
        <div className="space-y-6">
          <div>
            <label className="block font-black text-[10px] uppercase tracking-widest text-slate-400 mb-2">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-primary/10 transition-all appearance-none"
            >
              <option value="ordered">Ordered</option>
            </select>
          </div>
          <div>
            <label className="block font-black text-[10px] uppercase tracking-widest text-slate-400 mb-2">Quoted Price (₹)</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Enter quoted price"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-primary/10 transition-all"
            />
          </div>
          <div>
            <label className="block font-black text-[10px] uppercase tracking-widest text-slate-400 mb-2">Quotation File</label>
            <div className="relative">
              <input 
                type="file" 
                accept="application/pdf,image/*" 
                onChange={(e) => setFile(e.target.files?.[0] || null)} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className={`w-full flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-8 transition-all text-center ${file ? 'border-primary bg-primary/5' : 'border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300'}`}>
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    </div>
                    <p className="text-sm font-bold text-slate-900 truncate max-w-[200px]">{file.name}</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-slate-400">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    </div>
                    <p className="text-sm font-bold text-slate-600">Click or drag file to upload</p>
                    <p className="text-[10px] font-black uppercase tracking-widest">PDF or Images up to 10MB</p>
                  </div>
                )}
              </div>
            </div>
          </div>
            {error && <p className="text-rose-500 text-sm font-bold">{error}</p>}
            {/* Existing upload UI */}
            <div className="flex items-center gap-4 mt-4">
              {/* Change file button */}
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setUploadedUrl(null);
                }}
                className="px-3 py-1 bg-slate-200 text-slate-800 rounded-md text-sm hover:bg-slate-300"
              >
                Change File
              </button>
              {/* View / Download button (shown after upload) */}
              {uploadedUrl && (
                <a
                  href={uploadedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 bg-primary text-white rounded-md text-sm hover:bg-primary/80"
                >
                  View / Download
                </a>
              )}
            </div>
            <button
              className="w-full bg-primary text-white text-xs font-black uppercase tracking-widest py-4 rounded-xl mt-4 hover:opacity-90 disabled:opacity-50 transition-all shadow-xl shadow-primary/20 hover:-translate-y-0.5 active:translate-y-0"
              onClick={handleSubmit}
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : 'Confirm Update'}
            </button>
        </div>
      </DialogContent></DialogOverlay>
    </Dialog>
  );
}
