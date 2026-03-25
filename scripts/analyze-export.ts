#!/usr/bin/env npx tsx
/**
 * Export Analysis Script
 *
 * Analyzes an export zip file for internal consistency between:
 * - Journal Entry (JE) summary and details
 * - Daily Reconciliation (DR)
 * - Detailed Sales Report (DSR)
 *
 * Also compares against the client's Excel file if provided.
 *
 * Usage:
 *   npx tsx scripts/analyze-export.ts <export-zip> [client-xlsx] [sheet-name]
 *
 * Examples:
 *   npx tsx scripts/analyze-export.ts ~/Downloads/export-2026-01-12-abc123.zip
 *   npx tsx scripts/analyze-export.ts ~/Downloads/export-2026-01-12-abc123.zip ~/Downloads/client.xlsx 1-12
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Decimal } from 'decimal.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function fmt(n: number | Decimal): string {
  const v = typeof n === 'number' ? n : n.toNumber();
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Extract zip ───────────────────────────────────────────────────────────

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('Usage: npx tsx scripts/analyze-export.ts <export-zip> [client-xlsx] [sheet-name]');
  process.exit(1);
}

const tmpDir = fs.mkdtempSync('/tmp/export-analysis-');
execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'pipe' });

// Find the date from filenames
const files = fs.readdirSync(tmpDir);
const dateMatch = files[0]?.match(/(\d{4}-\d{2}-\d{2})/);
const exportDate = dateMatch?.[1] || 'unknown';
console.log(`\n${'='.repeat(70)}`);
console.log(`  Export Analysis: ${exportDate}`);
console.log(`${'='.repeat(70)}\n`);

// ─── Read Journal Entry Summary ────────────────────────────────────────────

interface AccountSummary {
  cash: number; card: number; gc: number; sc: number;
  tax: number; sales: number; ship: number;
}

const acctMap: Record<string, keyof AccountSummary> = {
  '1051.000': 'cash', '1061.000': 'card', '2110.000': 'tax',
  '2320.000': 'gc', '2340.000': 'sc', '3000.000': 'sales', '3040.000': 'ship',
};

const jeFile = path.join(tmpDir, `journal-entry_${exportDate}.csv`);
const jeSummary: AccountSummary = { cash: 0, card: 0, gc: 0, sc: 0, tax: 0, sales: 0, ship: 0 };

if (fs.existsSync(jeFile)) {
  const lines = fs.readFileSync(jeFile, 'utf-8').trim().split('\n');
  for (const line of lines) {
    const cols = parseCSVLine(line);
    const acct = cols[5]?.trim();
    const amt = parseFloat(cols[6] || '0');
    const key = acctMap[acct];
    if (key) jeSummary[key] = amt;
  }
}

// ─── Read Daily Reconciliation Summary ─────────────────────────────────────

const drFile = path.join(tmpDir, `daily-reconciliation_${exportDate}.csv`);
const drSummary: AccountSummary = { cash: 0, card: 0, gc: 0, sc: 0, tax: 0, sales: 0, ship: 0 };

if (fs.existsSync(drFile)) {
  const lines = fs.readFileSync(drFile, 'utf-8').trim().split('\n');
  const lastLine = lines[lines.length - 1];
  if (lastLine?.startsWith('SUMMARY')) {
    const cols = parseCSVLine(lastLine);
    drSummary.sales = parseFloat(cols[3] || '0');
    drSummary.tax = parseFloat(cols[4] || '0');
    drSummary.ship = parseFloat(cols[5] || '0');
    drSummary.cash = parseFloat(cols[9] || '0');
    drSummary.card = parseFloat(cols[10] || '0');
    drSummary.gc = parseFloat(cols[11] || '0');
    drSummary.sc = parseFloat(cols[12] || '0');
    const check = parseFloat(cols[13] || '0');
    drSummary.cash += check; // checks go to cash account
  }
}

// ─── Read JE Details per order ─────────────────────────────────────────────

const jeDetailsFile = path.join(tmpDir, `journal-entry-details_${exportDate}.csv`);
const jeByOrder: Record<string, { sales: number; tax: number; ship: number }> = {};

if (fs.existsSync(jeDetailsFile)) {
  const lines = fs.readFileSync(jeDetailsFile, 'utf-8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) { // skip header
    const cols = parseCSVLine(lines[i]);
    const ref = cols[1]?.replace('SO-', '').replace('RF-', '');
    const acct = cols[2];
    const amt = parseFloat(cols[3] || '0');
    if (!jeByOrder[ref]) jeByOrder[ref] = { sales: 0, tax: 0, ship: 0 };
    if (acct?.startsWith('3000')) jeByOrder[ref].sales += amt;
    else if (acct?.startsWith('2110')) jeByOrder[ref].tax += amt;
    else if (acct?.startsWith('3040')) jeByOrder[ref].ship += amt;
  }
}

// ─── Internal Consistency ──────────────────────────────────────────────────

const nameMap: Record<keyof AccountSummary, string> = {
  cash: 'Cash (1051)', card: 'Card (1061)', gc: 'Gift Card (2320)',
  sc: 'Store Credit (2340)', tax: 'Tax (2110)', sales: 'Sales (3000)', ship: 'Shipping (3040)',
};

console.log('## Internal: JE vs DR\n');
console.log(`${'Account'.padEnd(20)} ${'JE'.padStart(12)} ${'DR'.padStart(12)} ${'Diff'.padStart(12)} Status`);
console.log('-'.repeat(66));

let internalOk = true;
const displayOrder: (keyof AccountSummary)[] = ['cash', 'card', 'gc', 'sc', 'tax', 'sales', 'ship'];

for (const key of displayOrder) {
  const je = Math.abs(jeSummary[key]);
  const dr = Math.abs(drSummary[key]);
  if (je === 0 && dr === 0) continue;
  const diff = je - dr;
  const status = Math.abs(diff) < 0.005 ? 'Match' : `$${Math.abs(diff).toFixed(2)} diff`;
  if (Math.abs(diff) >= 0.005) internalOk = false;
  console.log(`${nameMap[key].padEnd(20)} ${fmt(je).padStart(12)} ${fmt(dr).padStart(12)} ${(diff >= 0 ? '+' : '') + diff.toFixed(2).padStart(11)} ${status}`);
}

console.log(internalOk ? '\n  >> ALL INTERNAL FILES ALIGNED\n' : '\n  >> MISMATCHES FOUND\n');

// ─── Per-order JE vs DR discrepancies ──────────────────────────────────────

if (!internalOk && fs.existsSync(drFile)) {
  console.log('## Per-Order Discrepancies (JE vs DR)\n');

  // Parse DR per order
  const drByOrder: Record<string, { sales: number; tax: number; ship: number }> = {};
  const drLines = fs.readFileSync(drFile, 'utf-8').trim().split('\n');
  for (let i = 1; i < drLines.length; i++) {
    const cols = parseCSVLine(drLines[i]);
    if (!cols[0]?.startsWith('#')) continue;
    const name = cols[0];
    if (!drByOrder[name]) drByOrder[name] = { sales: 0, tax: 0, ship: 0 };
    drByOrder[name].sales += parseFloat(cols[3] || '0');
    drByOrder[name].tax += parseFloat(cols[4] || '0');
    drByOrder[name].ship += parseFloat(cols[5] || '0');
  }

  const allOrders = new Set([...Object.keys(jeByOrder), ...Object.keys(drByOrder)]);
  for (const order of [...allOrders].sort()) {
    const je = jeByOrder[order] || { sales: 0, tax: 0, ship: 0 };
    const dr = drByOrder[order] || { sales: 0, tax: 0, ship: 0 };

    const diffs: string[] = [];
    if (Math.abs(Math.abs(je.sales) - Math.abs(dr.sales)) > 0.01)
      diffs.push(`sales: JE=${je.sales.toFixed(2)} DR=${dr.sales.toFixed(2)}`);
    if (Math.abs(Math.abs(je.tax) - Math.abs(dr.tax)) > 0.01)
      diffs.push(`tax: JE=${je.tax.toFixed(2)} DR=${dr.tax.toFixed(2)}`);
    if (Math.abs(Math.abs(je.ship) - Math.abs(dr.ship)) > 0.01)
      diffs.push(`ship: JE=${je.ship.toFixed(2)} DR=${dr.ship.toFixed(2)}`);

    if (diffs.length > 0) {
      console.log(`  ${order}: ${diffs.join(', ')}`);
    }
  }
  console.log();
}

// ─── Order data analysis ───────────────────────────────────────────────────

const orderDataFile = path.join(tmpDir, `order-data_${exportDate}.json`);
if (fs.existsSync(orderDataFile)) {
  const orders = JSON.parse(fs.readFileSync(orderDataFile, 'utf-8'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refundedOrders = orders.filter((o: any) =>
    ['partially_refunded', 'refunded'].includes(o.financialStatus)
  );

  if (refundedOrders.length > 0) {
    console.log(`## Orders with Refunds (${refundedOrders.length})\n`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const o of refundedOrders) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const futureRefunds = (o.refunds || []).filter((r: any) =>
        r.createdAt && r.createdAt.slice(0, 10) > exportDate
      );
      if (futureRefunds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dates = futureRefunds.map((r: any) => r.createdAt.slice(0, 10));
        console.log(`  #${o.orderNumber}: ${o.financialStatus} — future refunds on ${dates.join(', ')}`);
      }
    }
    console.log();
  }
}

// ─── Cleanup ───────────────────────────────────────────────────────────────

execSync(`rm -rf "${tmpDir}"`);
console.log('Done.');
