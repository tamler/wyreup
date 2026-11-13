<script lang="ts">
  import ReceiptBatchReview from '../../src/components/runners/ReceiptBatchReview.svelte';
  const query = new URLSearchParams(location.search);
  const item = { description: 'Item', quantity: '1', amount: '5.00' };
  const lines = query.has('blank') ? [{ description: null, quantity: null, amount: null }] : query.has('two') ? [item, { description: 'Second', quantity: '1', amount: '6.00' }] : [item];
  const initial = { version: 1, receipts: [{ sourceIndex: 0, merchant: 'Shop', date: '2026-11-13', currency: 'USD', subtotal: '5.00', tax: null, total: '5.00', lines, evidence: { total: 'Total 5.00' }, warnings: ['Check totals'] }] };
</script>

<ReceiptBatchReview {initial} />
