import { getSettings } from './settings.service';
import { ScanEvent } from '../types';

const API_TIMEOUT = 10000;

const makeRequest = async (endpoint: string, method: string, body?: any) => {
  const settings = await getSettings();
  
  if (settings.demo_mode) {
    // Simulate API response in demo mode
    return simulateApiResponse(endpoint, method, body);
  }

  if (!settings.api_url) {
    throw new Error('API URL not configured');
  }

  const url = `${settings.api_url}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
};

const simulateApiResponse = async (endpoint: string, method: string, body?: any) => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300));

  if (endpoint === '/api/inbound/start') {
    return { inbound_session: `SESSION-${Date.now()}` };
  }

  if (endpoint === '/api/carton/lock') {
    return { locked: true, message: 'Carton locked successfully' };
  }

  if (endpoint === '/api/carton/complete') {
    return { ok: true };
  }

  if (endpoint === '/api/events/batch') {
    return { acked: body.map((e: any) => e.offline_uuid), failed: [] };
  }

  if (endpoint.startsWith('/api/boxes/create')) {
    return { box_id: `BOX-${Date.now()}` };
  }

  if (endpoint.startsWith('/api/boxes/close') || endpoint.startsWith('/api/boxes/reopen')) {
    return { ok: true };
  }

  if (endpoint.startsWith('/api/transfer-cartons/create')) {
    return { tc_id: `TC-${Date.now()}` };
  }

  if (endpoint.startsWith('/api/transfer-cartons/seal') || endpoint.startsWith('/api/transfer-cartons/dispatch')) {
    return { ok: true };
  }

  // PULL API simulations
  if (endpoint.startsWith('/api/asn/')) {
    const asn_no = endpoint.split('/api/asn/')[1];
    return {
      asn_no,
      transfer_order: 'TO-00012',
      cartons: ['CTN-001', 'CTN-002', 'CTN-003', 'CTN-004'],
    };
  }

  if (endpoint.startsWith('/api/transfer-order/by-asn/')) {
    return {
      to_no: 'TO-00012',
      asn_no: endpoint.split('/api/transfer-order/by-asn/')[1],
      allocations: [
        { store: 'SR-01', item_code: 'ITEM-0001', allocated_qty: 2 },
        { store: 'SR-01', item_code: 'ITEM-0002', allocated_qty: 2 },
        { store: 'SR-02', item_code: 'ITEM-0001', allocated_qty: 1 },
        { store: 'SR-02', item_code: 'ITEM-0003', allocated_qty: 2 },
        { store: 'SR-03', item_code: 'ITEM-0004', allocated_qty: 2 },
        { store: 'SR-03', item_code: 'ITEM-0005', allocated_qty: 1 },
      ],
    };
  }

  if (endpoint.startsWith('/api/boxes')) {
    return [
      { box_id: 'BOX-SR01-001', asn_no: 'ASN-00045', store: 'SR-01', status: 'Open' },
      { box_id: 'BOX-SR02-001', asn_no: 'ASN-00045', store: 'SR-02', status: 'Open' },
      { box_id: 'BOX-SR03-001', asn_no: 'ASN-00045', store: 'SR-03', status: 'Open' },
    ];
  }

  if (endpoint.startsWith('/api/transfer-cartons')) {
    return [];
  }

  return { ok: true };
};

export const apiService = {
  startInbound: async (data: {
    asn_no: string;
    transfer_order: string;
    dock: string;
    user_id: string;
    device_id: string;
  }) => {
    return makeRequest('/api/inbound/start', 'POST', data);
  },

  lockCarton: async (data: {
    inbound_session: string;
    asn_no: string;
    carton_id: string;
    user_id: string;
    device_id: string;
  }) => {
    return makeRequest('/api/carton/lock', 'POST', data);
  },

  completeCarton: async (data: {
    inbound_session: string;
    asn_no: string;
    carton_id: string;
    user_id: string;
    device_id: string;
  }) => {
    return makeRequest('/api/carton/complete', 'POST', data);
  },

  batchEvents: async (events: ScanEvent[]) => {
    return makeRequest('/api/events/batch', 'POST', events);
  },

  createBox: async (data: { asn_no: string; to_no: string; store: string }) => {
    return makeRequest('/api/boxes/create', 'POST', data);
  },

  closeBox: async (data: { box_id: string }) => {
    return makeRequest('/api/boxes/close', 'POST', data);
  },

  reopenBox: async (data: { box_id: string }) => {
    return makeRequest('/api/boxes/reopen', 'POST', data);
  },

  createTransferCarton: async (data: { asn_no: string; to_no: string; store: string }) => {
    return makeRequest('/api/transfer-cartons/create', 'POST', data);
  },

  sealTransferCarton: async (data: { tc_id: string }) => {
    return makeRequest('/api/transfer-cartons/seal', 'POST', data);
  },

  dispatchTransferCarton: async (data: { tc_id: string }) => {
    return makeRequest('/api/transfer-cartons/dispatch', 'POST', data);
  },

  // PULL APIs
  getASN: async (asn_no: string) => {
    return makeRequest(`/api/asn/${asn_no}`, 'GET');
  },

  getTransferOrderByASN: async (asn_no: string) => {
    return makeRequest(`/api/transfer-order/by-asn/${asn_no}`, 'GET');
  },

  getBoxes: async (params: { asn?: string; store?: string }) => {
    const queryParams = new URLSearchParams();
    if (params.asn) queryParams.append('asn', params.asn);
    if (params.store) queryParams.append('store', params.store);
    const query = queryParams.toString();
    return makeRequest(`/api/boxes${query ? `?${query}` : ''}`, 'GET');
  },

  getTransferCartons: async (params: { asn?: string; store?: string }) => {
    const queryParams = new URLSearchParams();
    if (params.asn) queryParams.append('asn', params.asn);
    if (params.store) queryParams.append('store', params.store);
    const query = queryParams.toString();
    return makeRequest(`/api/transfer-cartons${query ? `?${query}` : ''}`, 'GET');
  },
};

