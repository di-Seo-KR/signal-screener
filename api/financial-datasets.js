/**
 * Vercel Serverless Function: Financial Datasets API Proxy
 * Proxies requests to https://api.financialdatasets.ai
 */

const BASE_URL = 'https://api.financialdatasets.ai';
const API_KEY = process.env.FINANCIAL_DATASETS_API_KEY;

// Map of type parameter to endpoint configuration
const ENDPOINTS = {
  prices: {
    path: '/prices',
    requiredParams: ['ticker'],
  },
  financials: {
    path: '/financials',
    requiredParams: ['ticker'],
  },
  income: {
    path: '/financials/income-statements',
    requiredParams: ['ticker'],
  },
  balance: {
    path: '/financials/balance-sheets',
    requiredParams: ['ticker'],
  },
  cashflow: {
    path: '/financials/cash-flow-statements',
    requiredParams: ['ticker'],
  },
  snapshot: {
    path: '/financials/snapshots',
    requiredParams: ['ticker'],
  },
};

/**
 * Set CORS headers on response
 */
function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
}

/**
 * Build query string from parameters
 */
function buildQueryString(params) {
  const filtered = {};

  for (const [key, value] of Object.entries(params)) {
    // Skip type parameter and empty values
    if (key !== 'type' && value !== undefined && value !== null && value !== '') {
      filtered[key] = value;
    }
  }

  const query = new URLSearchParams(filtered);
  return query.toString();
}

/**
 * Fetch data from Financial Datasets API
 */
async function fetchFromAPI(path, queryString) {
  const url = `${BASE_URL}${path}${queryString ? `?${queryString}` : ''}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Financial Datasets API error: ${response.status} - ${errorText || response.statusText}`
    );
  }

  return response.json();
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Set CORS headers
  setCORSHeaders(res);

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Only GET is supported.' });
    return;
  }

  try {
    // Validate API key is configured
    if (!API_KEY) {
      res.status(500).json({
        error: 'FINANCIAL_DATASETS_API_KEY is not configured',
      });
      return;
    }

    // Extract type parameter
    const { type, ...queryParams } = req.query;

    if (!type) {
      res.status(400).json({
        error: 'Missing required query parameter: type',
        supported_types: Object.keys(ENDPOINTS),
      });
      return;
    }

    // Validate endpoint type
    const endpoint = ENDPOINTS[type];
    if (!endpoint) {
      res.status(400).json({
        error: `Unknown type: ${type}`,
        supported_types: Object.keys(ENDPOINTS),
      });
      return;
    }

    // Validate required parameters for this endpoint
    const missingParams = endpoint.requiredParams.filter((param) => !queryParams[param]);
    if (missingParams.length > 0) {
      res.status(400).json({
        error: `Missing required parameters: ${missingParams.join(', ')}`,
        required: endpoint.requiredParams,
      });
      return;
    }

    // Build query string
    const queryString = buildQueryString(queryParams);

    // Fetch from Financial Datasets API
    const data = await fetchFromAPI(endpoint.path, queryString);

    // Set caching headers
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('Content-Type', 'application/json');

    // Return successful response
    res.status(200).json(data);
  } catch (error) {
    console.error('Error in financial-datasets proxy:', error.message);

    res.status(500).json({
      error: 'Failed to fetch data from Financial Datasets API',
      message: error.message,
    });
  }
}
