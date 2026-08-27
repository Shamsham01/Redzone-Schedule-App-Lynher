const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class RedzoneAPIClient {
  constructor() {
    this.baseURL = 'https://api.rz-ops.com/public';
    this.accessToken = null;
    this.tokenExpiry = null;
    this.organizationId = process.env.ORGANISATION_ID;
    this.enterpriseId = process.env.ENTERPRISE_ID;
    this.clientId = process.env.CLIENT_ID;
    this.clientSecret = process.env.CLIENT_SECRET;
  }

async authenticate() {
  const tokenUrl = `${this.baseURL}/v3/oauth/token`;

  // Fail immediately if Cybrancee environment variables are missing
  if (!this.clientId || !this.clientSecret) {
    throw new Error(
      'Missing Redzone credentials. Check CLIENT_ID and CLIENT_SECRET environment variables.'
    );
  }

  try {
    console.log('🔐 Authenticating with Redzone OAuth v3...');

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    let response;

    // OAuth 2.0 Client Credentials.
    // First try credentials in the form body.
    try {
      const formData = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret
      });

      response = await axios.post(
        tokenUrl,
        formData.toString(),
        {
          headers,
          timeout: 15000
        }
      );
    } catch (firstError) {
      const status = firstError.response?.status;

      // Some OAuth implementations expect client credentials
      // through HTTP Basic Authentication instead.
      if (![400, 401, 403].includes(status)) {
        throw firstError;
      }

      console.warn(
        `⚠️ Redzone OAuth form authentication returned HTTP ${status}. Retrying with Basic authentication...`
      );

      const formData = new URLSearchParams({
        grant_type: 'client_credentials'
      });

      response = await axios.post(
        tokenUrl,
        formData.toString(),
        {
          headers,
          auth: {
            username: this.clientId,
            password: this.clientSecret
          },
          timeout: 15000
        }
      );
    }

    const token = response.data?.access_token;

    if (!token || typeof token !== 'string') {
      throw new Error(
        'Redzone OAuth response did not contain a valid access_token.'
      );
    }

    this.accessToken = token;

    // Use Redzone expiry if supplied.
    // Fall back to 5 minutes if expires_in is absent.
    const expiresIn = Number(response.data?.expires_in);
    const tokenLifetimeMs =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? expiresIn * 1000
        : 5 * 60 * 1000;

    // Refresh 30 seconds before actual expiry.
    this.tokenExpiry =
      Date.now() + Math.max(tokenLifetimeMs - 30000, 1000);

    console.log('✅ Redzone authentication successful');
    console.log(
      `🔑 Access token received (${token.length} characters)`
    );

    return true;

  } catch (error) {
    // Never leave a failed/stale token available for API calls
    this.accessToken = null;
    this.tokenExpiry = null;

    const status = error.response?.status;

    const details =
      error.response?.data?.error_description ||
      error.response?.data?.error ||
      error.message ||
      'Unknown authentication error';

    console.error('❌ Redzone authentication failed:', {
      status: status || 'no-response',
      error: details
    });

    // CRITICAL:
    // Throw instead of returning false.
    // This prevents subsequent requests sending "Bearer null".
    throw new Error(
      `Redzone authentication failed${status ? ` (HTTP ${status})` : ''}: ${details}`
    );
  }
}

async ensureAuthenticated() {
  const tokenNeedsRefresh =
    !this.accessToken ||
    !this.tokenExpiry ||
    Date.now() >= this.tokenExpiry;

  if (tokenNeedsRefresh) {
    await this.authenticate();
  }

  return true;
}

