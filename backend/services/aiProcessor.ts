import { GoogleGenerativeAI } from "@google/generative-ai";
import { hasProviderKey, withProviderKeys } from "@/backend/lib/llm/providerKeys";

// Owner 2026-11-15: the shared Gemini keys GEMINI_API_KEY → _2 → _3 (then the older GOOGLE_AI_API_KEY), used in turn.

export interface InvoiceData {
    vendor_name: string;
    invoice_number: string;
    date: string;
    items: {
        name: string;
        quantity: number;
        unit_price: number;
        total: number;
        tax_percentage?: number;
    }[];
    total_amount: number;
    currency: string;
}

export class AIProcessor {
    static async parseInvoice(fileBuffer: Buffer, mimeType: string): Promise<InvoiceData> {
        if (!hasProviderKey("gemini")) {
            throw new Error("No Gemini key is configured (GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3)");
        }

        const modelFor = (key: string) => new GoogleGenerativeAI(key).getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        }, { apiVersion: 'v1beta' });

        const prompt = `
            Extract structured data from this Performa Invoice (PI).
            Identify the following fields:
            - Vendor Name
            - Invoice Number
            - Date (ISO format YYYY-MM-DD if possible)
            - Line Items: for each item, extract its name, quantity, unit price, total, and tax percentage if available.
            - Total Amount
            - Currency (e.g., INR, USD)

            Return ONLY a valid JSON object matching this structure:
            {
                "vendor_name": "string",
                "invoice_number": "string",
                "date": "string",
                "items": [
                    {
                        "name": "string",
                        "quantity": number,
                        "unit_price": number,
                        "total": number,
                        "tax_percentage": number
                    }
                ],
                "total_amount": number,
                "currency": "string"
            }
            
            If any field is missing, use null or an empty array. Do not include markdown formatting or extra text.
        `;

        const result = await withProviderKeys("gemini", key => modelFor(key).generateContent([
            prompt,
            {
                inlineData: {
                    data: fileBuffer.toString("base64"),
                    mimeType: mimeType,
                },
            },
        ]));

        const response = await result.response;
        const text = response.text();
        
        try {
            return JSON.parse(text);
        } catch (err) {
            console.error("AI Parsing Error. Raw response:", text);
            throw new Error("Failed to parse AI response into JSON");
        }
    }
}
