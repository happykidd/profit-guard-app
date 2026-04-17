import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { buildCostImportBatchAuditCsv } from "../services/cost-import.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const batchId = url.searchParams.get("batchId")?.trim() ?? "";

  if (!batchId) {
    return new Response("Missing batchId.", { status: 400 });
  }

  const shop = await db.shop.findUnique({
    where: {
      shopDomain: session.shop,
    },
    select: {
      id: true,
    },
  });

  if (!shop) {
    return new Response("Shop not found.", { status: 404 });
  }

  try {
    const { batch, csv } = await buildCostImportBatchAuditCsv({
      batchId,
      shopId: shop.id,
    });

    const fileSafeDate = batch.createdAt.toISOString().slice(0, 10);
    const fileName = `profit-guard-${batch.importType.toLowerCase()}-${fileSafeDate}-${batch.id}.csv`;

    return new Response(csv, {
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
      status: 200,
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Audit export failed.", {
      status: 400,
    });
  }
};
