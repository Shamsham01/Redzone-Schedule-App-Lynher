# Redzone Scheduling App for Lynher Bakery

A Node.js application that integrates with Redzone API to manage production scheduling for Lynher Bakery. The app receives scheduling data from Excel macros and creates/updates scheduled runs in the Redzone system.

## Features

- **Webhook Server**: Receives scheduling data from Excel macros
- **Redzone API Integration**: Full CRUD operations for scheduled runs
- **Location & Product Mapping**: Automatically maps LineNumber to locationId and SKU to productTypeUUID
- **Plan Management**: Handles both new plans and plan updates
- **Caching**: Caches location and product data for performance
- **Error Handling**: Comprehensive error handling and reporting
- **Logging**: Detailed logging for monitoring and debugging

## Architecture

```
Excel Macro → Webhook Server → Redzone API Client → Redzone API
     ↓              ↓              ↓
  JSON Payload → Processing → Scheduled Runs
```

## Installation

1. **Clone or download the project files**
2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   - Copy `example.env` to `.env`
   - Update the Redzone API credentials in `.env`

4. **Start the server**:
   ```bash
   npm start
   ```

## Configuration

### Environment Variables (.env)

```env
CLIENT_ID=your_redzone_client_id
CLIENT_SECRET=your_redzone_client_secret
ORGANISATION_ID=your_organization_id
ENTERPRISE_ID=your_enterprise_id
PORT=5026
```

### Server Configuration

- **Host**: 0.0.0.0 (listens on all interfaces)
- **Port**: 5026 (configurable via PORT env var)
- **Webhook Endpoint**: `http://217.154.38.118:5026/webhook`
- **Health Check**: `http://217.154.38.118:5026/health`

## API Endpoints

### POST /webhook
Main webhook endpoint that receives scheduling data from Excel macros.

**Request Body**:

For scheduling operations:
```json
{
  "action": "Post New Plan" | "Update Current Plan",
  "data": [
    {
      "LineNumber": "Prod Line 1",
      "SKU": "UB02138G",
      "RunID": 1252521,
      "Qty": 24703,
      "UOM": "EACH",
      "Epoch": 1754762400000,
      "customReference": "Pickups",
      "RunRate": 160
    }
  ]
}
```

For delete all operations:
```json
{
  "action": "Delete All Scheduled Runs"
}
```

**Response**:

For scheduling operations:
```json
{
  "success": true,
  "action": "Post New Plan",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "summary": {
    "total": 8,
    "successful": 7,
    "failed": 1,
    "skipped": 0
  },
  "reportFile": "report-1705312200000.json"
}
```

For delete all operations:
```json
{
  "success": true,
  "action": "Delete All Scheduled Runs",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "summary": {
    "totalFound": 25,
    "deleted": 23,
    "failed": 2,
    "locationsProcessed": 5,
    "totalLocations": 5
  },
  "reportFile": "report-1705312200000.json"
}
```

### GET /health
Health check endpoint for monitoring.

## Excel Macro Integration

The Excel macro has been updated to send data to your server:

1. **Update the macro URL** in your Excel file to:
   ```
   http://217.154.38.118:5026/webhook
   ```

2. **Macro Actions**:
   - **"Post New Plan"**: Creates new scheduled runs in Redzone
   - **"Update Current Plan"**: Updates existing runs, creates new ones, or deletes removed ones

## Workflow

### Post New Plan
1. Excel macro sends JSON payload with action "Post New Plan"
2. App maps LineNumber to locationId using Redzone Locations API
3. App maps SKU to productTypeUUID using Redzone Product Types API
4. App creates scheduled runs for each item in Redzone
5. App generates and saves a detailed report

### Update Current Plan
1. Excel macro sends JSON payload with action "Update Current Plan"
2. App compares new plan with cached current plan
3. App identifies:
   - New items to create
   - Existing items to update
   - Items to delete
4. App performs the necessary CRUD operations in Redzone
5. App updates the current plan cache

### Delete All Scheduled Runs
1. External system (make.com) sends JSON payload with action "Delete All Scheduled Runs"
2. App fetches all locations from Redzone
3. App retrieves all scheduled runs from each location
4. App deletes each scheduled run individually
5. App clears the current plan cache
6. App generates a detailed report of the deletion process

## Error Handling

- **Missing Locations**: Items with unknown LineNumber are marked as failed
- **Missing Products**: Items with unknown SKU are marked as skipped
- **API Errors**: Detailed error logging and reporting
- **Network Issues**: Automatic retry and graceful error handling

## Caching

The app caches location and product data to improve performance:
- **locations-cache.json**: Cached location data (refreshed every hour)
- **products-cache.json**: Cached product data (refreshed every hour)
- **current-plan-cache.json**: Current plan state for updates

## Logging

The app provides comprehensive logging:
- Request/response logging
- Processing summaries
- Error details
- Performance metrics

## Monitoring

- **Health Check**: `/health` endpoint for basic monitoring
- **Reports**: Detailed JSON reports saved for each operation
- **Console Logs**: Real-time processing information

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Check CLIENT_ID and CLIENT_SECRET in .env
   - Verify Redzone API credentials

2. **Location Not Found**
   - Check LineNumber spelling in Excel data
   - Verify location exists in Redzone

3. **Product Not Found**
   - Check SKU spelling in Excel data
   - Verify product exists in Redzone

4. **Connection Refused**
   - Check server is running on port 5026
   - Verify firewall settings

### Debug Mode

Enable detailed logging by setting:
```bash
DEBUG=redzone-scheduling-app npm start
```

## File Structure

```
├── webhook-server.js          # Main Express server
├── redzone-api-client.js      # Redzone API client
├── scheduling-service.js      # Business logic service
├── package.json               # Dependencies
├── example.env               # Environment template
├── excel-macro-updated.vb    # Updated Excel macro
└── README.md                 # This file
```

## Production Deployment

1. **Server Setup**:
   - Install Node.js on your server
   - Copy all files to the server
   - Run `npm install --production`

2. **Environment Configuration**:
   - Create `.env` file with production credentials
   - Update Excel macro URL to production server

3. **Process Management**:
   - Use PM2 or similar for process management
   - Set up log rotation
   - Configure monitoring

4. **Security**:
   - Configure firewall for port 5026
   - Use HTTPS in production (recommended)
   - Regular security updates

## Support

For issues or questions:
1. Check the logs for error details
2. Verify Redzone API connectivity
3. Check Excel macro configuration
4. Review the generated reports

## License

MIT License - See LICENSE file for details.
