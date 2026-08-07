import { activeLeadStatuses } from './useLeadStatuses';

describe('activeLeadStatuses', () => {
  it('keeps custom active statuses and excludes inactive statuses', () => {
    const custom = { id: 'custom-id', code: 'vip_customer', name: 'VIP Customer', color: '#663399', active: true };
    const inactive = { id: 'inactive-id', code: 'old_status', name: 'Old Status', active: false };

    expect(activeLeadStatuses([custom, inactive])).toEqual([custom]);
  });

  it('handles an absent API payload', () => {
    expect(activeLeadStatuses()).toEqual([]);
  });
});
