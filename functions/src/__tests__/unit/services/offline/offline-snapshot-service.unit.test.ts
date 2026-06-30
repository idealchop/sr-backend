import { describe, expect, it } from 'vitest';
import {
  isTransactionForManilaDay,
  manilaDayBounds,
  mergeTodaysTransactions,
  toLeanCustomer,
} from '../../../../services/offline/offline-snapshot-service';
import type { Customer } from '../../../../services/customers/customer-service';
import type { Transaction } from '../../../../services/transactions/transaction-service';

function baseCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    businessId: 'biz-1',
    name: 'Ana',
    phone: '09171234567',
    address: 'Muntinlupa',
    type: 'residential',
    status: 'active',
    isDeliveryEnabled: true,
    isCollectionEnabled: false,
    id: 'cust-1',
    ...overrides,
  };
}

describe('offline-snapshot-service', () => {
  it('manilaDayBounds uses +08:00 day window', () => {
    const { start, end, dayKey } = manilaDayBounds('2026-06-25');
    expect(dayKey).toBe('2026-06-25');
    expect(start.toISOString()).toBe('2026-06-24T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-25T15:59:59.999Z');
  });

  it('toLeanCustomer drops inactive sukis', () => {
    expect(toLeanCustomer(baseCustomer({ status: 'inactive' }))).toBeNull();
    expect(toLeanCustomer(baseCustomer())?.name).toBe('Ana');
  });

  it('isTransactionForManilaDay matches scheduled or created day', () => {
    const dayKey = '2026-06-25';
    const tx: Pick<Transaction, 'scheduledAt' | 'createdAt'> = {
      scheduledAt: '2026-06-25T02:00:00+08:00',
    };
    expect(isTransactionForManilaDay(tx, dayKey)).toBe(true);
    expect(
      isTransactionForManilaDay(
        { createdAt: '2026-06-24T20:00:00.000Z', scheduledAt: undefined },
        dayKey,
      ),
    ).toBe(true);
    expect(
      isTransactionForManilaDay(
        { createdAt: '2026-06-23T10:00:00.000Z', scheduledAt: undefined },
        dayKey,
      ),
    ).toBe(false);
  });

  it('mergeTodaysTransactions dedupes and sorts newest first', () => {
    const dayKey = '2026-06-25';
    const scheduled = [
      {
        id: 'tx-1',
        businessId: 'biz-1',
        referenceId: 'REF-1',
        type: 'delivery',
        customerName: 'Ana',
        totalAmount: 100,
        amountPaid: 0,
        balanceDue: 100,
        paymentStatus: 'unpaid',
        paymentMethod: 'cash',
        deliveryStatus: 'pending',
        scheduledAt: '2026-06-25T08:00:00+08:00',
        createdAt: '2026-06-25T07:00:00+08:00',
      },
    ] as Transaction[];

    const recent = [
      {
        ...scheduled[0],
        scheduledAt: '2026-06-25T09:00:00+08:00',
      },
      {
        id: 'tx-2',
        businessId: 'biz-1',
        referenceId: 'REF-2',
        type: 'walkin',
        customerName: 'Ben',
        totalAmount: 50,
        amountPaid: 50,
        balanceDue: 0,
        paymentStatus: 'paid',
        paymentMethod: 'cash',
        deliveryStatus: 'completed',
        createdAt: '2026-06-25T10:00:00+08:00',
      },
    ] as Transaction[];

    const rows = mergeTodaysTransactions(scheduled, recent, dayKey);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe('tx-2');
    expect(rows[1]?.id).toBe('tx-1');
  });
});
