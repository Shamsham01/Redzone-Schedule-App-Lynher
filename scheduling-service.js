const RedzoneAPIClient = require('./redzone-api-client');
const axios = require('axios');

class SchedulingService {
  constructor() {
    this.redzone = new RedzoneAPIClient();
    this.locationCache = null;
    this.productCache = null;
    this.bakeryLocations = null;
    this.notificationHook = process.env.PLAN_NOTIFICATION_HOOK;
  }

  // Initialize the service
  async initialize() {
    console.log('🚀 Initializing Simplified Scheduling Service...');
    
    // Load bakery locations
    this.bakeryLocations = await this.redzone.loadCacheFromFile('bakery-locations.json');
    if (!this.bakeryLocations) {
      throw new Error('Bakery locations not found. Please ensure bakery-locations.json exists.');
    }
    
    // Refresh caches
    await this.refreshLocationCache();
    await this.refreshProductCache();
    
    console.log('✅ Simplified Scheduling Service initialized');
  }

  // Parse RunID to extract daycode information
  parseRunIDDaycode(runId) {
    if (!runId) {
      console.warn(`⚠️ RunID is null/undefined`);
      return null;
    }
    
    const runIdStr = runId.toString();
    console.log(`🔍 Parsing RunID: "${runIdStr}" (length: ${runIdStr.length})`);
    
    if (runIdStr.length < 7) {
      console.warn(`⚠️ Invalid RunID format: ${runId} (too short, need at least 7 characters)`);
      return null;
    }
    
    try {
      const lineNumber = parseInt(runIdStr[0]);
      const year = 2000 + parseInt(runIdStr.substring(1, 3));
      const dayOfYear = parseInt(runIdStr.substring(3, 6));
      const runOrder = parseInt(runIdStr.substring(6));
      
      // Convert day of year to date
      const date = new Date(year, 0, dayOfYear);
      
      console.log(`📊 Parsed RunID ${runIdStr}:`, {
        lineNumber,
        year,
        dayOfYear,
        runOrder,
        date: date.toDateString()
      });
      
      return {
        lineNumber,
        year,
        dayOfYear,
        runOrder,
        date,
        runId: runId
      };
    } catch (error) {
      console.error(`❌ Error parsing RunID ${runId}:`, error.message);
      return null;
    }
  }

  // Get current plan day (6 PM to 6 PM cycle)
  getCurrentPlanDay() {
    const now = new Date();
    const currentHour = now.getHours();
    
    // The current plan day is always TODAY
    // Today's plan started yesterday at 6PM and runs until today at 6PM
    // After 6PM today, we're still on today's plan until tomorrow 6PM
    const currentPlanDay = new Date(now);
    
    console.log(`📅 Current plan day logic: ${currentPlanDay.toDateString()} (current time: ${now.toISOString()}, hour: ${currentHour})`);
    
    return currentPlanDay;
  }

  // Get next plan day
  getNextPlanDay() {
    const currentPlanDay = this.getCurrentPlanDay();
    const nextPlanDay = new Date(currentPlanDay);
    nextPlanDay.setDate(nextPlanDay.getDate() + 1);
    return nextPlanDay;
  }

  // Check if a run is for the current plan day
  isCurrentPlanRun(run) {
    const runDaycode = this.parseRunIDDaycode(run.externalId);
    if (!runDaycode) return false;
    
    const currentPlanDay = this.getCurrentPlanDay();
    const runDate = runDaycode.date;
    
    const isCurrent = runDate.getFullYear() === currentPlanDay.getFullYear() &&
                     runDate.getMonth() === currentPlanDay.getMonth() &&
                     runDate.getDate() === currentPlanDay.getDate();
    
    console.log(`🔍 Comparing run ${run.externalId}:`, {
      runDate: runDate.toDateString(),
      currentPlanDay: currentPlanDay.toDateString(),
      isCurrent: isCurrent
    });
    
    return isCurrent;
  }

  // Check if a run is for the next plan day
  isNextPlanRun(run) {
    const runDaycode = this.parseRunIDDaycode(run.externalId);
    if (!runDaycode) return false;
    
    const nextPlanDay = this.getNextPlanDay();
    const runDate = runDaycode.date;
    
    return runDate.getFullYear() === nextPlanDay.getFullYear() &&
           runDate.getMonth() === nextPlanDay.getMonth() &&
           runDate.getDate() === nextPlanDay.getDate();
  }

