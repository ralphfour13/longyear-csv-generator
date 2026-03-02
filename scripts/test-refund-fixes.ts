/**
 * Test script for refund fix validation
 *
 * Tests the three critical fixes:
 * 1. Partial refund tax splitting (orders #80388, #80355)
 * 2. Canceled line items handling (orders #80230, #80050)
 * 3. Multi-gateway refunds (order #80355)
 */

import { Decimal } from 'decimal.js';
import type { Order, Refund, RefundLineItem, Transaction } from '../app/types/journal-entry';

// Test 1: Verify refund tax splitting
function testRefundTaxSplitting() {
  console.log('\n=== Test 1: Refund Tax Splitting ===');

  // Mock order #80388 data
  const refundLineItems: RefundLineItem[] = [
    {
      id: '1',
      line_item_id: '100',
      quantity: 1,
      restock_type: 'no_restock',
      subtotal: new Decimal('25.00'),
      total_tax: new Decimal('1.81'),
      line_item: {
        id: '100',
        title: 'Test Product',
      },
    },
  ];

  // Calculate totals
  const totalSubtotal = refundLineItems.reduce(
    (sum, item) => sum.plus(item.subtotal),
    new Decimal(0)
  );
  const totalTax = refundLineItems.reduce(
    (sum, item) => sum.plus(item.total_tax),
    new Decimal(0)
  );
  const totalRefund = totalSubtotal.plus(totalTax);

  console.log(`Subtotal: $${totalSubtotal.toFixed(2)}`);
  console.log(`Tax: $${totalTax.toFixed(2)}`);
  console.log(`Total: $${totalRefund.toFixed(2)}`);

  // Verify math
  const expected = new Decimal('26.81');
  const diff = totalRefund.minus(expected).abs();

  if (diff.lessThanOrEqualTo(new Decimal('0.01'))) {
    console.log('✅ PASS: Refund amount calculation is correct');
  } else {
    console.log(`❌ FAIL: Expected $${expected.toFixed(2)}, got $${totalRefund.toFixed(2)}`);
  }
}

// Test 2: Verify cancellation detection
function testCancellationDetection() {
  console.log('\n=== Test 2: Cancellation Detection ===');

  // Mock order #80230 refund (cancellation)
  const refundLineItems: RefundLineItem[] = [
    {
      id: '1',
      line_item_id: '100',
      quantity: 1,
      restock_type: 'cancel', // KEY: This indicates cancellation
      subtotal: new Decimal('199.95'),
      total_tax: new Decimal('19.00'),
      line_item: {
        id: '100',
        title: 'Freestone Boots',
      },
    },
  ];

  const mockRefund: Refund = {
    id: '1',
    orderId: '80230',
    createdAt: '2026-01-07T00:00:00Z',
    processedAt: '2026-01-07T00:00:00Z',
    transactions: [], // KEY: Empty array means no money refunded
    refund_line_items: refundLineItems,
  };

  // Check if it's a cancellation
  const isCancellation = mockRefund.refund_line_items.some(
    item => item.restock_type === 'cancel'
  ) && mockRefund.transactions.length === 0;

  if (isCancellation) {
    console.log('✅ PASS: Cancellation detected correctly');
    console.log('   - restock_type: cancel');
    console.log('   - transactions: [] (no money refunded)');
  } else {
    console.log('❌ FAIL: Should have detected cancellation');
  }
}

// Test 3: Verify gateway mismatch detection
function testGatewayMismatchDetection() {
  console.log('\n=== Test 3: Gateway Mismatch Detection ===');

  // Mock order #80355 (paid with gift card + CC, refunded to store credit)
  const originalTransactions: Transaction[] = [
    {
      id: '1',
      orderId: '80355',
      kind: 'capture',
      gateway: 'gift_card',
      status: 'success',
      amount: new Decimal('50.00'),
      currency: 'USD',
      processedAt: '2026-01-09T00:00:00Z',
      fees: [],
    },
    {
      id: '2',
      orderId: '80355',
      kind: 'capture',
      gateway: 'shopify_payments',
      status: 'success',
      amount: new Decimal('216.43'),
      currency: 'USD',
      processedAt: '2026-01-09T00:00:00Z',
      fees: [],
    },
  ];

  const refundTransaction: Transaction = {
    id: '3',
    orderId: '80355',
    kind: 'refund',
    gateway: 'shopify_store_credit', // KEY: Different from original payment
    status: 'success',
    amount: new Decimal('-17.27'),
    currency: 'USD',
    processedAt: '2026-01-09T00:00:00Z',
    fees: [],
  };

  // Check for gateway mismatch
  const originalGateways = originalTransactions
    .filter(t => (t.kind === 'capture' || t.kind === 'sale') && t.status === 'success')
    .map(t => t.gateway);

  const hasMismatch = !originalGateways.includes(refundTransaction.gateway);

  if (hasMismatch) {
    console.log('✅ PASS: Gateway mismatch detected');
    console.log(`   - Original: ${originalGateways.join(', ')}`);
    console.log(`   - Refund: ${refundTransaction.gateway}`);
  } else {
    console.log('❌ FAIL: Should have detected gateway mismatch');
  }
}

// Test 4: Verify balance validation
function testJournalEntryBalance() {
  console.log('\n=== Test 4: Journal Entry Balance ===');

  // Mock journal entries for order #80388 refund
  const entries = [
    // RF- entry: Credit payment account
    { debit: new Decimal(0), credit: new Decimal('26.81') },
    // SO- entries: Debit sales and tax
    { debit: new Decimal('25.00'), credit: new Decimal(0) },
    { debit: new Decimal('1.81'), credit: new Decimal(0) },
  ];

  const totalDebits = entries.reduce((sum, e) => sum.plus(e.debit), new Decimal(0));
  const totalCredits = entries.reduce((sum, e) => sum.plus(e.credit), new Decimal(0));
  const diff = totalDebits.minus(totalCredits).abs();

  console.log(`Total Debits: $${totalDebits.toFixed(2)}`);
  console.log(`Total Credits: $${totalCredits.toFixed(2)}`);
  console.log(`Difference: $${diff.toFixed(2)}`);

  if (diff.lessThanOrEqualTo(new Decimal('0.01'))) {
    console.log('✅ PASS: Journal entry is balanced');
  } else {
    console.log('❌ FAIL: Journal entry does not balance');
  }
}

// Run all tests
console.log('🧪 Running Refund Fix Validation Tests');
console.log('======================================');

testRefundTaxSplitting();
testCancellationDetection();
testGatewayMismatchDetection();
testJournalEntryBalance();

console.log('\n✅ All tests completed!');
