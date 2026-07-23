import { NextRequest, NextResponse } from "next/server";
import { AIProcessor } from "@/backend/services/aiProcessor";

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const mimeType = file.type;

        // Supported types for Gemini: image/png, image/jpeg, application/pdf, etc.
        const invoiceData = await AIProcessor.parseInvoice(buffer, mimeType);

        return NextResponse.json({ data: invoiceData });
    } catch (err: any) {
        console.error("PI Processing Route Error:", err);
        return NextResponse.json({ error: err.message || "Failed to process invoice" }, { status: 500 });
    }
}