getAuthHeaders() {
  if (!this.accessToken) {
    throw new Error(
      'Cannot create Redzone authorization headers: no access token is available.'
    );
  }

  return {
    'Authorization': `Bearer ${this.accessToken}`,
    'Content-Type': 'application/json'
  };
}

  async listLocations(limit = 100, offset = 0, search = null) {
    await this.ensureAuthenticated();
    
    const params = {
      limit: limit.toString(),
      offset: offset.toString(),
      organizationId: this.organizationId,
      enterpriseId: this.enterpriseId
    };
    
    if (search) {
      params.search = search;
    }

    try {
      const response = await axios.get(
        `${this.baseURL}/v2/organizations/${this.organizationId}/enterprises/${this.enterpriseId}/locations`,
        {
          headers: this.getAuthHeaders(),
          params
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Failed to list locations:', error.response?.data || error.message);
      throw error;
    }
  }

  async getAllLocations() {
    const allLocations = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const response = await this.listLocations(limit, offset);
      allLocations.push(...response.items);
      
      if (response.items.length < limit) {
        break;
      }
      offset += limit;
    }

    return allLocations;
  }

  async listProductTypes(limit = 100, offset = 0, active = true) {
    await this.ensureAuthenticated();
    
    const params = {
      limit: limit.toString(),
      offset: offset.toString(),
      active: active.toString(),
      organizationId: this.organizationId,
      enterpriseId: this.enterpriseId
    };

    try {
      const response = await axios.get(
        `${this.baseURL}/v2/organizations/${this.organizationId}/enterprises/${this.enterpriseId}/product-types`,
        {
          headers: this.getAuthHeaders(),
          params
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Failed to list product types:', error.response?.data || error.message);
      throw error;
    }
  }

  async getAllProductTypes() {
    const allProducts = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const response = await this.listProductTypes(limit, offset);
      allProducts.push(...response.items);
      
      if (response.items.length < limit) {
        break;
      }
      offset += limit;
    }

    return allProducts;
  }

  async listScheduledRuns(locationId, limit = 100, offset = 0) {
    await this.ensureAuthenticated();
    
    const params = {
      limit: limit.toString(),
      offset: offset.toString(),
      organizationId: this.organizationId,
      enterpriseId: this.enterpriseId
    };

    console.log(`🔍 Listing scheduled runs for location ${locationId} (limit=${limit}, offset=${offset})`);

    try {
      const response = await axios.get(
        `${this.baseURL}/v2/organizations/${this.organizationId}/enterprises/${this.enterpriseId}/locations/${locationId}/scheduled-runs`,
        {
          headers: this.getAuthHeaders(),
          params
        }
      );
      
      console.log(`📊 API Response for location ${locationId}:`, {
        totalItems: response.data.totalItems || 0,
        itemsReturned: response.data.items?.length || 0,
        hasMore: response.data.items?.length === limit
      });
      
      return response.data;
    } catch (error) {
      console.error('❌ Failed to list scheduled runs:', error.response?.data || error.message);
      console.error('   Request details:', {
        locationId,
        limit,
        offset,
        url: `${this.baseURL}/v2/organizations/${this.organizationId}/enterprises/${this.enterpriseId}/locations/${locationId}/scheduled-runs`
      });
      throw error;
    }
  }

  async getAllScheduledRuns(locationId) {
    const allRuns = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const response = await this.listScheduledRuns(locationId, limit, offset);
      allRuns.push(...response.items);
      
      if (response.items.length < limit) {
        break;
      }
      offset += limit;
    }

    return allRuns;
  }

  async createScheduledRun(runData, locationId) {
    await this.ensureAuthenticated();
    
    const payload = {
      productTypeUUID: runData.productTypeUUID,
      plannedQuantity: runData.plannedQuantity,
      plannedStartTime: runData.plannedStartTime,
      externalId: runData.externalId,
      customReference: runData.customReference || '',
      standardRatePerMin: runData.standardRatePerMin
    };

    try {
      const response = await axios.post(
        `${this.baseURL}/v2/organizations/${this.organizationId}/enterprises/${this.enterpriseId}/locations/${locationId}/scheduled-runs`,
        payload,
        {
          headers: this.getAuthHeaders()
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Failed to create scheduled run:', error.response?.data || error.message);
      throw error;
    }
  }

  async updateScheduledRun(runData, locationId, runId) {
    await this.ensureAuthenticated();
    
    const payload = {
      plannedQuantity: runData.plannedQuantity,
      plannedStartTime: runData.plannedStartTime,
      externalId: runData.externalId, // CRITICAL: Include externalId to preserve RunID
      customReference: runData.customReference || '',
      standardRatePerMin: runData.standardRatePerMin
    };

    try {
      const response = await axios.put(
        `${this.baseURL}/v2/organizations/${this.organizationId}/enterprises/${this.enterpriseId}/locations/${locationId}/scheduled-runs/${runId}`,
        payload,
        {
          headers: this.getAuthHeaders()
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Failed to update scheduled run:', error.response?.data || error.message);
      throw error;
    }
  }

  async deleteScheduledRun(locationId, runId) {
    await this.ensureAuthenticated();
    
    try {
      const response = await axios.delete(
        `${this.baseURL}/v2/organizations/${this.organizationId}/enterprises/${this.enterpriseId}/locations/${locationId}/scheduled-runs/${runId}`,
        {
          headers: this.getAuthHeaders()
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Failed to delete scheduled run:', error.response?.data || error.message);
      throw error;
    }
  }

  async getScheduledRun(locationId, runId) {
    await this.ensureAuthenticated();
    
    try {
      const response = await axios.get(
        `${this.baseURL}/v2/organizations/${this.organizationId}/enterprises/${this.enterpriseId}/locations/${locationId}/scheduled-runs/${runId}`,
        {
          headers: this.getAuthHeaders()
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Failed to get scheduled run:', error.response?.data || error.message);
      throw error;
    }
  }

  // Helper method to find location by name
  async findLocationByName(locationName) {
    const locations = await this.getAllLocations();
    return locations.find(loc => loc.name === locationName);
  }

  // Helper method to find product by SKU
  async findProductBySKU(sku) {
    const products = await this.getAllProductTypes();
    return products.find(product => product.sku === sku);
  }

  // Cache management methods
  async saveCacheToFile(cacheData, filename) {
    try {
      await fs.writeFile(path.join(__dirname, filename), JSON.stringify(cacheData, null, 2));
      console.log(`✅ Cache saved to ${filename}`);
    } catch (error) {
      console.error('❌ Failed to save cache:', error.message);
    }
  }

  async loadCacheFromFile(filename) {
    try {
      const data = await fs.readFile(path.join(__dirname, filename), 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.log(`ℹ️ No cache file found: ${filename}`);
      return null;
    }
  }
}

module.exports = RedzoneAPIClient;
