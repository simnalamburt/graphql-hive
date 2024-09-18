import { Injectable, Scope } from 'graphql-modules';
import { Logger } from '../../shared/providers/logger';
import { AuditLogEvent, auditLogSchema } from './audit-logs-types';
import { sql as c_sql, ClickHouse } from '../../operations/providers/clickhouse-client';


@Injectable({
  scope: Scope.Operation,
  global: true,
})
export class AuditLogManager {
  private logger: Logger;

  constructor(
    logger: Logger,
    private clickHouse: ClickHouse,
  ) {
    this.logger = logger.child({ source: 'AuditLogsManager' });
  }

  async createLogAuditEvent(event: AuditLogEvent): Promise<void> {
    const { organizationId, user } = event;
    this.logger.info('Creating a log audit event (event=%o)', event);

    const parsedEvent = auditLogSchema.parse(event);

    const eventTime = new Date().toISOString();

    const values = [
      eventTime,
      user.userId,
      user.userEmail,
      organizationId,
      parsedEvent.eventType,
      JSON.stringify(parsedEvent),
    ];

    await this.clickHouse.insert({
      query: c_sql`
        INSERT INTO "audit_log" (
          "id"
          , "event_time"
          , "user_id"
          , "user_email"
          , "organization_id"
          , "event_action"
          , "metadata"
        )
        FORMAT CSV`,
      data: [values],
      timeout: 5000,
      queryId: 'create-audit-log',
    });
  }


  async getPaginatedAuditLogs(limit: string, offset: string): Promise<AuditLogEvent[]> {
    this.logger.info('Getting paginated audit logs (limit=%s, offset=%s)', limit, offset);

    const query = c_sql`
      SELECT *
      FROM audit_log
      ORDER BY event_time DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const result = await this.clickHouse.query({
      query,
      queryId: 'get-audit-logs',
      timeout: 5000,
    });
    if (!result || !result.data || result.data.length === 0) {
      throw new Error('Audit logs not found');
    }
    return result.data as AuditLogEvent[];
  }

  async getAuditLogsCount(): Promise<number> {
    this.logger.info('Getting audit logs count');
    const query = c_sql`
      SELECT COUNT(*)
      FROM audit_log
    `;

    const result = await this.clickHouse.query({
      query,
      queryId: 'get-audit-logs-count',
      timeout: 5000,
    });
    return result.data.length;
  }
}