  // Check if a run is older than 2 days
  isOldRun(run) {
    const runDaycode = this.parseRunIDDaycode(run.externalId);
    if (!runDaycode) return false;
    
    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    return runDaycode.date < twoDaysAgo;
  }

  // Get bakery-specific locations from bakery-locations.json
  getBakeryLocations(bakeryType) {
    if (!this.bakeryLocations || !this.bakeryLocations.bakeries) {
      throw new Error('Bakery locations not available');
    }
    
    const bakery = this.bakeryLocations.bakeries[bakeryType];
    if (!bakery || !bakery.locations) {
      throw new Error(`Bakery '${bakeryType}' not found in bakery-locations.json`);
    }
    
    return bakery.locations;
  }

  // Get all bakery types
  getBakeryTypes() {
    if (!this.bakeryLocations || !this.bakeryLocations.bakeries) {
      return [];
    }
    return Object.keys(this.bakeryLocations.bakeries);
  }

  // Find location by name
  findLocationByName(locationName) {
    if (!this.locationCache || !this.locationCache.data) {
      throw new Error('Location cache not available');
    }
    
    return this.locationCache.data.find(loc => loc.name === locationName);
  }

  // Find product by SKU
  findProductBySKU(sku) {
    if (!this.productCache || !this.productCache.data) {
      throw new Error('Product cache not available');
    }
    
    return this.productCache.data.find(product => product.sku === sku);
  }

  // Determine which day plan to update based on RunID analysis
  determinePlanDay(payload) {
    if (!payload.data || payload.data.length === 0) {
      return 'current'; // Default to current day
    }
    
    // Analyze the first few runs to determine the day
    const sampleRuns = payload.data.slice(0, Math.min(5, payload.data.length));
    let currentDayCount = 0;
    let nextDayCount = 0;
    
    const currentPlanDay = this.getCurrentPlanDay();
    const nextPlanDay = this.getNextPlanDay();
    
    console.log(`🔍 Plan day determination:`);
    console.log(`   Current plan day: ${currentPlanDay.toDateString()}`);
    console.log(`   Next plan day: ${nextPlanDay.toDateString()}`);
    
    for (const item of sampleRuns) {
      const runDaycode = this.parseRunIDDaycode(item.RunID);
      if (runDaycode) {
        const runDate = runDaycode.date;
        
        console.log(`   Run ${item.RunID}: ${runDate.toDateString()}`);
        
        if (runDate.getFullYear() === currentPlanDay.getFullYear() &&
            runDate.getMonth() === currentPlanDay.getMonth() &&
            runDate.getDate() === currentPlanDay.getDate()) {
          currentDayCount++;
          console.log(`     → Matches current day`);
        } else if (runDate.getFullYear() === nextPlanDay.getFullYear() &&
                   runDate.getMonth() === nextPlanDay.getMonth() &&
                   runDate.getDate() === nextPlanDay.getDate()) {
          nextDayCount++;
          console.log(`     → Matches next day`);
        } else {
          console.log(`     → Matches neither (old run)`);
        }
      }
    }
    
    const determinedDay = nextDayCount > currentDayCount ? 'next' : 'current';
    console.log(`📅 Plan determined as: ${determinedDay} day (current: ${currentDayCount}, next: ${nextDayCount})`);
    
    return determinedDay;
  }


