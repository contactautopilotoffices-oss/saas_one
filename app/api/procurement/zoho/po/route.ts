import { NextRequest, NextResponse } from "next/server";
import { ZohoService } from "@/backend/services/zohoService";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { organizationId, invoiceData, zohoOrgId } = body;

        if (!organizationId || !invoiceData || !zohoOrgId) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const po = await ZohoService.createPurchaseOrder(zohoOrgId, invoiceData);

        return NextResponse.json({ success: true, po });
    } catch (err: any) {
        console.error("Zoho PO Route Error:", err);
        return NextResponse.json({ error: err.message || "Failed to create PO in Zoho" }, { status: 500 });
    }
}
