const { AsyncLocalStorage } = require('async_hooks');
const SchedulingService = require('./scheduling-service');

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