  // Process update plan - simplified delete and recreate approach
  async processUpdatePlan(payload) {
    console.log('🔄 Processing plan update (simplified approach)...');
    
    const bakeryType = payload.bakeryType || 'Lynher';
    console.log(`🏭 Processing update for ${bakeryType} bakery`);
    
    // Determine which day this plan is for
    const planDay = this.determinePlanDay(payload);
    console.log(`📅 Plan determined as: ${planDay} day`);
    
    // Always refresh product cache to ensure latest products are available
    // This ensures that any new products added to Redzone Database are immediately available
    console.log('🔄 Refreshing product cache to ensure latest products are available...');
    await this.refreshProductCache();
    
    // Ensure location cache is loaded
    if (!this.locationCache || !this.locationCache.data) {
      console.log('⚠️ Location cache not available, refreshing...');
      await this.refreshLocationCache();
    }
    
    const results = {
      created: [],
      deleted: [],
      failed: [],
      skipped: []
    };

    // Get bakery-specific locations
    const bakeryLocations = this.getBakeryLocations(bakeryType);
    const locationMap = new Map();
    bakeryLocations.forEach(loc => locationMap.set(loc.name, loc));

    // Step 1: Delete all runs for this bakery and day
    console.log(`🗑️ Step 1: Deleting all ${planDay} day runs for ${bakeryType} bakery...`);
    for (const location of bakeryLocations) {
      try {
        const runs = await this.redzone.getAllScheduledRuns(location.uuid);
        const dayRuns = runs.filter(run => {
          if (!run.externalId) return false;
          const runDaycode = this.parseRunIDDaycode(run.externalId);
          if (!runDaycode) return false;
          
          const runDate = runDaycode.date;
          const targetDay = planDay === 'current' ? this.getCurrentPlanDay() : this.getNextPlanDay();
          
          return runDate.getFullYear() === targetDay.getFullYear() &&
                 runDate.getMonth() === targetDay.getMonth() &&
                 runDate.getDate() === targetDay.getDate();
        });
        
        console.log(`   📍 Found ${dayRuns.length} ${planDay} day runs in ${location.name}`);
        
        for (const run of dayRuns) {
          try {
            await this.redzone.deleteScheduledRun(location.uuid, run.uuid);
            results.deleted.push({
              locationName: location.name,
              runId: run.externalId,
              redzoneRunId: run.uuid
            });
            console.log(`   ✅ Deleted run ${run.externalId} from ${location.name}`);
          } catch (error) {
            console.error(`   ❌ Failed to delete run ${run.externalId}:`, error.message);
            results.failed.push({
              item: { LineNumber: location.name, RunID: run.externalId },
              error: `Delete failed: ${error.message}`
            });
          }
        }
      } catch (error) {
        console.error(`❌ Failed to process location ${location.name}:`, error.message);
        results.failed.push({
          item: { LineNumber: location.name },
          error: `Location processing failed: ${error.message}`
        });
      }
    }
    
    // Small delay to ensure deletions have been processed
    if (results.deleted.length > 0) {
      console.log(`⏳ Waiting 2 seconds for deletions to complete...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Step 2: Create new runs from plan (only future runs)
    console.log(`➕ Step 2: Creating new runs from plan...`);
    const currentTime = Date.now();
    
    for (const item of payload.data) {
      try {
        // Skip runs that are already in production (start time < current time)
        if (item.Epoch < currentTime) {
          console.log(`⏭️ Skipping run ${item.RunID} - already in production (start: ${new Date(item.Epoch).toISOString()})`);
          results.skipped.push({
            item,
            reason: 'Run already in production'
          });
          continue;
        }
        
        const location = locationMap.get(item.LineNumber);
        if (!location) {
          results.failed.push({
            item,
            error: `Location '${item.LineNumber}' not found for ${bakeryType} bakery`
          });
          continue;
        }

        const product = this.findProductBySKU(item.SKU);
        if (!product) {
          results.failed.push({
            item,
            error: `Product SKU '${item.SKU}' not found in Redzone database`
          });
          continue;
        }

        const runData = {
          productTypeUUID: product.uuid,
          plannedQuantity: Math.round(Number(item.Qty)),
          plannedStartTime: Number(item.Epoch),
          externalId: item.RunID.toString(),
          customReference: item.customReference || '',
          standardRatePerMin: Number(item.RunRate)
        };

        const createdRun = await this.redzone.createScheduledRun(runData, location.uuid);
        results.created.push({
          item,
          redzoneRunId: createdRun.uuid,
          location: location.name,
          product: product.name
        });
        
        console.log(`✅ Created run ${item.RunID} in ${location.name}`);
      } catch (error) {
        console.error(`❌ Failed to process run ${item.RunID}:`, error.message);
        results.failed.push({
          item,
          error: error.message
        });
      }
    }

    // Step 3: Clean up old runs (not current or next day)
    console.log(`🧹 Step 3: Cleaning up old runs...`);
    await this.cleanupOldRuns();
    
    console.log(`🎉 ${planDay} day plan update completed!`);
    console.log(`📊 Summary: ${results.created.length} created, ${results.deleted.length} deleted, ${results.skipped.length} skipped, ${results.failed.length} failed`);
    
    // Send notification
    await this.sendPlanNotification('Update Current Plan', payload, results, bakeryType);
    
    return results;
  }

  // Clean up old runs (not current or next day)
  async cleanupOldRuns() {
    console.log('🧹 Starting cleanup of old runs...');
    const results = {
      cleaned: [],
      cleanupFailed: []
    };

    try {
      const allBakeryTypes = this.getBakeryTypes();
      
      for (const bakeryType of allBakeryTypes) {
        const locations = this.getBakeryLocations(bakeryType);
        
        for (const location of locations) {
          try {
            const runs = await this.redzone.getAllScheduledRuns(location.uuid);
            const oldRuns = runs.filter(run => {
              if (!run.externalId) return false;
              const runDaycode = this.parseRunIDDaycode(run.externalId);
              if (!runDaycode) return false;
              
              const runDate = runDaycode.date;
              const currentPlanDay = this.getCurrentPlanDay();
              const nextPlanDay = this.getNextPlanDay();
              
              // Keep runs that are current or next day
              const isCurrent = runDate.getFullYear() === currentPlanDay.getFullYear() &&
                               runDate.getMonth() === currentPlanDay.getMonth() &&
                               runDate.getDate() === currentPlanDay.getDate();
              
              const isNext = runDate.getFullYear() === nextPlanDay.getFullYear() &&
                            runDate.getMonth() === nextPlanDay.getMonth() &&
                            runDate.getDate() === nextPlanDay.getDate();
              
              // Delete if not current or next day
              return !isCurrent && !isNext;
            });
            
            console.log(`   📍 Found ${oldRuns.length} old runs in ${location.name} (${bakeryType})`);
            
            for (const run of oldRuns) {
              try {
                const runDaycode = this.parseRunIDDaycode(run.externalId);
                const runDate = runDaycode ? runDaycode.date.toDateString() : 'unknown';
                
                console.log(`   🗑️ Cleaning up old run ${run.externalId} from ${runDate}...`);
                
                await this.redzone.deleteScheduledRun(location.uuid, run.uuid);
                
                results.cleaned.push({
                  runId: run.externalId,
                  runDate: runDate,
                  location: location.name,
                  bakeryType: bakeryType,
                  redzoneRunId: run.uuid
                });
                
                console.log(`   ✅ Cleaned up old run ${run.externalId}`);
              } catch (error) {
                console.error(`   ❌ Failed to clean up run ${run.externalId}:`, error.message);
                results.cleanupFailed.push({
                  runId: run.externalId,
                  location: location.name,
                  bakeryType: bakeryType,
                  error: error.message
                });
              }
            }
          } catch (error) {
            console.error(`❌ Failed to process location ${location.name} (${bakeryType}):`, error.message);
          }
        }
      }
      
      console.log(`🎉 Cleanup completed: ${results.cleaned.length} cleaned, ${results.cleanupFailed.length} failed`);
      
      // Send notification for cleanup operations
      await this.sendPlanNotification('Cleanup Old Runs', null, results, 'all');
      
      return results;
      
    } catch (error) {
      console.error('❌ Cleanup failed:', error.message);
      throw error;
    }
  }

  // Delete all scheduled runs (for testing and cleanup)
  async deleteAllScheduledRuns(bakeryType = null) {
    if (bakeryType) {
      console.log(`🗑️ Starting bulk deletion of scheduled runs for ${bakeryType} bakery...`);
    } else {
      console.log('🗑️ Starting bulk deletion of all scheduled runs...');
    }
    
    const results = {
      totalFound: 0,
      deleted: [],
      failed: [],
      locationsProcessed: 0,
      totalLocations: 0,
      bakeryType: bakeryType || 'all'
    };

    try {
      let allLocations = [];
      
      if (bakeryType) {
        // Delete only for specific bakery
        const bakeryLocations = this.getBakeryLocations(bakeryType);
        allLocations = bakeryLocations.map(loc => ({...loc, bakeryType}));
        console.log(`📍 Found ${allLocations.length} locations for ${bakeryType} bakery to process`);
      } else {
        // Delete for all bakeries
        const allBakeryTypes = this.getBakeryTypes();
        for (const bakery of allBakeryTypes) {
          const bakeryLocations = this.getBakeryLocations(bakery);
          allLocations = allLocations.concat(bakeryLocations.map(loc => ({...loc, bakeryType: bakery})));
        }
        console.log(`📍 Found ${allLocations.length} locations across ${allBakeryTypes.length} bakeries to process`);
      }
      
      results.totalLocations = allLocations.length;

      // Process each location
      for (const location of allLocations) {
        try {
          console.log(`🔄 Processing location: ${location.name} (${location.bakeryType})`);
          
          // Get all scheduled runs for this location
          const scheduledRuns = await this.redzone.getAllScheduledRuns(location.uuid);
          results.totalFound += scheduledRuns.length;

          console.log(`📋 Found ${scheduledRuns.length} scheduled runs in ${location.name}`);

          // Delete each scheduled run
          for (const run of scheduledRuns) {
            try {
              await this.redzone.deleteScheduledRun(location.uuid, run.uuid);
              results.deleted.push({
                locationName: location.name,
                locationId: location.uuid,
                bakeryType: location.bakeryType,
                runId: run.externalId,
                redzoneRunId: run.uuid,
                plannedQuantity: run.plannedQuantity,
                plannedStartTime: run.plannedStartTime
              });
              console.log(`✅ Deleted run ${run.externalId} from ${location.name}`);
            } catch (error) {
              results.failed.push({
                locationName: location.name,
                locationId: location.uuid,
                bakeryType: location.bakeryType,
                runId: run.externalId,
                redzoneRunId: run.uuid,
                error: error.message
              });
              console.error(`❌ Failed to delete run ${run.externalId} from ${location.name}:`, error.message);
            }
          }

          results.locationsProcessed++;
          console.log(`✅ Completed processing ${location.name}`);

        } catch (error) {
          console.error(`❌ Failed to process location ${location.name}:`, error.message);
          results.failed.push({
            locationName: location.name,
            locationId: location.uuid,
            bakeryType: location.bakeryType,
            error: `Failed to fetch runs: ${error.message}`
          });
        }
      }

      console.log('🎉 Bulk deletion completed');
      console.log(`📊 Summary: ${results.deleted.length} deleted, ${results.failed.length} failed`);

      // Send notification for delete operations
      await this.sendPlanNotification('Delete All Scheduled Runs', null, results, bakeryType);

      return results;

    } catch (error) {
      console.error('❌ Bulk deletion failed:', error.message);
      throw error;
    }
  }

  // Delete scheduled runs for a specific bakery only
  async deleteBakeryScheduledRuns(bakeryType) {
    if (!bakeryType) {
      throw new Error('Bakery type is required for bakery-specific deletion');
    }
    
    return await this.deleteAllScheduledRuns(bakeryType);
  }

  // Generate report
  async generateReport(results) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        duplicates: 0,
        updated: 0,
        created: 0,
        deleted: 0,
        cleaned: 0
      },
      details: results
    };

    // Count results
    if (results.successful) report.summary.successful = results.successful.length;
    if (results.failed) report.summary.failed = results.failed.length;
    if (results.skipped) report.summary.skipped = results.skipped.length;
    if (results.duplicates) report.summary.duplicates = results.duplicates.length;
    if (results.updated) report.summary.updated = results.updated.length;
    if (results.created) report.summary.created = results.created.length;
    if (results.deleted) report.summary.deleted = results.deleted.length;
    if (results.cleaned) report.summary.cleaned = results.cleaned.length;
    
    // Handle delete all results
    if (results.totalFound !== undefined) {
      report.summary.totalFound = results.totalFound;
      report.summary.deleted = results.deleted.length;
      report.summary.failed = results.failed.length;
      report.summary.locationsProcessed = results.locationsProcessed;
      report.summary.totalLocations = results.totalLocations;
    }
    
    report.summary.total = Object.values(report.summary).reduce((sum, val) => sum + (val || 0), 0);

    // Save report
    const reportFilename = `simplified-report-${Date.now()}.json`;
    await this.redzone.saveCacheToFile(report, reportFilename);
    
    console.log(`📄 Report saved: ${reportFilename}`);
    return report;
  }

  // Refresh location cache
  async refreshLocationCache() {
    console.log('🔄 Refreshing location cache...');
    const locations = await this.redzone.getAllLocations();
    this.locationCache = {
      timestamp: new Date().toISOString(),
      data: locations
    };
    await this.redzone.saveCacheToFile(this.locationCache, 'locations-cache.json');
    console.log(`✅ Location cache refreshed with ${locations.length} locations`);
  }

  // Refresh product cache
  async refreshProductCache() {
    console.log('🔄 Refreshing product cache...');
    const products = await this.redzone.getAllProductTypes();
    this.productCache = {
      timestamp: new Date().toISOString(),
      data: products
    };
    await this.redzone.saveCacheToFile(this.productCache, 'products-cache.json');
    console.log(`✅ Product cache refreshed with ${products.length} products`);
  }

  // Send notification to webhook
  async sendPlanNotification(action, payload, results, bakeryType) {
    if (!this.notificationHook) {
      console.log('📢 No notification hook configured, skipping notification');
      return;
    }

    try {
      console.log('📢 Sending plan notification...');
      
      // Generate CSV string from payload data
      const csvData = this.generateCSVFromPayload(payload);
      
      // Generate overview stats
      const overviewStats = this.generateOverviewStats(results);
      
      // Generate detailed error/skip information
      const detailedInfo = this.generateDetailedInfo(results);
      
      const notification = {
        timestamp: new Date().toISOString(),
        action: action,
        bakeryType: bakeryType || 'Lynher',
        planDay: payload ? this.determinePlanDay(payload) : 'unknown',
        csvData: csvData,
        overview: overviewStats,
        details: detailedInfo,
        summary: {
          totalProcessed: (results.created?.length || 0) + (results.deleted?.length || 0) + (results.successful?.length || 0),
          successful: results.created?.length || results.successful?.length || 0,
          failed: results.failed?.length || 0,
          skipped: results.skipped?.length || 0,
          deleted: results.deleted?.length || 0
        }
      };

      // Send notification
      await axios.post(this.notificationHook, notification, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      console.log('✅ Plan notification sent successfully');
      
    } catch (error) {
      console.error('❌ Failed to send plan notification:', error.message);
      // Don't throw error - notification failure shouldn't break the main process
    }
  }

  // Generate CSV string from payload data
  generateCSVFromPayload(payload) {
    if (!payload || !payload.data || !Array.isArray(payload.data)) {
      return 'No data available';
    }

    try {
      // CSV header
      const headers = ['LineNumber', 'SKU', 'RunID', 'Qty', 'UOM', 'Epoch', 'customReference', 'RunRate'];
      let csv = headers.join(',') + '\n';
      
      // CSV data rows
      for (const item of payload.data) {
        const row = [
          item.LineNumber || '',
          item.SKU || '',
          item.RunID || '',
          item.Qty || '',
          item.UOM || '',
          item.Epoch || '',
          item.customReference || '',
          item.RunRate || ''
        ];
        csv += row.join(',') + '\n';
      }
      
      return csv;
    } catch (error) {
      console.error('❌ Failed to generate CSV:', error.message);
      return 'Error generating CSV data';
    }
  }

  // Generate overview stats similar to console logs
  generateOverviewStats(results) {
    const stats = {
      successful: results.created?.length || results.successful?.length || 0,
      failed: results.failed?.length || 0,
      skipped: results.skipped?.length || 0,
      deleted: results.deleted?.length || 0,
      cleaned: results.cleaned?.length || 0
    };

    // Add location processing stats for delete operations
    if (results.locationsProcessed !== undefined) {
      stats.locationsProcessed = results.locationsProcessed;
      stats.totalLocations = results.totalLocations;
      stats.totalFound = results.totalFound;
    }

    return stats;
  }

  // Generate detailed information about failures and skips
  generateDetailedInfo(results) {
    const details = {
      failures: [],
      skips: [],
      errors: []
    };

    // Process failed items
    if (results.failed && Array.isArray(results.failed)) {
      for (const failure of results.failed) {
        const errorInfo = {
          runId: failure.item?.RunID || 'Unknown',
          lineNumber: failure.item?.LineNumber || 'Unknown',
          sku: failure.item?.SKU || 'Unknown',
          error: failure.error || 'Unknown error',
          timestamp: new Date().toISOString()
        };
        details.failures.push(errorInfo);
      }
    }

    // Process skipped items
    if (results.skipped && Array.isArray(results.skipped)) {
      for (const skip of results.skipped) {
        const skipInfo = {
          runId: skip.item?.RunID || 'Unknown',
          lineNumber: skip.item?.LineNumber || 'Unknown',
          sku: skip.item?.SKU || 'Unknown',
          reason: skip.reason || 'Unknown reason',
          timestamp: new Date().toISOString()
        };
        details.skips.push(skipInfo);
      }
    }

    // Process cleanup failures
    if (results.cleanupFailed && Array.isArray(results.cleanupFailed)) {
      for (const cleanupError of results.cleanupFailed) {
        const cleanupInfo = {
          runId: cleanupError.runId || 'Unknown',
          location: cleanupError.location || 'Unknown',
          bakeryType: cleanupError.bakeryType || 'Unknown',
          error: cleanupError.error || 'Unknown error',
          timestamp: new Date().toISOString()
        };
        details.errors.push(cleanupInfo);
      }
    }

    return details;
  }
}

module.exports = SchedulingService;
