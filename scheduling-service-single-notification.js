const { AsyncLocalStorage } = require('async_hooks');
const SchedulingService = require('./scheduling-service');

const REPORT_FILENAME = 'simplified-report.json';

class SingleNotificationSchedulingService extends SchedulingService {
  constructor() {
    super();
    this.notificationContext = new AsyncLocalStorage();
  }

  async processUpdatePlan(payload) {
    return this.notificationContext.run(
      { suppressCleanupNotification: true },
      () => super.processUpdatePlan(payload)
    );
  }

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

    if (results.successful) report.summary.successful = results.successful.length;
    if (results.failed) report.summary.failed = results.failed.length;
    if (results.skipped) report.summary.skipped = results.skipped.length;
    if (results.duplicates) report.summary.duplicates = results.duplicates.length;
    if (results.updated) report.summary.updated = results.updated.length;
    if (results.created) report.summary.created = results.created.length;
    if (results.deleted) report.summary.deleted = results.deleted.length;
    if (results.cleaned) report.summary.cleaned = results.cleaned.length;

    if (results.totalFound !== undefined) {
      report.summary.totalFound = results.totalFound;
      report.summary.deleted = results.deleted.length;
      report.summary.failed = results.failed.length;
      report.summary.locationsProcessed = results.locationsProcessed;
      report.summary.totalLocations = results.totalLocations;
    }

    report.summary.total = Object.values(report.summary).reduce(
      (sum, value) => sum + (value || 0),
      0
    );

    // Always write to the same file so each run replaces the previous summary.
    await this.redzone.saveCacheToFile(report, REPORT_FILENAME);

    console.log(`📄 Report updated: ${REPORT_FILENAME}`);
    return report;
  }

  async sendPlanNotification(action, payload, results, bakeryType) {
    const context = this.notificationContext.getStore();

    if (context?.suppressCleanupNotification && action === 'Cleanup Old Runs') {
      console.log('📢 Cleanup notification suppressed during plan update');
      return;
    }

    return super.sendPlanNotification(action, payload, results, bakeryType);
  }
}

module.exports = SingleNotificationSchedulingService;
