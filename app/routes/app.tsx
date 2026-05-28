import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import * as fs from "fs/promises";

import { authenticate } from "../shopify.server";

// Get version info from environment or version file
async function getVersionInfo() {
  const commit = process.env.APP_VERSION || "dev";
  let buildTime = "unknown";

  try {
    const versionData = await fs.readFile("/app/version.json", "utf-8");
    const parsed = JSON.parse(versionData);
    buildTime = parsed.buildTime || "unknown";
  } catch {
    // Version file not found, using defaults
  }

  return { commit: commit.substring(0, 7), buildTime };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const version = await getVersionInfo();

  // Log version at startup (helps confirm deployment)
  console.log(`[App] Loading version: ${version.commit} | Built: ${version.buildTime}`);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", version };
};

export default function App() {
  const { apiKey, version } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/exports">Export Center</s-link>
        <s-link href="/app/sales-tax">Sales Tax Report</s-link>
        <s-link href="/app/jobs">Job Queue</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/mappings">Account Mappings</s-link>
        <s-link href="/app/cogs-sync">COGS Sync</s-link>
        <s-link href="/app/uncaptured-auths">Uncaptured Auths</s-link>
      </s-app-nav>
      <Outlet />
      <div style={{
        position: "fixed",
        bottom: "8px",
        right: "8px",
        fontSize: "10px",
        color: "#888",
        fontFamily: "monospace"
      }}>
        v{version.commit}
      </div>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
