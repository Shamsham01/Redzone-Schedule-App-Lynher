const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const SchedulingService = require('./scheduling-service-single-notification');

const app = express();
const PORT = process.env.PORT || 5026;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Raw text middleware for webhook endpoint
app.use('/webhook', express.text({ type: 'text/plain', limit: '10mb' }));

// Initialize scheduling service
const schedulingService = new SchedulingService();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Redzone Scheduling App (Simplified)'
  });
});

// Manual cache sync endpoint
app.post('/sync-cache', async (req, res) => {
  try {
    console.log('🔄 Manual cache sync requested...');
    await schedulingService.refreshLocationCache();
    await schedulingService.refreshProductCache();
    res.json({
      success: true,
      message: 'Cache synced successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Cache sync failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Main webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    console.log('📨 Received webhook payload');
    console.log('Raw payload:', JSON.stringify(req.body, null, 2));
    
    // Handle case where payload might be a JSON string (from Make.com with text/plain)
    let payload = req.body;
    
    // If payload is a string, try to parse it as JSON
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
        console.log('📦 Parsed JSON string payload:', JSON.stringify(payload, null, 2));
      } catch (parseError) {
        console.error('❌ Failed to parse JSON string:', parseError.message);
        return res.status(400).json({
          error: 'Invalid JSON payload',
          received: req.body
        });
      }
    }
    
    // Handle case where payload might be wrapped in an array (from Make.com)
    if (Array.isArray(payload) && payload.length > 0) {
      payload = payload[0];
      console.log('📦 Unwrapped array payload:', JSON.stringify(payload, null, 2));
    }
    
    console.log('Action:', payload.action);
    console.log('Bakery Type:', payload.bakeryType || 'Lynher (default)');
    console.log('Data items:', payload.data?.length || 0);

    // Validate payload
    if (!payload.action) {
      console.log('❌ Validation failed: Missing action field');
      return res.status(400).json({
        error: 'Invalid payload. Missing action field.',
        received: req.body
      });
    }

    // For cleanup and delete commands, data field is not required
    const commandsWithoutData = [
      'Cleanup Old Runs', 
      'Delete All Scheduled Runs',
      'Delete Lynher Scheduled Runs',
      'Delete Tamar Scheduled Runs'
    ];
    
    if (!commandsWithoutData.includes(payload.action) && !payload.data) {
      console.log('❌ Validation failed: Missing data field for action:', payload.action);
      return res.status(400).json({
        error: 'Invalid payload. Missing data field for this action.',
        received: req.body
      });
    }

    console.log('✅ Payload validation passed');

    // Initialize service if not already done
    if (!schedulingService.locationCache) {
      await schedulingService.initialize();
    }

    let results;
    
    // Process based on action type
    switch (payload.action) {
      case 'Post New Plan':
      case 'Update Current Plan':
        console.log('🔄 Processing plan (unified update logic)...');
        results = await schedulingService.processUpdatePlan(payload);
        break;
        
      case 'Delete All Scheduled Runs':
        console.log('🗑️ Processing delete all scheduled runs...');
        results = await schedulingService.deleteAllScheduledRuns(payload.bakeryType);
        break;
        
      case 'Delete Lynher Scheduled Runs':
        console.log('🗑️ Processing delete Lynher scheduled runs...');
        results = await schedulingService.deleteBakeryScheduledRuns('Lynher');
        break;
        
      case 'Delete Tamar Scheduled Runs':
        console.log('🗑️ Processing delete Tamar scheduled runs...');
        results = await schedulingService.deleteBakeryScheduledRuns('Tamar');
        break;
        
      case 'Cleanup Old Runs':
        console.log('🧹 Processing cleanup of old runs...');
        results = await schedulingService.cleanupOldRuns();
        break;
        
      default:
        return res.status(400).json({
          error: `Unknown action: ${payload.action}`,
          supportedActions: [
            'Post New Plan', 
            'Update Current Plan', 
            'Delete All Scheduled Runs',
            'Delete Lynher Scheduled Runs',
            'Delete Tamar Scheduled Runs',
            'Cleanup Old Runs'
          ],
          note: 'Both "Post New Plan" and "Update Current Plan" use the same unified update logic'
        });
    }

    // Generate and save report
    const report = await schedulingService.generateReport(results);
    
    // Send response
    res.json({
      success: true,
      action: payload.action,
      bakeryType: payload.bakeryType || 'Lynher',
      timestamp: new Date().toISOString(),
      summary: report.summary,
      reportFile: `simplified-report-${Date.now()}.json`
    });

    // Log summary
    console.log('📊 Processing Summary:');
    const deleteCommands = [
      'Delete All Scheduled Runs',
      'Delete Lynher Scheduled Runs', 
      'Delete Tamar Scheduled Runs'
    ];
    
    if (deleteCommands.includes(payload.action)) {
      console.log(`📍 Locations Processed: ${report.summary.locationsProcessed || 0}/${report.summary.totalLocations || 0}`);
      console.log(`📋 Total Runs Found: ${report.summary.totalFound || 0}`);
      console.log(`✅ Successfully Deleted: ${report.summary.deleted || 0}`);
      console.log(`❌ Failed to Delete: ${report.summary.failed || 0}`);
      if (report.summary.bakeryType) {
        console.log(`🏭 Bakery Type: ${report.summary.bakeryType}`);
      }
    } else {
      console.log(`✅ Successful: ${report.summary.successful || 0}`);
      console.log(`❌ Failed: ${report.summary.failed || 0}`);
      console.log(`⏭️ Skipped: ${report.summary.skipped || 0}`);
      if (report.summary.duplicates) console.log(`⚠️ Duplicates: ${report.summary.duplicates}`);
      if (report.summary.updated) console.log(`🔄 Updated: ${report.summary.updated}`);
      if (report.summary.created) console.log(`➕ Created: ${report.summary.created}`);
      if (report.summary.deleted) console.log(`🗑️ Deleted: ${report.summary.deleted}`);
      if (report.summary.cleaned) console.log(`🧹 Cleaned: ${report.summary.cleaned}`);
    }

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Redzone Scheduling App (Simplified) started on port ${PORT}`);
  console.log(`📡 Webhook endpoint: http://0.0.0.0:${PORT}/webhook`);
  console.log(`🏥 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`🔄 Cache sync: http://0.0.0.0:${PORT}/sync-cache`);
  
  // Initialize scheduling service
  try {
    await schedulingService.initialize();
    console.log('✅ Scheduling service initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize scheduling service:', error.message);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;