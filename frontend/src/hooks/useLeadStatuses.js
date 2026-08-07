import { useEffect, useState } from 'react';
import { listLeadStatuses } from '../services/leadStatusAdmin.service';

export const activeLeadStatuses = statuses => (statuses || []).filter(status => status.active !== false);

export default function useLeadStatuses() {
  const [leadStatuses, setLeadStatuses] = useState([]);
  useEffect(() => {
    let active = true;
    listLeadStatuses().then(response => {
      if (active) setLeadStatuses(activeLeadStatuses(response.data?.data));
    }).catch(() => { if (active) setLeadStatuses([]); });
    return () => { active = false; };
  }, []);
  return leadStatuses;
}
