import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getShopConfig,
  listExports,
  getExportStats,
} from "../services/storage.server";
import { format } from "date-fns";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get configuration
  const config = await getShopConfig(shop);

  // Get recent exports
  const exportFiles = await listExports(shop);
  const recentExports = await Promise.all(
    exportFiles.slice(0, 5).map(async (filename) => {
      const stats = await getExportStats(shop, filename);
      return stats;
    }),
  );

  return {
    shop,
    config,
    recentExports,
  };
};

export default function Index() {
  const { shop, config, recentExports } = useLoaderData<typeof loader>();

  // Calculate next scheduled run
  const nextRun =
    config.syncEnabled && config.syncSchedule === "nightly"
      ? `Daily at ${config.scheduledTime}`
      : "Manual only";

  return (
    <s-page heading="Sage 50 Journal Entry Sync">
      <s-button slot="primary-action" href="/app/exports" variant="primary">
        Generate Export
      </s-button>

      {/* Status Overview */}
      <s-section heading="Sync Status">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "16px",
          }}
        >
          <StatCard
            label="Sync Status"
            value={config.syncEnabled ? "Enabled" : "Disabled"}
            status={config.syncEnabled ? "success" : "warning"}
          />
          <StatCard label="Schedule" value={nextRun} status="info" />
          <StatCard
            label="Last Export"
            value={
              recentExports.length > 0
                ? format(new Date(recentExports[0].created), "MMM d, yyyy")
                : "Never"
            }
            status="info"
          />
        </div>
      </s-section>

      {/* Getting Started */}
      <s-section heading="Getting Started">
        <s-paragraph>
          This app generates CSV-formatted journal entries from your Shopify
          transactions for import into Sage 50 accounting software.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <div>
            <strong>How it works:</strong>
            <ol style={{ marginTop: "8px", paddingLeft: "20px" }}>
              <li>
                <strong>Payout-First Reconciliation:</strong> Starts with money
                that hit your bank (payouts), then works backwards through
                transactions
              </li>
              <li>
                <strong>Perfect Balance:</strong> All journal entries reconcile
                to exact payout amounts
              </li>
              <li>
                <strong>CSV Export:</strong> Download Sage 50-compatible CSV
                files
              </li>
              <li>
                <strong>Import to Sage 50:</strong> Use the Journal Entry import
                feature
              </li>
            </ol>
          </div>
        </s-stack>
      </s-section>

      {/* Recent Exports */}
      <s-section heading="Recent Exports">
        {recentExports.length === 0 ? (
          <s-paragraph>
            No exports yet.{" "}
            <Link
              to="/app/exports"
              style={{ color: "#008060", textDecoration: "underline" }}
            >
              Generate your first export
            </Link>{" "}
            to get started.
          </s-paragraph>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{ borderBottom: "1px solid #e1e3e5", textAlign: "left" }}
              >
                <th style={{ padding: "12px" }}>Filename</th>
                <th style={{ padding: "12px" }}>Created</th>
                <th style={{ padding: "12px", textAlign: "right" }}>Size</th>
                <th style={{ padding: "12px", textAlign: "center" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {recentExports.map((exp, index) => (
                <tr
                  key={exp.filename}
                  style={{
                    borderBottom:
                      index < recentExports.length - 1
                        ? "1px solid #f6f6f7"
                        : "none",
                  }}
                >
                  <td style={{ padding: "12px" }}>
                    <code style={{ fontSize: "13px" }}>{exp.filename}</code>
                  </td>
                  <td style={{ padding: "12px", color: "#637381" }}>
                    {format(new Date(exp.created), "MMM d, h:mm a")}
                  </td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      color: "#637381",
                    }}
                  >
                    {formatFileSize(exp.size)}
                  </td>
                  <td style={{ padding: "12px", textAlign: "center" }}>
                    <a
                      href={`/app/api/download-csv?shop=${shop}&filename=${exp.filename}`}
                      download
                      style={{
                        padding: "6px 12px",
                        backgroundColor: "#f6f6f7",
                        color: "#202223",
                        border: "1px solid #c9cccf",
                        borderRadius: "4px",
                        textDecoration: "none",
                        fontSize: "13px",
                      }}
                    >
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {recentExports.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <Link
              to="/app/exports"
              style={{
                color: "#008060",
                textDecoration: "underline",
                fontSize: "14px",
              }}
            >
              View all exports →
            </Link>
          </div>
        )}
      </s-section>

      {/* Sidebar - Configuration Summary */}
      <s-section slot="aside" heading="Configuration">
        {/* <s-paragraph>
          <strong>Auto-export date:</strong> {config.autoExportDate}
        </s-paragraph> */}
        <s-paragraph>
          <strong>Transaction types:</strong>
          <ul
            style={{ marginTop: "8px", paddingLeft: "20px", fontSize: "14px" }}
          >
            {config.transactionTypes.orders && <li>Orders</li>}
            {/* {config.transactionTypes.refunds && <li>Refunds</li>}
            {config.transactionTypes.payments && <li>Payments</li>}
            {config.transactionTypes.inventory && <li>Inventory</li>} */}
          </ul>
        </s-paragraph>
        <s-button href="/app/settings" variant="secondary">
          Edit Settings
        </s-button>
      </s-section>

      {/* Sidebar - Help */}
      <s-section slot="aside" heading="Need Help?">
        <s-paragraph>
          <strong>CSV Format:</strong> Sage 50 compatible
          <br />
          Date, Reference, Account, Debit, Credit, Memo
        </s-paragraph>
        {/* <s-paragraph>
          <strong>Reconciliation:</strong> Payout-first approach ensures perfect
          balance to bank deposits
        </s-paragraph> */}
        {/* <s-paragraph>
          Questions? Check the{" "}
          <s-link
            href="https://github.com/anthropics/claude-code/issues"
            target="_blank"
          >
            documentation
          </s-link>
        </s-paragraph> */}
      </s-section>
    </s-page>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  status: "success" | "warning" | "info";
}

function StatCard({ label, value, status }: StatCardProps) {
  const colors = {
    success: "#d4edda",
    warning: "#fff3cd",
    info: "#d1ecf1",
  };

  const textColors = {
    success: "#155724",
    warning: "#856404",
    info: "#0c5460",
  };

  return (
    <div
      style={{
        padding: "16px",
        backgroundColor: colors[status],
        borderRadius: "8px",
        border: `1px solid ${textColors[status]}`,
      }}
    >
      <div
        style={{
          fontSize: "12px",
          color: textColors[status],
          marginBottom: "4px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "20px",
          fontWeight: "600",
          color: textColors[status],
        }}
      >
        {value}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
